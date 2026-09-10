/**
 * Sending the sign-in code to an actual inbox.
 *
 * Until this file existed, `ConsoleMailSender` printed the code to the server log and
 * `setMailSender()` was never called — which is two problems wearing one coat. **Nobody outside
 * the team could sign in**, because the only copy of the code was in a log they cannot read; and
 * every credential the system issues was written to that log in plaintext, where it outlives the
 * ten-minute TTL for as long as the log is retained. A launch blocker and a breach class, in the
 * one code path every single user walks through first.
 *
 * Three decisions:
 *
 * **1. No dependency.** Both providers are one `fetch` of one JSON body. An SDK here would be a
 * transitive dependency tree in the authentication path, for an HTTP POST.
 *
 * **2. A send that fails is not a send.** `POST /auth/email/start` answers `{sent:true}`, and
 * saying that when the provider 500'd leaves a person watching an inbox forever. So a failure
 * throws, the route turns it into an error the client can retry, and the operator gets one log
 * line with the provider's status — never the code, which is the thing that must not be logged.
 *
 * **3. The code is never in a URL and never in a link.** A magic link is one forwarded email away
 * from being someone else's session; six digits typed into an app that is already open cannot be
 * clicked out of a mail client by accident.
 */
import { t, type Locale } from "@rpgllm/shared";
import { envNum, envStr } from "../env";
import { logLine } from "../middleware/request-log";
import type { MailSender } from "../auth-codes";

export const mailProvider = (): string => envStr("MAIL_PROVIDER", "console").trim().toLowerCase();
export const mailFrom = (): string => envStr("MAIL_FROM", "");
export const mailReplyTo = (): string => envStr("MAIL_REPLY_TO", "");
export const mailApiKey = (): string => envStr("MAIL_API_KEY", "");
export const mailTimeoutMs = (): number => envNum("MAIL_TIMEOUT_MS", 8_000);

/** The providers this build can talk to. Both are a single JSON POST. */
export const MAIL_PROVIDERS = ["resend", "postmark"] as const;
export type MailProvider = (typeof MAIL_PROVIDERS)[number];
export const isMailProvider = (v: string): v is MailProvider => (MAIL_PROVIDERS as readonly string[]).includes(v);

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

interface ProviderRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * The body each provider wants. Kept as data rather than as a class per provider: the difference
 * between them really is three field names and a header.
 */
function requestFor(
  provider: MailProvider,
  key: string,
  from: string,
  replyTo: string,
  m: MailMessage,
): ProviderRequest {
  if (provider === "postmark") {
    return {
      url: "https://api.postmarkapp.com/email",
      headers: { "content-type": "application/json", accept: "application/json", "x-postmark-server-token": key },
      body: {
        From: from,
        To: m.to,
        Subject: m.subject,
        TextBody: m.text,
        HtmlBody: m.html,
        MessageStream: envStr("POSTMARK_MESSAGE_STREAM", "outbound"),
        ...(replyTo ? { ReplyTo: replyTo } : {}),
      },
    };
  }
  return {
    url: "https://api.resend.com/emails",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: {
      from,
      to: [m.to],
      subject: m.subject,
      text: m.text,
      html: m.html,
      ...(replyTo ? { reply_to: replyTo } : {}),
    },
  };
}

/** The whole message, in the reader's language. */
export function loginCodeMessage(to: string, code: string, locale: Locale, ttlMinutes: number): MailMessage {
  const expiry = `${t(locale, "mailCodeExpiryLead")} ${ttlMinutes} ${t(locale, "mailCodeExpiry")}`;
  const text = [t(locale, "mailCodeIntro"), "", code, "", expiry, "", t(locale, "mailCodeIgnore")].join("\n");
  /*
   * Deliberately plain HTML with inline styles: an email client strips <style> blocks, ignores
   * custom properties and may show the text-only part anyway. The one thing worth styling is the
   * code itself, because it is going to be read off a phone and typed into another one.
   */
  const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = [
    `<div style="font-family:-apple-system,Segoe UI,Hiragino Sans,Noto Sans JP,sans-serif;font-size:16px;line-height:1.6;color:#14141F">`,
    `<p>${esc(t(locale, "mailCodeIntro"))}</p>`,
    `<p style="font-size:32px;font-weight:700;letter-spacing:0.18em;margin:24px 0">${esc(code)}</p>`,
    `<p style="color:#6E6E8A">${esc(expiry)}</p>`,
    `<p style="color:#6E6E8A;font-size:14px">${esc(t(locale, "mailCodeIgnore"))}</p>`,
    `</div>`,
  ].join("");
  return { to, subject: t(locale, "mailCodeSubject"), text, html };
}

export class MailSendError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
    readonly detail: string,
  ) {
    super(`mail provider ${provider} refused the message (${status})`);
    this.name = "MailSendError";
  }
}

export interface HttpMailOptions {
  provider: MailProvider;
  apiKey: string;
  from: string;
  replyTo?: string;
  ttlMinutes: number;
  /** injected in tests; defaults to the global */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** how a returning player's language is discovered; unset ⇒ always `en` */
  localeFor?: (email: string) => Promise<Locale>;
}

export class HttpMailSender implements MailSender {
  constructor(private readonly opts: HttpMailOptions) {}

  async sendLoginCode(email: string, code: string): Promise<void> {
    const locale = this.opts.localeFor ? await this.opts.localeFor(email) : "en";
    const message = loginCodeMessage(email, code, locale, this.opts.ttlMinutes);
    const req = requestFor(this.opts.provider, this.opts.apiKey, this.opts.from, this.opts.replyTo ?? "", message);
    const doFetch = this.opts.fetchImpl ?? fetch;
    const timeout = this.opts.timeoutMs ?? mailTimeoutMs();

    /*
     * One retry, and only for the failures a retry can fix: a network error or a 5xx. A 4xx is a
     * configuration mistake (bad key, unverified sender) and retrying it just doubles the wait a
     * person spends staring at a spinner before being told to try again.
     */
    let last: { status: number; detail: string } | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const res = await doFetch(req.url, {
          method: "POST",
          headers: req.headers,
          body: JSON.stringify(req.body),
          signal: AbortSignal.timeout(timeout),
        });
        if (res.ok) return;
        const detail = (await res.text().catch(() => "")).slice(0, 300);
        last = { status: res.status, detail };
        // Never the code, never the body we sent: this line goes to a log an operator greps.
        logLine({ level: "warn", msg: "mail.send.failed", provider: this.opts.provider, status: res.status, attempt });
        if (res.status < 500) break;
      } catch (err: unknown) {
        last = { status: 0, detail: String(err).slice(0, 300) };
        logLine({
          level: "warn",
          msg: "mail.send.error",
          provider: this.opts.provider,
          attempt,
          error: String(err).slice(0, 200),
        });
      }
    }
    throw new MailSendError(this.opts.provider, last?.status ?? 0, last?.detail ?? "unknown");
  }
}

/**
 * The sender the process should use, from the environment. Returns `null` for `console`, which is
 * the caller's cue to leave the default in place — and which `config-guard.ts` refuses in
 * production, so "no mail configured" cannot reach a real user quietly.
 */
export function mailSenderFromEnv(opts: {
  ttlMinutes: number;
  localeFor?: (email: string) => Promise<Locale>;
}): MailSender | null {
  const provider = mailProvider();
  if (!isMailProvider(provider)) return null;
  return new HttpMailSender({
    provider,
    apiKey: mailApiKey(),
    from: mailFrom(),
    ...(mailReplyTo() ? { replyTo: mailReplyTo() } : {}),
    ttlMinutes: opts.ttlMinutes,
    ...(opts.localeFor ? { localeFor: opts.localeFor } : {}),
  });
}
