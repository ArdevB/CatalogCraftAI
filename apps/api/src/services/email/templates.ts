import type { EmailMessage } from './mailer.js';

/**
 * Plain, accessible emails: a text version and a simple HTML version with one
 * clear button. Every value inserted into HTML is escaped (names and
 * organization names are user input).
 */

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

function layout({ heading, paragraphs, button, footer }: { heading: string; paragraphs: string[]; button: { label: string; url: string }; footer: string }): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155">${escapeHtml(p)}</p>`).join('');
  return `<!doctype html><html><body style="margin:0;background:#f5f6fa;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;padding:32px;border:1px solid #e5e7eb">
<tr><td>
<p style="margin:0 0 24px;font-weight:600;font-size:15px;color:#4f46e5">CatalogCraft AI</p>
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#0f172a">${escapeHtml(heading)}</h1>
${body}
<p style="margin:24px 0"><a href="${escapeHtml(button.url)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:10px">${escapeHtml(button.label)}</a></p>
<p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#64748b">Or copy this link into your browser:<br><span style="word-break:break-all">${escapeHtml(button.url)}</span></p>
<p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#94a3b8">${escapeHtml(footer)}</p>
</td></tr></table></td></tr></table></body></html>`;
}

const text = (lines: string[]) => lines.join('\n\n');

export function verificationEmail({ to, name, url, hours }: { to: string; name: string; url: string; hours: number }): EmailMessage {
  const footer = `The link works for ${hours} hours. If you didn't create a CatalogCraft account, you can ignore this email.`;
  return {
    to,
    subject: 'Confirm your email address',
    text: text([`Hi ${name},`, 'Please confirm your email address for CatalogCraft AI:', url, footer]),
    html: layout({
      heading: 'Confirm your email address',
      paragraphs: [`Hi ${name},`, 'Please confirm this is your email address for CatalogCraft AI.'],
      button: { label: 'Confirm email address', url },
      footer,
    }),
  };
}

export function passwordResetEmail({ to, name, url, minutes }: { to: string; name: string; url: string; minutes: number }): EmailMessage {
  const footer = `The link works once, for ${minutes} minutes. If you didn't ask to reset your password, ignore this email — your password stays the same.`;
  return {
    to,
    subject: 'Reset your CatalogCraft password',
    text: text([`Hi ${name},`, 'Someone (hopefully you) asked to reset your CatalogCraft AI password. Choose a new one here:', url, footer]),
    html: layout({
      heading: 'Reset your password',
      paragraphs: [`Hi ${name},`, 'Someone (hopefully you) asked to reset your CatalogCraft AI password.'],
      button: { label: 'Choose a new password', url },
      footer,
    }),
  };
}

export function invitationEmail({
  to,
  inviterName,
  organizationName,
  role,
  url,
  days,
}: {
  to: string;
  inviterName: string;
  organizationName: string;
  role: string;
  url: string;
  days: number;
}): EmailMessage {
  const footer = `The invitation works once, only for ${to}, and expires in ${days} days. If you weren't expecting it, you can ignore this email.`;
  return {
    to,
    subject: `${inviterName} invited you to ${organizationName} on CatalogCraft`,
    text: text([`${inviterName} invited you to join ${organizationName} on CatalogCraft AI as ${role}.`, 'Accept the invitation here:', url, footer]),
    html: layout({
      heading: `Join ${organizationName}`,
      paragraphs: [`${inviterName} invited you to join ${organizationName} on CatalogCraft AI as ${role}.`],
      button: { label: 'Accept invitation', url },
      footer,
    }),
  };
}
