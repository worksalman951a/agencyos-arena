/**
 * CRM module layout.
 *
 * Renders the shared authenticated application shell (single sidebar/header
 * implementation, permission-aware navigation). Session validation and
 * redirect-to-login live in the shell, not here, so every module behaves the
 * same way.
 */

export const dynamic = 'force-dynamic';

import { ModuleShell } from '@/components/server/module-shell';

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  return <ModuleShell>{children}</ModuleShell>;
}
