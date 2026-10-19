import { Loader2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { FormField } from '@/components/form-field';
import { errorMessage } from '@/components/page-states';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useRequiredSession } from '@/features/auth/use-session';
import { useDeleteOrganization } from './use-organization';

/** Owner only. Typing the exact name is the confirmation (the API checks it too). */
export function DeleteOrganizationCard() {
  const { organization } = useRequiredSession();
  const [confirmName, setConfirmName] = useState('');
  const remove = useDeleteOrganization();
  const navigate = useNavigate();
  const matches = confirmName.trim() === organization.name;

  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <CardTitle>Delete organization</CardTitle>
        <CardDescription>
          Permanently deletes {organization.name} and everything in it: clients, brand profiles, imported files, products, AI suggestions,
          exports, invitations, usage history and the activity log. Team members lose access; their accounts are kept. This can’t be
          undone — export anything you need first.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!matches) return;
            remove.mutate(
              { confirmName },
              { onSuccess: (session) => void navigate(session ? '/dashboard' : '/login', { replace: true }) },
            );
          }}
        >
          {remove.isError ? <Alert variant="destructive">{errorMessage(remove.error)}</Alert> : null}
          <FormField
            label={`Type “${organization.name}” to confirm`}
            autoComplete="off"
            value={confirmName}
            onChange={(event) => setConfirmName(event.target.value)}
          />
          <div>
            <Button type="submit" variant="destructive" disabled={!matches || remove.isPending}>
              {remove.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
              Delete organization permanently
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
