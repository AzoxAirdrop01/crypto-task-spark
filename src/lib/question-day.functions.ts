import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { QUESTIONS_PER_DAY } from "./rewards";

const questionSchema = z.object({
  question: z.string().refine((value) => value.trim().length > 0),
  options: z.array(z.string().refine((value) => value.trim().length > 0)).length(5),
  correct: z.number().int().min(0).max(4),
  difficulty: z.enum(["easy", "medium", "hard"]),
});

export type DailyQuestion = z.infer<typeof questionSchema>;

export type DailyQuestionsResult =
  | { ok: true; questions: DailyQuestion[] }
  | { ok: false; error: "unavailable" }
  | { ok: false; error: "already_played"; nextResetAt: number };

/** Epoch ms of the next 00:00 UTC after `now`. */
export function nextUtcMidnight(now: number = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

function unavailable(reason: string): DailyQuestionsResult {
  console.error(`[question-day] ${reason}`);
  return { ok: false, error: "unavailable" };
}

export const getDailyQuestions = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z.object({ initData: z.string().min(1).max(8192) }).parse(data),
  )
  .handler(async ({ data }): Promise<DailyQuestionsResult> => {
    try {
      const { verifyTelegramInitData } = await import("./telegram-auth.server");
      const verified = await verifyTelegramInitData(data.initData);
      if (!verified.ok) return unavailable(`verification failed: ${verified.error}`);

      try {
        const { getGamingFaceCached } = await import("./gaming-face.server");
        if ((await getGamingFaceCached()) === 2) return unavailable("gaming face 2");
      } catch {
        // Fail-open to Face 1; the individual game switch still applies below.
      }

      const { isGameEnabled } = await import("./game-switches.server");
      if (!(await isGameEnabled("question-day"))) return unavailable("game disabled");

      const { db, utcDay } = await import("./azox-secure.server");
      const day = utcDay();
      const { data: result, error } = await db().rpc("get_daily_questions", {
        p_day: day,
      });
      if (error) return unavailable("daily questions RPC failed");

      const parsed = z
        .object({ questions: z.array(questionSchema).length(QUESTIONS_PER_DAY) })
        .safeParse(result);
      if (!parsed.success) return unavailable("invalid or unavailable daily questions");

      // Record the one daily start; fail closed so questions are never served unrecorded.
      const { data: firstStart, error: startError } = await db().rpc("start_daily_play", {
        p_telegram_id: verified.user.id,
        p_game: "question",
        p_day: day,
      });
      if (startError) return unavailable("start_daily_play RPC failed");
      if (firstStart !== true) {
        return { ok: false, error: "already_played", nextResetAt: nextUtcMidnight() };
      }
      return { ok: true, questions: parsed.data.questions };
    } catch {
      return unavailable("daily questions request failed");
    }
  });