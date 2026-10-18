import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-4 py-4 sm:py-10">
      <Card>
        <CardHeader>
          <CardTitle>
            <span className="text-xl">{title}</span>
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
      <p className="text-center text-sm text-muted-foreground">{footer}</p>
    </div>
  );
}
