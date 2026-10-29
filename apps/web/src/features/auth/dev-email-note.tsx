import { Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFeatures } from './use-session';

/**
 * In development (EMAIL_DRIVER=log) emails are not really sent — they are
 * printed in the API terminal. Say so wherever an email is mentioned, so
 * nobody waits for something that will never reach their inbox.
 */
export function DevEmailNote({ className }: { className?: string }) {
  const features = useFeatures();
  if (features.data?.emailDelivery !== 'log') return null;
  return (
    <p className={cn('flex items-start gap-2 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground', className)}>
      <Terminal className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        Development mode: emails aren’t really sent. Open the link printed in the API terminal (the window running <code>npm run dev</code>). To
        send real emails, set up SMTP — see docs/DEPLOYMENT.md.
      </span>
    </p>
  );
}
