/**
 * AgencyOS Scheduled Automation Execution Endpoint
 *
 * POST /api/v1/automation/scheduler/run
 *
 * Security:
 * - Requires either:
 *   1. Bearer token matching `CRON_SECRET` from server environment, OR
 *   2. Valid authenticated admin user session with `workflow.update` permission.
 * - Prevents public unauthenticated triggering.
 */

import { NextResponse } from 'next/server';
import crypto from 'crypto';
import {
  runScheduledAutomation,
  type SchedulerAuthorization,
} from '@/lib/services/automation/scheduler-service';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import { requirePermission, requireOrganization } from '@/lib/permissions';

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    // Optional tenant scope carried by a cron invocation. A session caller always
    // derives its organization from the permission check below, never from input.
    const organizationId: string | undefined = undefined;

    // Recorded so the service can log who triggered the sweep and, for a
    // session caller, which tenant the permission check applied to.
    let authorization: SchedulerAuthorization;

    // 1. Check CRON_SECRET authorization with timing-safe comparison
    let isCronAuthorized = false;
    if (cronSecret && cronSecret.trim().length >= 16 && authHeader?.startsWith('Bearer ')) {
      const providedToken = authHeader.slice(7);
      if (safeCompare(providedToken, cronSecret.trim())) {
        isCronAuthorized = true;
      }
    }

    if (!isCronAuthorized) {
      // 2. Fall back to authenticated admin session
      const cookieStore = await cookies();
      const sessionResult = await auth.api.getSession({
        headers: { cookie: cookieStore.toString() },
      });

      if (!sessionResult?.session || !sessionResult.user) {
        return NextResponse.json(
          { error: 'Unauthorized: invalid cron secret or session' },
          { status: 401 }
        );
      }

      const { organizationId: orgId } = await requireOrganization(sessionResult.user.id);
      await requirePermission(sessionResult.user.id, orgId, 'workflow.update');
      authorization = { actor: 'session', organizationId: orgId };
    } else {
      // A cron sweep is system-wide unless it names an organization.
      authorization = { actor: 'cron', organizationId };
    }

    const summary = await runScheduledAutomation(authorization);
    return NextResponse.json(summary, { status: 200 });
  } catch (err) {
    const statusCode = (err as Error & { statusCode?: number }).statusCode ?? 500;
    return NextResponse.json(
      { error: (err as Error).message || 'Scheduler execution failed' },
      { status: statusCode }
    );
  }
}
