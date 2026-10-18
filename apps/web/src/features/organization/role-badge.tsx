import type { Role } from '@catalogcraft/shared';
import { Badge } from '@/components/ui/badge';

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  editor: 'Editor',
  reviewer: 'Reviewer',
};

export function RoleBadge({ role }: { role: Role }) {
  return <Badge>{ROLE_LABELS[role]}</Badge>;
}
