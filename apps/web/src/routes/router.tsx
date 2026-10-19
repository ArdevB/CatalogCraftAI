import { createBrowserRouter, type RouteObject } from 'react-router';
import { RedirectIfAuthenticated, RequireAuth } from '@/features/auth/route-guards';
import { AppLayout } from '@/layouts/app-layout';
import { AuthenticatedLayout } from '@/layouts/authenticated-layout';
import { ClientDetailPage } from '@/pages/clients/client-detail-page';
import { ClientEditPage } from '@/pages/clients/client-edit-page';
import { ClientNewPage } from '@/pages/clients/client-new-page';
import { ClientsListPage } from '@/pages/clients/clients-list-page';
import { DashboardPage } from '@/pages/dashboard-page';
import { JobPage } from '@/pages/jobs/job-page';
import { JobsListPage } from '@/pages/jobs/jobs-list-page';
import { HomePage } from '@/pages/home-page';
import { LoginPage } from '@/pages/login-page';
import { NotFoundPage } from '@/pages/not-found-page';
import { OrganizationSettingsPage } from '@/pages/organization-settings-page';
import { RegisterPage } from '@/pages/register-page';
import { RouteErrorPage } from '@/pages/route-error-page';
import { UsagePage } from '@/pages/usage-page';

export const routes: RouteObject[] = [
  {
    errorElement: <RouteErrorPage />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <HomePage /> },
          {
            element: <RedirectIfAuthenticated />,
            children: [
              { path: 'login', element: <LoginPage /> },
              { path: 'register', element: <RegisterPage /> },
            ],
          },
        ],
      },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AuthenticatedLayout />,
            children: [
              { path: 'dashboard', element: <DashboardPage /> },
              { path: 'clients', element: <ClientsListPage /> },
              { path: 'clients/new', element: <ClientNewPage /> },
              { path: 'clients/:clientId', element: <ClientDetailPage /> },
              { path: 'clients/:clientId/edit', element: <ClientEditPage /> },
              { path: 'jobs', element: <JobsListPage /> },
              { path: 'jobs/:jobId', element: <JobPage /> },
              { path: 'usage', element: <UsagePage /> },
              { path: 'settings/organization', element: <OrganizationSettingsPage /> },
            ],
          },
        ],
      },
      {
        element: <AppLayout />,
        children: [{ path: '*', element: <NotFoundPage /> }],
      },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
