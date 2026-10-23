import { useCallback, useRef, useState } from "react";
import { useAzox } from "./app-provider";
import { AZOX_IMAGES } from "@/lib/azox-images";

type FloatText = { id: number; x: number; y: number; value: number };
type Ripple = { id: number; x: number; y: number };

let counter = 0;

export function ClickButton() {
  const { tap, rank, isGameEnabled } = useAzox();
  const enabled = isGameEnabled("main-tap");
  const [floats, setFloats] = useState<FloatText[]>([]);
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const [pressed, setPressed] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const spawn = useCallback(
    (touches: { clientX: number; clientY: number }[]) => {
      const rect = btnRef.current?.getBoundingClientRect();
      if (!rect || !enabled) return;
      const fingers = Math.max(1, touches.length);
      const gained = tap(fingers);

      const newFloats: FloatText[] = [];
      const newRipples: Ripple[] = [];
      for (const t of touches) {
        const x = t.clientX - rect.left;
        const y = t.clientY - rect.top;
        const id = counter++;
        newFloats.push({ id, x, y, value: rank.pointsPerFinger });
        newRipples.push({ id, x, y });
      }
      if (touches.length === 0) {
        const id = counter++;
        newFloats.push({
          id,
          x: rect.width / 2,
          y: rect.height / 2,
          value: gained,
        });
        newRipples.push({ id, x: rect.width / 2, y: rect.height / 2 });
      }

      setFloats((prev) => [...prev, ...newFloats]);
      setRipples((prev) => [...prev, ...newRipples]);

      const ids = new Set([...newFloats, ...newRipples].map((f) => f.id));
      window.setTimeout(() => {
        setFloats((prev) => prev.filter((f) => !ids.has(f.id)));
        setRipples((prev) => prev.filter((r) => !ids.has(r.id)));
      }, 900);
    },
    [tap, rank.pointsPerFinger, enabled],
  );

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative">
        {enabled && (
          <span className="pointer-events-none absolute inset-0 animate-azox-pulse-ring rounded-full bg-[#CCFF00]/25" />
        )}
        <button
          ref={btnRef}
          type="button"
          disabled={!enabled}
          aria-label="Tap AZOX to earn points"
          onTouchStart={(e) => {
            e.preventDefault();
            if (!enabled) return;
            setPressed(true);
            spawn(
              Array.from(e.touches).map((t) => ({
                clientX: t.clientX,
                clientY: t.clientY,
              })),
            );
          }}
          onTouchEnd={() => setPressed(false)}
          onMouseDown={(e) => {
            // Avoid double counting on touch devices that also fire mouse events.
            if (!enabled || "ontouchstart" in window) return;
            setPressed(true);
            spawn([{ clientX: e.clientX, clientY: e.clientY }]);
          }}
          onMouseUp={() => setPressed(false)}
          onMouseLeave={() => setPressed(false)}
          className="relative grid size-56 select-none place-items-center rounded-full border border-[#CCFF00]/60 bg-gradient-to-b from-[#CCFF00]/25 to-[#CCFF00]/5 shadow-[0_0_0_1px_rgba(204,255,0,0.5),0_0_40px_rgba(204,255,0,0.45),0_0_90px_rgba(204,255,0,0.3)] transition-transform duration-100 active:scale-95 disabled:opacity-40 disabled:shadow-none disabled:active:scale-100"
          style={{ transform: pressed ? "scale(0.95)" : undefined }}
        >
          <span className="absolute inset-3 rounded-full border border-white/10 bg-card/60" />
          <img
            src={AZOX_IMAGES.token}
            alt="AZOX"
            width={150}
            height={150}
            className="relative size-32 rounded-[30px] object-contain drop-shadow-[0_0_24px_rgba(204,255,0,0.6)]"
            draggable={false}
          />

          {ripples.map((r) => (
            <span
              key={r.id}
              className="pointer-events-none absolute size-16 animate-azox-ripple rounded-full bg-accent/40"
              style={{ left: r.x, top: r.y }}
            />
          ))}
          {floats.map((f) => (
            <span
              key={f.id}
              className="pointer-events-none absolute -translate-x-1/2 animate-azox-float-up text-lg font-extrabold text-accent text-glow-orange"
              style={{ left: f.x, top: f.y }}
            >
              +{f.value}
            </span>
          ))}
        </button>
      </div>
      {!enabled ? (
        <p className="text-center text-xs text-muted-foreground">Main Tap is paused for now.</p>
      ) : (
        <p className="text-center text-xs text-muted-foreground">
          Tap with multiple fingers to earn{" "}
          <span className="font-semibold text-accent">{rank.pointsPerFinger} pt</span> per finger at{" "}
          <span style={{ color: rank.color }}>{rank.key}</span> rank
        </p>
      )}
    </div>
  );
}
