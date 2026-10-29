import type { EmailMessage, Mailer } from '../src/services/email/mailer.js';

/** Keeps sent emails in memory so tests can read them (and follow their links). */
export class CaptureMailer implements Mailer {
  readonly enabled = true;
  readonly delivery = 'smtp';
  readonly sent: EmailMessage[] = [];
  fail = false;

  async send(message: EmailMessage): Promise<void> {
    if (this.fail) throw new Error('SMTP is down');
    this.sent.push(message);
  }

  /** The newest email to `to`. */
  last(to: string): EmailMessage | undefined {
    return [...this.sent].reverse().find((message) => message.to === to);
  }

  /** The token at the end of the link in the newest email to `to`, e.g. /reset-password/<token>. */
  tokenFor(to: string, path: string): string {
    const match = new RegExp(`/${path}/([A-Za-z0-9_-]{43})`).exec(this.last(to)?.text ?? '');
    if (!match) throw new Error(`No ${path} link emailed to ${to}`);
    return match[1]!;
  }
}
