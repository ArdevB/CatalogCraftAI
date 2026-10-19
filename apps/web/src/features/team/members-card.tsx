import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ASSIGNABLE_ROLES, type AssignableRole, type Member, type Role } from '@catalogcraft/shared';
import { ErrorState, errorMessage, LoadingState } from '@/components/page-states';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { usePermission, useRequiredSession } from '@/features/auth/use-session';
import { ROLE_LABELS, RoleBadge } from '@/features/organization/role-badge';
import { useMembers } from '@/features/organization/use-organization';
import { useChangeMemberRole, useRemoveMember } from './use-team';

/** Mirrors the API's rules so people only see controls that will work. The API enforces them. */
function canManageMember(myRole: Role, myUserId: string, member: Member): boolean {
  if (myRole !== 'owner' && myRole !== 'admin') return false;
  if (member.role === 'owner' || member.userId === myUserId) return false;
  return !(myRole === 'admin' && member.role === 'admin');
}

function RemoveMember({ member }: { member: Member }) {
  const [confirming, setConfirming] = useState(false);
  const remove = useRemoveMember();

  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)} aria-label={`Remove ${member.name}`}>
        Remove
      </Button>
    );
  }
  return (
    <span role="alertdialog" aria-label={`Remove ${member.name}?`} className="inline-flex flex-wrap items-center gap-2">
      {remove.isError ? <span className="text-destructive">{errorMessage(remove.error)}</span> : null}
      <Button variant="destructive" size="sm" disabled={remove.isPending} onClick={() => remove.mutate({ membershipId: member.membershipId, self: false })}>
        {remove.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        Remove {member.name.split(' ')[0]}
      </Button>
      <Button variant="outline" size="sm" disabled={remove.isPending} onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </span>
  );
}

function LeaveOrganization({ membershipId, organizationName }: { membershipId: string; organizationName: string }) {
  const [confirming, setConfirming] = useState(false);
  const leave = useRemoveMember();
  const navigate = useNavigate();

  if (!confirming) {
    return (
      <div>
        <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
          Leave organization
        </Button>
      </div>
    );
  }
  return (
    <div role="alertdialog" aria-labelledby="leave-title" className="flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4">
      <p id="leave-title" className="text-sm font-medium">
        Leave {organizationName}? You’ll lose access straight away, and need a new invitation to come back.
      </p>
      {leave.isError ? <Alert variant="destructive">{errorMessage(leave.error)}</Alert> : null}
      <div className="flex gap-2">
        <Button
          variant="destructive"
          size="sm"
          disabled={leave.isPending}
          onClick={() => leave.mutate({ membershipId, self: true }, { onSuccess: () => void navigate('/dashboard', { replace: true }) })}
        >
          {leave.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Leave
        </Button>
        <Button variant="outline" size="sm" disabled={leave.isPending} onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function MembersCard() {
  const members = useMembers();
  const { user, role: myRole, organization } = useRequiredSession();
  const canManage = usePermission('members:manage');
  const changeRole = useChangeMemberRole();
  const roleOptions = ASSIGNABLE_ROLES.filter((option) => myRole === 'owner' || option !== 'admin');
  const me = members.data?.find((member) => member.userId === user.id);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Team members</CardTitle>
        <CardDescription>
          {canManage ? 'Change roles or remove people. Changes apply on their next click.' : 'Everyone with access to this organization and their role.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {members.isPending ? (
          <LoadingState label="Loading members…" />
        ) : members.isError ? (
          <ErrorState
            title="Could not load team members"
            error={members.error}
            onRetry={() => void members.refetch()}
            isRetrying={members.isFetching}
          />
        ) : (
          <>
            {changeRole.isError ? <Alert variant="destructive">{errorMessage(changeRole.error)}</Alert> : null}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th scope="col" className="py-2 pr-4 font-medium">Name</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Email</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Role</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Joined</th>
                    {canManage ? <th scope="col" className="py-2 font-medium"><span className="sr-only">Actions</span></th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {members.data.map((member) => {
                    const manageable = canManageMember(myRole, user.id, member);
                    return (
                      <tr key={member.membershipId}>
                        <td className="py-2.5 pr-4 font-medium">
                          {member.name}
                          {member.userId === user.id ? <span className="ml-1.5 text-muted-foreground">(you)</span> : null}
                        </td>
                        <td className="py-2.5 pr-4 text-muted-foreground">{member.email}</td>
                        <td className="py-2.5 pr-4">
                          {manageable ? (
                            <Select
                              aria-label={`Role for ${member.name}`}
                              className="h-8 w-32"
                              value={member.role}
                              disabled={changeRole.isPending}
                              onChange={(event) =>
                                changeRole.mutate({ membershipId: member.membershipId, role: event.target.value as AssignableRole })
                              }
                            >
                              {roleOptions.map((option) => (
                                <option key={option} value={option}>
                                  {ROLE_LABELS[option]}
                                </option>
                              ))}
                            </Select>
                          ) : (
                            <RoleBadge role={member.role} />
                          )}
                        </td>
                        <td className="py-2.5 pr-4 text-muted-foreground">{new Date(member.joinedAt).toLocaleDateString()}</td>
                        {canManage ? <td className="py-2.5 text-right">{manageable ? <RemoveMember member={member} /> : null}</td> : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {me && me.role !== 'owner' ? <LeaveOrganization membershipId={me.membershipId} organizationName={organization.name} /> : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
