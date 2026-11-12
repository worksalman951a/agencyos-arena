'use client';

import * as React from 'react';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import { BentoHealthView, type HealthServiceStatus } from '@/components/admin/bento-health-view';

interface HealthClientProps {
  services: HealthServiceStatus[];
  allHealthy: boolean;
  dbError?: string;
  checkedAt: string;
}

export function HealthClient({ services, allHealthy, dbError, checkedAt }: HealthClientProps) {
  const isBento = useBentoShell();

  if (isBento) {
    return (
      <BentoHealthView
        services={services}
        allHealthy={allHealthy}
        dbError={dbError}
        checkedAt={checkedAt}
      />
    );
  }

  // Legacy view fallback
  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">System Health</h1>
        <p className="text-sm text-muted-foreground">
          Monitor database, queue, and storage health.
        </p>
      </div>

      <div className="rounded-md border bg-background p-4">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              allHealthy ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
            }`}
          >
            {allHealthy ? '● Healthy' : '● Unhealthy'}
          </span>
          <span className="text-sm text-muted-foreground">Checked {checkedAt}</span>
        </div>
        {dbError ? (
          <p className="mt-2 text-sm text-destructive">Database error: {dbError}</p>
        ) : null}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border text-sm text-muted-foreground">
              <th className="pb-3 font-medium">Service</th>
              <th className="pb-3 font-medium">Status</th>
              <th className="pb-3 font-medium text-right">Response Time</th>
            </tr>
          </thead>
          <tbody>
            {services.map((service) => (
              <tr key={service.name} className="border-b border-border hover:bg-muted/50">
                <td className="py-4 font-medium">{service.name}</td>
                <td className="py-4">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium leading-none ${
                      service.status === 'healthy'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {service.status}
                  </span>
                </td>
                <td className="py-4 text-right text-sm text-muted-foreground">
                  {service.latency !== undefined ? `${service.latency}ms` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-md border bg-background p-4">
        <h3 className="text-sm font-semibold mb-2">About Health Monitoring</h3>
        <p className="text-sm text-muted-foreground">
          The health check verifies database connectivity with a lightweight query and reports its
          latency. Queue and storage checks are not yet wired up.
        </p>
      </div>
    </div>
  );
}
