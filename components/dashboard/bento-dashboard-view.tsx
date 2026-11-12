'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  TrendingUp,
  Briefcase,
  FileText,
  DollarSign,
  Layers,
  ArrowRight,
  ArrowUpRight,
} from 'lucide-react';
import { Panel, StatusPill, StatStrip } from '@/components/ui/premium/primitives';
import { Button } from '@/components/ui/button';
import { formatMinorUnitsAsCurrency } from '@/lib/currencies';
import type {
  DashboardMetrics,
  OpenOpportunities,
  ActivityEntry,
  CurrencyTotals,
  Permissioned,
} from '@/lib/services/dashboard/dashboard-service';
import './bento-dashboard.css';

interface BentoDashboardViewProps {
  metrics: Permissioned<DashboardMetrics>;
  opportunities: Permissioned<OpenOpportunities>;
  activity: Permissioned<ActivityEntry[]>;
  canCreateProject: boolean;
  canReadProjects: boolean;
}

const money = (totals: CurrencyTotals, key: keyof Omit<CurrencyTotals, 'currency'>) =>
  formatMinorUnitsAsCurrency(totals[key], totals.currency);

function relativeTime(date: Date): string {
  const diffMs = new Date(date).getTime() - Date.now();
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

export function BentoDashboardView({
  metrics,
  opportunities,
  activity,
  canCreateProject,
  canReadProjects,
}: BentoDashboardViewProps) {
  const headline = metrics.ok ? metrics.data.headline : null;
  const invoicedMinor = headline?.invoicedMinor ?? 0;
  const collectedMinor = headline?.collectedMinor ?? 0;
  const outstandingMinor = headline?.outstandingMinor ?? 0;
  const overdueMinor = headline?.overdueMinor ?? 0;
  const currency = headline?.currency ?? 'USD';

  // Collection percentage calculation
  const collectionPct =
    invoicedMinor > 0 ? Math.min(100, Math.round((collectedMinor / invoicedMinor) * 100)) : 0;

  return (
    <div className="bento-dashboard">
      {/* ── Dashboard Header ───────────────────────────────────────── */}
      <div className="bento-dashboard__head">
        <div>
          <h1 className="bento-dashboard__title">Executive Dashboard</h1>
          <p className="bento-dashboard__sub">
            {metrics.ok
              ? `Real-time financial telemetry in ${metrics.data.defaultCurrency}`
              : 'Workspace at a glance'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {canReadProjects && (
            <Button asChild variant="outline" size="sm" className="h-8 text-xs">
              <Link href="/projects">
                <Briefcase size={13} className="mr-1.5" />
                View Projects
              </Link>
            </Button>
          )}
          {canCreateProject && (
            <Button
              asChild
              size="sm"
              className="h-8 text-xs bg-emerald-700 hover:bg-emerald-800 text-white"
            >
              <Link href="/projects/new">
                <Layers size={13} className="mr-1.5" />
                New Project
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* ── KPI StatStrip ─────────────────────────────────────────── */}
      {metrics.ok && (
        <StatStrip
          stats={[
            {
              label: 'Total Invoiced',
              value: money(metrics.data.headline, 'invoicedMinor'),
              note: `${metrics.data.issuedInvoiceCount} issued invoices`,
              tone: 'ok',
            },
            {
              label: 'Total Collected',
              value: money(metrics.data.headline, 'collectedMinor'),
              note: `${collectionPct}% collection rate`,
              tone: 'ok',
              meter: collectionPct / 100,
            },
            {
              label: 'Outstanding',
              value: money(metrics.data.headline, 'outstandingMinor'),
              note: 'Invoiced awaiting settlement',
              tone: outstandingMinor > 0 ? 'warn' : 'ok',
            },
            {
              label: 'Overdue Past Due',
              value: money(metrics.data.headline, 'overdueMinor'),
              note: overdueMinor > 0 ? 'Requires attention' : 'Zero past due',
              tone: overdueMinor > 0 ? 'danger' : 'ok',
            },
          ]}
        />
      )}

      {/* ── 6-Column Bento Grid Composition ────────────────────────── */}
      <div className="bento-grid">
        {/* Tile 1: Lead Hero Tile (3 Columns) */}
        <div className="bento-col-3 bento-tile--lead">
          <div>
            <div className="flex items-center justify-between">
              <span className="bento-tile__label">Capital Inflow &amp; Realization</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-semibold text-white">
                <TrendingUp size={11} /> {collectionPct}%
              </span>
            </div>

            <div className="bento-tile__num">
              {metrics.ok ? money(metrics.data.headline, 'collectedMinor') : '$0.00'}
              <span className="bento-tile__unit">{currency}</span>
            </div>

            <div className="bento-progress">
              <span className="bento-progress__fill" style={{ width: `${collectionPct}%` }} />
            </div>

            <div className="bento-legend">
              <span className="bento-legend__item">
                <i className="bento-legend__dot" />
                {metrics.ok ? money(metrics.data.headline, 'collectedMinor') : '$0.00'} collected
              </span>
              <span className="bento-legend__item opacity-80">
                <i className="bento-legend__dot bg-white/40" />
                {metrics.ok ? money(metrics.data.headline, 'outstandingMinor') : '$0.00'} open
              </span>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-white/10 text-[11px] text-white/80">
            {metrics.ok && metrics.data.invoiceCount > 0
              ? `${metrics.data.invoiceCount} lifetime billing cycles tracked across all active client accounts.`
              : 'Issued invoices will appear here once generated in the Finance module.'}
          </div>
        </div>

        {/* Tile 2: Open Pipeline & Opportunities (3 Columns) */}
        <div className="bento-col-3 bento-card">
          <div className="bento-card__head">
            <div>
              <div className="bento-card__title">Sales Pipeline Value</div>
              <div className="bento-card__sub">Active client proposals &amp; negotiations</div>
            </div>
            <StatusPill tone="accent">CRM</StatusPill>
          </div>

          <div className="my-auto py-2">
            <div className="bento-card__num">
              {opportunities.ok
                ? formatMinorUnitsAsCurrency(
                    opportunities.data.defaultCurrencyValueMinor,
                    opportunities.data.defaultCurrency
                  )
                : '—'}
              <span className="bento-card__unit">
                {opportunities.ok ? opportunities.data.defaultCurrency : ''}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {opportunities.ok
                ? `${opportunities.data.count} open opportunit${opportunities.data.count === 1 ? 'y' : 'ies'} in current pipeline stages`
                : 'Pipeline telemetry restricted'}
            </p>
          </div>

          <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-xs">
            <Link
              href="/crm/opportunities"
              className="font-medium text-emerald-700 hover:text-emerald-800 dark:text-emerald-400 inline-flex items-center gap-1"
            >
              Open Pipeline Directory <ArrowRight size={12} />
            </Link>
            <span className="text-[11px] text-muted-foreground">Updated in real-time</span>
          </div>
        </div>

        {/* Tile 3: Operations & Activity Log (4 Columns) */}
        <div className="bento-col-4">
          <Panel
            title="Real-Time Workspace Activity"
            meta="Audit log of state transitions and operations"
            action={
              <Button asChild variant="outline" size="sm" className="h-7 text-xs">
                <Link href="/admin/audit-logs">Full Audit Trail</Link>
              </Button>
            }
          >
            {activity.ok ? (
              activity.data.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  No activity recorded yet. Start by creating a contact, lead or invoice.
                </div>
              ) : (
                <div className="bento-activity-list">
                  {activity.data.map((entry) => (
                    <div key={entry.id} className="bento-activity-row">
                      <div className="bento-activity-row__body">
                        <div>
                          <span className="bento-activity-row__actor">
                            {entry.actorName ?? 'System User'}
                          </span>{' '}
                          <span className="bento-activity-row__action">
                            {actionLabel(entry.action, entry.entityType)}
                          </span>
                        </div>
                        <div className="bento-activity-row__meta">{entry.action}</div>
                      </div>
                      <time
                        className="bento-activity-row__time"
                        dateTime={new Date(entry.createdAt).toISOString()}
                      >
                        {relativeTime(new Date(entry.createdAt))}
                      </time>
                    </div>
                  ))}
                </div>
              )
            ) : (
              <div className="py-8 text-center text-xs text-muted-foreground">
                You do not have permission to view activity logs.
              </div>
            )}
          </Panel>
        </div>

        {/* Tile 4: Quick Launch & System Health (2 Columns) */}
        <div className="bento-col-2 flex flex-col gap-4">
          <Panel title="Quick Dispatch" meta="Standard operational workflows">
            <div className="flex flex-col gap-2">
              <Button asChild variant="outline" size="sm" className="justify-between text-xs h-8">
                <Link href="/crm/contacts/new">
                  <span>+ Create Contact</span>
                  <ArrowRight size={12} className="text-muted-foreground" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="justify-between text-xs h-8">
                <Link href="/finance/invoices/new">
                  <span>+ Generate Invoice</span>
                  <DollarSign size={12} className="text-muted-foreground" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="justify-between text-xs h-8">
                <Link href="/sales/proposals/new">
                  <span>+ Draft Proposal</span>
                  <FileText size={12} className="text-muted-foreground" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="justify-between text-xs h-8">
                <Link href="/portal">
                  <span>Client Portal Workspace</span>
                  <ArrowUpRight size={12} className="text-muted-foreground" />
                </Link>
              </Button>
            </div>
          </Panel>

          {metrics.ok && metrics.data.otherCurrencies.length > 0 && (
            <Panel title="Multi-Currency Ledger" meta="Independent currency totals">
              <div className="space-y-2 text-xs">
                {metrics.data.otherCurrencies.map((tot) => (
                  <div
                    key={tot.currency}
                    className="flex items-center justify-between py-1 border-b"
                  >
                    <span className="font-semibold">{tot.currency}</span>
                    <span className="text-muted-foreground">
                      Collected {money(tot, 'collectedMinor')}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
