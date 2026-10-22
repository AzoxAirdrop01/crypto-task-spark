import { useEffect, useState } from "react";
import { ArrowLeft, Check, Copy, Users } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAzox } from "@/components/azox/app-provider";
import { formatPoints } from "@/lib/azox-data";
import {
  fetchReferredUsers,
  referralLinkFor,
  type ReferredUser,
} from "@/lib/azox-backend";

function nameOf(row: ReferredUser): string {
  const full = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
  return full || row.username || "AZOX Player";
}

function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (!parts.length) return "AZ";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

function joinDate(value: string | null): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

export function ReferralsPage() {
  const { user, dbUser } = useAzox();
  const [rows, setRows] = useState<ReferredUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const referral = dbUser
    ? referralLinkFor(dbUser.referral_code ?? user.username)
    : user.referralLink;

  useEffect(() => {
    if (!dbUser?.telegram_id) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void fetchReferredUsers(dbUser.telegram_id).then((list) => {
      if (cancelled) return;
      setRows(list);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [dbUser?.telegram_id]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(referral);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-center gap-3">
        <Link
          to="/profile"
          className="flex size-9 items-center justify-center rounded-xl border border-border bg-secondary/40"
          aria-label="Back to profile"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </Link>
        <div>
          <h1 className="text-base font-bold">My Referrals</h1>
          <p className="text-xs text-muted-foreground">
            {rows.length} {rows.length === 1 ? "friend" : "friends"} joined
            through your link.
          </p>
        </div>
      </header>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <section className="glass flex flex-col items-center gap-3 rounded-2xl p-6 text-center">
          <Users className="size-8 text-accent" aria-hidden="true" />
          <p className="text-sm font-semibold">You haven't invited anyone yet.</p>
          <p className="text-xs text-muted-foreground">
            Share your referral link and earn points for every successful referral.
          </p>
          <Button
            onClick={copy}
            className="mt-1 rounded-xl bg-accent font-semibold text-accent-foreground hover:bg-accent/90"
          >
            {copied ? (
              <Check className="size-4" aria-hidden="true" />
            ) : (
              <Copy className="size-4" aria-hidden="true" />
            )}
            {copied ? "Copied" : "Copy referral link"}
          </Button>
        </section>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => {
            const name = nameOf(row);
            return (
              <li
                key={row.telegram_id}
                className="glass flex items-center gap-3 rounded-2xl p-3"
              >
                <Avatar className="size-11 border border-accent/40">
                  {row.photo_url && (
                    <AvatarImage src={row.photo_url} alt={name} />
                  )}
                  <AvatarFallback className="bg-accent/15 text-sm font-bold text-accent">
                    {initialsOf(name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{name}</p>
                  {row.username && (
                    <p className="truncate text-xs text-muted-foreground">
                      @{row.username}
                    </p>
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    Joined {joinDate(row.joined_at)}
                  </p>
                </div>
                <span className="text-sm font-bold text-gold">+{formatPoints(row.points_given)}</span>
              </li>
            );
          })}
        </ul>
      )}

      {rows.length > 0 && (
        <section className="glass rounded-2xl p-4">
          <p className="text-sm font-bold">Your referral link</p>
          <div className="mt-3 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-xl border border-border bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
              {referral}
            </code>
            <Button
              onClick={copy}
              className="rounded-xl bg-accent font-semibold text-accent-foreground hover:bg-accent/90"
            >
              {copied ? (
                <Check className="size-4" aria-hidden="true" />
              ) : (
                <Copy className="size-4" aria-hidden="true" />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Total earned from referrals:{" "}
            <span className="text-gold">
              {formatPoints(rows.reduce((total, row) => total + row.points_given, 0))}
            </span>
          </p>
        </section>
      )}
    </div>
  );
}
