/**
 * AgencyOS Automation Event API
 *
 * POST /api/v1/automation/events - Dispatch a record event to the organization's rules.
 *
 * Requires `workflow.read` in the caller's organization. The record is matched
 * against enabled rules, and each (rule, record, transition) executes at most
 * once thanks to the dedupe key on WorkflowExecution.
 */

import { NextResponse } from 'next/server';

import { dispatchWorkflowEvent } from '@/lib/services/automation/run-workflow-service';
import { WORKFLOW_TRIGGERS } from '@/lib/automation/rules';
import { apiErrorFrom } from '@/lib/api/route-error';
import { z } from 'zod';

const eventSchema = z
  .object({
    type: z.enum(WORKFLOW_TRIGGERS),
    recordType: z.string().trim().min(1).max(80),
    recordId: z.string().trim().min(1).max(120),
    record: z.record(z.string(), z.unknown()).default({}),
    previousStatus: z.string().max(80).nullable().optional(),
  })
  .strict();

export async function POST(request: Request) {
  try {
    const parsed = eventSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', issues: parsed.error.issues },
        { status: 400 }
      );
    }
    return NextResponse.json(await dispatchWorkflowEvent(parsed.data), { status: 200 });
  } catch (err) {
    const { status, message } = apiErrorFrom(err);
    return NextResponse.json({ error: message }, { status });
  }
}
