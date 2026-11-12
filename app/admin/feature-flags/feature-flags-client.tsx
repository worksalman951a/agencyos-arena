'use client';

import * as React from 'react';
import Link from 'next/link';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import {
  BentoFeatureFlagsView,
  type FeatureFlagItem,
} from '@/components/admin/bento-feature-flags-view';

interface FeatureFlagsClientProps {
  flags: FeatureFlagItem[];
}

export function FeatureFlagsClient({ flags }: FeatureFlagsClientProps) {
  const isBento = useBentoShell();

  if (isBento) {
    return <BentoFeatureFlagsView flags={flags} />;
  }

  // Legacy view fallback
  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold">Feature Flags</h1>
        <p className="text-sm text-muted-foreground">
          Enable or disable features for your organization.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border text-sm text-muted-foreground">
              <th className="pb-3 font-medium">Flag Key</th>
              <th className="pb-3 font-medium">Description</th>
              <th className="pb-3 font-medium">Status</th>
              <th className="pb-3 font-medium text-right">Created</th>
              <th className="pb-3 font-medium w-32">Actions</th>
            </tr>
          </thead>
          <tbody>
            {flags.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-8 text-muted-foreground">
                  No feature flags found.
                </td>
              </tr>
            ) : (
              flags.map((f) => (
                <tr key={f.id} className="border-b border-border hover:bg-muted/50">
                  <td className="py-4 font-medium font-mono text-sm">{f.flagKey}</td>
                  <td className="py-4 text-sm text-muted-foreground">{f.description || '—'}</td>
                  <td className="py-4">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium leading-none ${
                        f.enabled ? 'bg-green-100 text-green-800' : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {f.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                  <td className="py-4 text-right text-sm text-muted-foreground">
                    {new Date(f.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-4 text-right">
                    <Link
                      href={`/admin/feature-flags/${f.id}`}
                      className="text-sm text-accent hover:underline"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
