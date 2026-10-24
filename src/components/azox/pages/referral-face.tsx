import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, ChevronRight, Copy, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAzox } from "@/components/azox/app-provider";
import logo from "@/assets/azox/azox-uploaded-logo.png.asset.json";
import { referralLinkFor } from "@/lib/azox-backend";
import { getWebApp } from "@/lib/telegram";

function openTelegramLink(url: string): void {
  const app = getWebApp() as (ReturnType<typeof getWebApp> & {
    openTelegramLink?: (link: string) => void;
  });
  if (app?.openTelegramLink) {
    app.openTelegramLink(url);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export function ReferralFace() {
  const { user, dbUser } = useAzox();
  const [copied, setCopied] = useState(false);
  const referral = referralLinkFor(dbUser?.referral_code ?? user.username);

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
      <header className="flex flex-col items-center gap-3 py-3 text-center">
        <img src={logo.url} alt="AZOX logo" width={112} height={112} className="size-28 rounded-2xl object-contain" />
        <h1 className="text-xl font-bold">AZOX Referral</h1>
        <p className="text-sm text-muted-foreground">Invite friends to AZOX and earn points.</p>
      </header>

      <div className="flex items-center gap-2">
        <code title={referral} className="min-w-0 flex-1 truncate rounded-lg border border-border bg-secondary/50 px-3 py-3 text-xs text-muted-foreground">
          {referral}
        </code>
        <Button onClick={copy} className="shrink-0 bg-accent text-accent-foreground hover:bg-accent/90">
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        <Button onClick={() => openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(referral)}&text=${encodeURIComponent("Join me on AZOX")}`)} className="w-full bg-accent text-accent-foreground hover:bg-accent/90">
          <Share2 aria-hidden="true" /> Share
        </Button>
      </div>

      <section className="glass rounded-2xl p-4">
        <h2 className="text-sm font-bold">How rewards work</h2>
        <ul className="mt-3 list-disc space-y-3 pl-4 text-sm leading-relaxed text-muted-foreground">
          <li>+5,000 points and 10 tasks for you for every new friend who joins with your link.</li>
          <li>Your friend gets +3,000 points and 10 tasks when joining with your link.</li>
          <li>Rewards apply only to brand-new accounts. Accounts that already exist do not qualify.</li>
        </ul>
      </section>

      <Button asChild variant="outline" className="w-full">
        <Link to="/referrals">View my referrals <ChevronRight aria-hidden="true" /></Link>
      </Button>
    </div>
  );
}