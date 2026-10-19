import { createTransport } from 'nodemailer';
import type { Logger } from 'pino';
import type { AppConfig } from '../../config/env.js';

export type EmailMessage = { to: string; subject: string; text: string; html: string };

/**
 * Sends email. Business code checks `enabled` first: with email switched off,
 * features fall back gracefully (invitation links are shared by hand,
 * password resets are done by an operator).
 */
export interface Mailer {
  readonly enabled: boolean;
  send(message: EmailMessage): Promise<void>;
}

/** No email configured (the production default until SMTP is set up). */
export class DisabledMailer implements Mailer {
  readonly enabled = false;
  async send(): Promise<void> {
    throw new Error('Email is not configured.');
  }
}

/**
 * Development only: writes the email — including its link — to the server log
 * instead of sending it, so flows can be tried without an email account.
 * Refused in production by the config validation.
 */
export class LogMailer implements Mailer {
  readonly enabled = true;
  constructor(private readonly logger: Logger) {}
  async send(message: EmailMessage): Promise<void> {
    this.logger.info({ to: message.to, subject: message.subject }, `Email not sent (EMAIL_DRIVER=log):\n\n${message.text}\n`);
  }
}

/** The one thing we need from a nodemailer transport. */
type Transport = { sendMail(mail: { from: string; to: string; subject: string; text: string; html: string }): Promise<unknown> };

/** Any SMTP provider (Brevo, Resend, Postmark, Mailgun, Gmail…). */
export class SmtpMailer implements Mailer {
  readonly enabled = true;
  private readonly transport: Transport;

  constructor(
    private readonly options: { from: string; host: string; port: number; secure: boolean; user: string | undefined; password: string | undefined },
    /** Injectable for tests. */
    transport?: Transport,
  ) {
    this.transport =
      transport ??
      createTransport({
        host: options.host,
        port: options.port,
        secure: options.secure,
        // Port 587 must upgrade to TLS: never send credentials or links in clear text.
        requireTLS: !options.secure,
        auth: options.user ? { user: options.user, pass: options.password ?? '' } : undefined,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      });
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.options.from, to: message.to, subject: message.subject, text: message.text, html: message.html });
  }
}

export function createMailer(config: AppConfig, logger: Logger): Mailer {
  const { email } = config;
  if (email.driver === 'smtp' && email.smtp) return new SmtpMailer({ from: email.from, ...email.smtp });
  if (email.driver === 'log') return new LogMailer(logger);
  return new DisabledMailer();
}
