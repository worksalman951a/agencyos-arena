import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getCurrentPermissions } from '@/lib/current-user';
import {
  getDashboardMetrics,
  getOpenOpportunities,
  getRecentActivity,
  type CurrencyTotals,
} from '@/lib/services/dashboard/dashboard-service';
import { formatMinorUnitsAsCurrency } from '@/lib/currencies';

/**
 * AgencyOS dashboard page.
 *
 * Every number on this page comes from the database for the signed-in user's
 * organization — the previous version rendered `$0.00` and "No invoices yet"
 * unconditionally, which stayed on screen after real invoices existed.
 *
 * Authorization:
 *  • the page re-validates the session before rendering (second boundary after
 *    the module layout),
 *  • each service call applies its own permission check and organization
 *    scoping; a user without `invoice.read` sees an explanation instead of
 *    fabricated zeros,
 *  • actions are only rendered when the matching permission is present.
 *
 * Money: totals are integer minor units per currency. Currencies are never
 * converted or summed together — the org default currency is the headline and
 * any other currency with activity is listed separately.
 */

export const dynamic = 'force-dynamic';

const money = (totals: CurrencyTotals, key: keyof Omit<CurrencyTotals, 'currency'>) =>
  formatMinorUnitsAsCurrency(totals[key], totals.currency);

function relativeTime(date: Date): string {
  const diffMs = date.getTime() - Date.now();
  const minutes = Math.round(diffMs / 60000);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour');
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return formatter.format(days, 'day');
  const months = Math.round(days / 30);
  return formatter.format(months, 'month');
}

function actionLabel(action: string, entityType: string): string {
  const [verb] = action.split('.');
  const labels: Record<string, string> = {
    create: 'created',
    update: 'updated',
    delete: 'deleted',
    soft_delete: 'archived',
    payment: 'recorded a payment on',
    record_payment: 'recorded a payment on',
    convert: 'converted',
    status: 'changed the status of',
    send: 'sent',
    accept: 'accepted',
  };
  const entity = entityType.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return `${labels[verb] ?? verb.replace(/_/g, ' ')} ${entity}`;
}

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const result = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!result?.session || !result.user) {
    redirect('/login');
  }

  const [permissions, metrics, opportunities, activity] = await Promise.all([
    getCurrentPermissions(),
    getDashboardMetrics(),
    getOpenOpportunities(),
    getRecentActivity(8),
  ]);

  const canCreateProject = permissions.has('project.create');
  const canReadProjects = permissions.has('project.read');

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {metrics.ok
              ? `Financial summary in ${metrics.data.defaultCurrency}`
              : 'Your workspace at a glance'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canReadProjects && (
            <Link
              href="/projects"
              className="rounded-md bg-muted px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/80"
            >
              View Projects
            </Link>
          )}
          {/* The old control was a <button> with no handler; it now navigates to
              the existing new-project workflow, and only when the user may
              actually create one (the server rejects the rest). */}
          {canCreateProject && (
            <Link
              href="/projects/new"
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90"
            >
              New Project
            </Link>
          )}
        </div>
      </div>

      {metrics.ok ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardHeader>
              <CardTitle>Total Invoiced</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-start gap-2">
              <span className="text-3xl font-bold">
                {money(metrics.data.headline, 'invoicedMinor')}
              </span>
              <span className="text-sm text-muted-foreground">
                {metrics.data.issuedInvoiceCount > 0
                  ? `${metrics.data.issuedInvoiceCount} issued invoice${
                      metrics.data.issuedInvoiceCount === 1 ? '' : 's'
                    }`
                  : metrics.data.invoiceCount > 0
                    ? 'Issued invoices appear here once sent'
                    : 'No invoices yet'}
              </span>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Total Collected</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-start gap-2">
              <span className="text-3xl font-bold">
                {money(metrics.data.headline, 'collectedMinor')}
              </span>
              <span className="text-sm text-muted-foreground">
                Recorded payments on issued invoices
              </span>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Outstanding Receivables</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-start gap-2">
              <span className="text-3xl font-bold">
                {money(metrics.data.headline, 'outstandingMinor')}
              </span>
              <span className="text-sm text-muted-foreground">Invoiced but not yet paid</span>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Overdue Amount</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-start gap-2">
              <span className="text-3xl font-bold">
                {money(metrics.data.headline, 'overdueMinor')}
              </span>
              <span className="text-sm text-muted-foreground">
                {metrics.data.headline.overdueMinor > 0 ? 'Past the due date' : 'Nothing past due'}
              </span>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card>
          <CardContent className="py-6">
            <p className="text-sm text-muted-foreground">
              Financial metrics are hidden because your role does not include permission to view
              invoices. Ask an administrator if you need access.
            </p>
          </CardContent>
        </Card>
      )}

      {metrics.ok && metrics.data.otherCurrencies.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Other currencies</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Amounts are shown in their original currency — no exchange-rate conversion is applied,
              so they are deliberately not added to the totals above.
            </p>
            <ul className="divide-y divide-border">
              {metrics.data.otherCurrencies.map((totals) => (
                <li
                  key={totals.currency}
                  className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="font-medium">{totals.currency}</span>
                  <span className="text-sm text-muted-foreground">
                    Collected {money(totals, 'collectedMinor')} · Outstanding{' '}
                    {money(totals, 'outstandingMinor')} · Overdue {money(totals, 'overdueMinor')}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Open Opportunities</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-start gap-2">
            {opportunities.ok ? (
              <>
                <span className="text-3xl font-bold">{opportunities.data.count}</span>
                <span className="text-sm text-muted-foreground">
                  {opportunities.data.count === 0
                    ? 'Pipeline is empty'
                    : `${formatMinorUnitsAsCurrency(
                        opportunities.data.defaultCurrencyValueMinor,
                        opportunities.data.defaultCurrency
                      )} open pipeline in ${opportunities.data.defaultCurrency}`}
                </span>
              </>
            ) : (
              <span className="text-sm text-muted-foreground">
                You do not have permission to view opportunities.
              </span>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {activity.ok ? (
              activity.data.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No activity yet. Start by creating a contact, lead or invoice.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {activity.data.map((entry) => (
                    <li key={entry.id} className="flex items-start justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm">
                          <span className="font-medium">{entry.actorName ?? 'Someone'}</span>{' '}
                          {actionLabel(entry.action, entry.entityType)}
                        </p>
                        <p className="text-xs text-muted-foreground">{entry.action}</p>
                      </div>
                      <time
                        className="shrink-0 text-xs text-muted-foreground"
                        dateTime={entry.createdAt.toISOString()}
                      >
                        {relativeTime(entry.createdAt)}
                      </time>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">
                You do not have permission to view the activity log.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
