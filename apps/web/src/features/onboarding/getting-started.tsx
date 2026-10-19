import { CheckCircle2, Circle, Rocket, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import type { DashboardSummary } from '@catalogcraft/shared';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { usePermission, useRequiredSession } from '@/features/auth/use-session';
import { useMembers } from '@/features/organization/use-organization';
import { cn } from '@/lib/utils';

type Step = { id: string; label: string; detail: string; done: boolean; to: string };

const dismissKey = (organizationId: string) => `catalogcraft:getting-started-dismissed:${organizationId}`;

// Browser storage can be blocked (private windows, strict settings); the checklist still works without it.
function readDismissed(organizationId: string): boolean {
  try {
    return localStorage.getItem(dismissKey(organizationId)) === '1';
  } catch {
    return false;
  }
}

function saveDismissed(organizationId: string): void {
  try {
    localStorage.setItem(dismissKey(organizationId), '1');
  } catch {
    // Not remembered next time — harmless.
  }
}

/** First-run checklist, worked out from real data (nothing is ticked by hand). */
export function GettingStarted({ summary }: { summary: DashboardSummary }) {
  const { organization } = useRequiredSession();
  const canManageClients = usePermission('clients:manage');
  const canManageTeam = usePermission('members:manage');
  const canEditRules = usePermission('organization:update');
  const members = useMembers();
  const [dismissed, setDismissed] = useState(() => readDismissed(organization.id));

  const reviewed = summary.recentExports.length > 0 || summary.recentJobs.some((job) => job.status === 'review' || job.status === 'completed');
  const steps: Step[] = [
    {
      id: 'client',
      label: 'Create a client workspace',
      detail: 'One per brand you work for, with its tone and banned claims.',
      done: summary.clients.used > 0,
      to: canManageClients ? '/clients/new' : '/clients',
    },
    {
      id: 'import',
      label: 'Import a supplier file',
      detail: 'Upload a CSV or Excel file from a client’s page and map its columns.',
      done: summary.recentJobs.length > 0,
      to: '/clients',
    },
    { id: 'review', label: 'Generate and review AI suggestions', detail: 'Approve, edit or reject each suggestion.', done: reviewed, to: '/jobs' },
    { id: 'export', label: 'Export a clean CSV', detail: 'Only approved changes are written; everything else stays as imported.', done: summary.recentExports.length > 0, to: '/jobs' },
  ];
  if (canEditRules) {
    steps.push({
      id: 'rules',
      label: 'Set agency content rules',
      detail: 'Claims no client may ever use, like “guaranteed”.',
      done: organization.contentRules.prohibitedClaims.length > 0,
      to: '/settings/organization',
    });
  }
  if (canManageTeam && members.data) {
    steps.push({ id: 'team', label: 'Invite your team', detail: 'Share a one-time link with each teammate.', done: members.data.length > 1, to: '/settings/organization' });
  }

  const doneCount = steps.filter((step) => step.done).length;
  if (dismissed || doneCount === steps.length) return null;

  return (
    <Card className="min-w-0 animate-rise">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl tint-indigo ring-1 ring-inset">
            <Rocket className="size-5" aria-hidden />
          </span>
          <div className="flex flex-col gap-1">
            <CardTitle>Getting started</CardTitle>
            <CardDescription>
              {doneCount} of {steps.length} done
            </CardDescription>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:w-72">
          <div
            role="progressbar"
            aria-label="Getting started progress"
            aria-valuemin={0}
            aria-valuemax={steps.length}
            aria-valuenow={doneCount}
            className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
          >
            <div className="h-full rounded-full bg-primary animate-grow-x" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
          </div>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Hide the getting started checklist"
            onClick={() => {
              saveDismissed(organization.id);
              setDismissed(true);
            }}
          >
            <X aria-hidden />
          </Button>
        </div>
      </div>
      <ol className="grid gap-3 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map((step) => (
          <li
            key={step.id}
            className={cn('flex items-start gap-3 rounded-lg border p-3 text-sm', step.done ? 'border-transparent bg-muted/50' : 'bg-card')}
          >
            {step.done ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-label="Done" />
            ) : (
              <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="To do" />
            )}
            <span className="flex min-w-0 flex-col gap-0.5">
              {step.done ? (
                <span className="text-muted-foreground line-through">{step.label}</span>
              ) : (
                <Link to={step.to} className="font-medium text-primary hover:underline">
                  {step.label}
                </Link>
              )}
              {step.done ? null : <span className="text-muted-foreground">{step.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
