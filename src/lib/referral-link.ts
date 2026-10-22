/** Configured Mini App (same as TELEGRAM_APP_URL in wagmi-config.ts). */
export const MINI_APP_URL = "https://t.me/AZOX_Airdrop_bot/AZOX_Airdrop";
export const INVITE_BOT_URL = "https://t.me/AZOX_Airdrop_bot?start=invite";

/** Opens the Mini App directly; Telegram passes `startapp` as start_param. */
export function referralLinkFor(code: string | null | undefined): string {
  return code ? `${MINI_APP_URL}?startapp=${encodeURIComponent(code)}` : MINI_APP_URL;
}
