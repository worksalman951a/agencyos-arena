'use server';

/**
 * Automation workflow rules: CRUD, validation and execution history.
 *
 * Defects this replaces:
 * - `createWorkflowRule` accepted any JSON (including actions nothing could
 *   execute) so rules looked saved but could never run;
 * - `listWorkflowExecutions` built a `where` filter and then never used it, so
 *   `GET /workflows/{id}/executions` returned *every* rule's executions;
 * - a rule could be deleted while its executions remained, leaving orphaned
 *   history;
 * - nothing recorded which trigger/action combinations were unsupported.
 *
 * Rule execution lives in `run-workflow-service.ts`; this module is the
 * read/write surface plus the shared organization guard.
 */

import { prisma } from '@/lib/db';
import { requirePermission, requireOrganization, type AuthorizedUser } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';

import {
  workflowRuleCreateSchema,
  workflowRuleUpdateSchema,
  type WorkflowTrigger,
  type WorkflowConditions,
  type WorkflowActions,
} from '@/lib/automation/rules';

export interface WorkflowRuleResponse {
  id: string;
  organizationId: string;
  name: string;
  trigger: WorkflowTrigger;
  conditions: WorkflowConditions;
  actions: WorkflowActions;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkflowExecutionResponse {
  id: string;
  organizationId: string;
  ruleId: string;
  recordType: string;
  recordId: string;
  status: string;
  resultLog: Record<string, unknown> | null;
  attempts: number;
  lastAttemptAt: Date | null;
  createdAt: Date;
}

function codedError(message: string, statusCode: number, issues?: unknown[]) {
  const error = new Error(message) as Error & { statusCode: number; issues?: unknown };
  error.statusCode = statusCode;
  if (issues) error.issues = issues;
  return error;
}

async function getAuthorizedUser(): Promise<AuthorizedUser> {
  const cookieStore = await cookies();
  const result = await auth.api.getSession({
    headers: { cookie: cookieStore.toString() },
  });

  if (!result?.session || !result.user) {
    throw codedError('Unauthenticated', 401);
  }

  const user = result.user as { role?: string; organizationId?: string };
  const { organizationId } = await requireOrganization(result.user.id);
  return {
    userId: result.user.id,
    organizationId,
    email: result.user.email ?? '',
    role: user.role ?? 'employee',
  };
}

async function createAuditLog({
  actorId,
  actorName,
  action,
  entityType,
  entityId,
  before,
  after,
  metadata,
  organizationId,
}: {
  actorId: string;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  organizationId: string;
}) {
  await prisma.auditLog.create({
    data: {
      actorId,
      actorName,
      action,
      entityType,
      entityId,
      before: before ?? null,
      after: after ?? null,
      metadata: metadata ?? null,
      organizationId,
    },
  });
}

interface WorkflowRuleRecord {
  id: string;
  organizationId: string;
  name: string;
  trigger: string;
  conditions: unknown;
  actions: unknown;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function serializeRule(rule: WorkflowRuleRecord): WorkflowRuleResponse {
  return {
    id: rule.id,
    organizationId: rule.organizationId,
    name: rule.name,
    trigger: rule.trigger as WorkflowTrigger,
    conditions: (rule.conditions ?? {}) as WorkflowConditions,
    actions: (rule.actions ?? { list: [] }) as WorkflowActions,
    enabled: rule.enabled,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}

interface WorkflowExecutionRecord {
  id: string;
  organizationId: string;
  ruleId: string;
  recordType: string;
  recordId: string;
  status: string;
  resultLog: unknown;
  attempts: number;
  lastAttemptAt: Date | null;
  createdAt: Date;
}

function serializeExecution(execution: WorkflowExecutionRecord): WorkflowExecutionResponse {
  return {
    id: execution.id,
    organizationId: execution.organizationId,
    ruleId: execution.ruleId,
    recordType: execution.recordType,
    recordId: execution.recordId,
    status: execution.status,
    resultLog: (execution.resultLog ?? null) as Record<string, unknown> | null,
    attempts: execution.attempts,
    lastAttemptAt: execution.lastAttemptAt,
    createdAt: execution.createdAt,
  };
}

export async function listWorkflowRules() {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'workflow.read');

  const rules = await prisma.workflowRule.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
  });

  return (rules as WorkflowRuleRecord[]).map(serializeRule);
}

export async function getWorkflowRule(id: string) {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'workflow.read');

  const rule = await prisma.workflowRule.findFirst({ where: { id, organizationId } });
  if (!rule) throw codedError('Not found', 404);

  return serializeRule(rule as WorkflowRuleRecord);
}

export async function createWorkflowRule(input: unknown) {
  const parsed = workflowRuleCreateSchema.safeParse(input);
  if (!parsed.success) {
    throw codedError('Invalid request body', 400, parsed.error.issues);
  }

  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'workflow.create');

  // Duplicate rule names inside one organization make the execution log
  // impossible to read; reject them rather than silently allow.
  const duplicate = await prisma.workflowRule.findFirst({
    where: { organizationId, name: parsed.data.name },
    select: { id: true },
  });
  if (duplicate) throw codedError('A workflow rule with this name already exists', 400);

  const roleTargets = parsed.data.actions.list
    .filter((action) => action.type === 'notify_role')
    .map((action) => (action as { roleName: string }).roleName);
  if (roleTargets.length > 0) {
    const roles = await prisma.role.findMany({
      where: { organizationId, name: { in: roleTargets } },
      select: { name: true },
    });
    const known = new Set(roles.map((role: { name: string }) => role.name));
    const missing = roleTargets.filter((name) => !known.has(name));
    if (missing.length > 0) {
      throw codedError(`Unknown role in actions: ${missing.join(', ')}`, 400);
    }
  }

  const rule = await prisma.workflowRule.create({
    data: {
      organizationId,
      name: parsed.data.name,
      trigger: parsed.data.trigger,
      conditions: parsed.data.conditions,
      actions: parsed.data.actions,
      enabled: parsed.data.enabled ?? true,
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'workflow.create',
    entityType: 'WorkflowRule',
    entityId: rule.id,
    after: { id: rule.id, name: rule.name, trigger: rule.trigger, enabled: rule.enabled },
    organizationId,
  });

  return serializeRule(rule as WorkflowRuleRecord);
}

export async function updateWorkflowRule(id: string, input: unknown) {
  const parsed = workflowRuleUpdateSchema.safeParse(input);
  if (!parsed.success) {
    throw codedError('Invalid request body', 400, parsed.error.issues);
  }

  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'workflow.update');

  const existing = await prisma.workflowRule.findFirst({ where: { id, organizationId } });
  if (!existing) throw codedError('Not found', 404);

  if (parsed.data.name && parsed.data.name !== existing.name) {
    const duplicate = await prisma.workflowRule.findFirst({
      where: { organizationId, name: parsed.data.name, NOT: { id } },
      select: { id: true },
    });
    if (duplicate) throw codedError('A workflow rule with this name already exists', 400);
  }

  const rule = await prisma.workflowRule.update({
    where: { id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.trigger !== undefined ? { trigger: parsed.data.trigger } : {}),
      ...(parsed.data.conditions !== undefined ? { conditions: parsed.data.conditions } : {}),
      ...(parsed.data.actions !== undefined ? { actions: parsed.data.actions } : {}),
      ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
    },
  });

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'workflow.update',
    entityType: 'WorkflowRule',
    entityId: rule.id,
    before: { id: existing.id, name: existing.name, enabled: existing.enabled },
    after: { id: rule.id, name: rule.name, enabled: rule.enabled },
    organizationId,
  });

  return serializeRule(rule as WorkflowRuleRecord);
}

/** Activate/deactivate in one call — the toggle the rules list uses. */
export async function setWorkflowRuleEnabled(id: string, enabled: boolean) {
  return updateWorkflowRule(id, { enabled });
}

export async function deleteWorkflowRule(id: string) {
  const { userId, organizationId, email: actorEmail } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'workflow.delete');

  const existing = await prisma.workflowRule.findFirst({ where: { id, organizationId } });
  if (!existing) throw codedError('Not found', 404);

  // Executions are the rule's history; they go with it instead of being
  // orphaned (the FK is ON DELETE CASCADE so this is explicit, not implicit).
  await prisma.$transaction([
    prisma.workflowExecution.deleteMany({ where: { ruleId: id, organizationId } }),
    prisma.workflowRule.delete({ where: { id } }),
  ]);

  await createAuditLog({
    actorId: userId,
    actorName: actorEmail,
    action: 'workflow.delete',
    entityType: 'WorkflowRule',
    entityId: id,
    before: { id: existing.id, name: existing.name },
    after: null,
    organizationId,
  });

  return { id };
}

/**
 * Execution history, newest first.
 *
 * When `ruleId` is given the rule must belong to the actor's organization;
 * otherwise every execution in the organization is returned.
 */
export async function listWorkflowExecutions(ruleId?: string) {
  const { userId, organizationId } = await getAuthorizedUser();

  await requirePermission(userId, organizationId, 'workflow.read');

  if (ruleId) {
    const rule = await prisma.workflowRule.findFirst({
      where: { id: ruleId, organizationId },
      select: { id: true },
    });
    if (!rule) throw codedError('Not found', 404);
  }

  const executions = await prisma.workflowExecution.findMany({
    where: { organizationId, ...(ruleId ? { ruleId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  return (executions as WorkflowExecutionRecord[]).map(serializeExecution);
}
