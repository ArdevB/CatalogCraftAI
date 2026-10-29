import { Loader2, MailWarning, X } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '@/components/page-states';
import { Button } from '@/components/ui/button';
import { DevEmailNote } from './dev-email-note';
import { useFeatures, useRequiredSession, useResendVerification } from './use-session';

/** Reminds a signed-in user to confirm their email (only when the server can send email). */
export function VerifyEmailBanner() {
  const { user } = useRequiredSession();
  const features = useFeatures();
  const resend = useResendVerification();
  const [hidden, setHidden] = useState(false);

  if (user.emailVerified || hidden || !features.data?.email) return null;
  return (
    <div role="status" className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm tint-amber ring-1 ring-inset animate-rise">
      <MailWarning className="size-5 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">
        {resend.isSuccess
          ? `We sent a new link to ${user.email}. It may take a minute to arrive.`
          : resend.isError
            ? errorMessage(resend.error)
            : `Please confirm your email address — we sent a link to ${user.email}.`}
      </p>
      {!resend.isSuccess ? (
        <Button size="sm" variant="outline" disabled={resend.isPending} onClick={() => resend.mutate()}>
          {resend.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Resend link
        </Button>
      ) : null}
      <button type="button" aria-label="Hide this reminder" onClick={() => setHidden(true)} className="grid size-7 place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/10">
        <X className="size-4" aria-hidden />
      </button>
      <DevEmailNote className="basis-full bg-card/60" />
    </div>
  );
}
