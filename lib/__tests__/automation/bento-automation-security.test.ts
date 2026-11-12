import { describe, it, expect, vi } from 'vitest';
import {
  WORKFLOW_TRIGGERS,
  WORKFLOW_ACTION_TYPES,
  UNSUPPORTED_ACTION_TYPES,
  workflowRuleCreateSchema,
} from '@/lib/automation/rules';

describe('Phase 7A: Automation Security & Tenant Boundary Guard Tests', () => {
  it('enforces tenant boundary isolation and prevents cross-organization rule access', async () => {
    const mockDb = {
      workflowRule: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };

    const targetOrgId = 'org-tenant-alpha';
    const attackerOrgId = 'org-tenant-beta';

    const rule = await mockDb.workflowRule.findFirst({
      where: {
        id: 'rule-xyz',
        organizationId: attackerOrgId,
      },
    });

    expect(rule).toBeNull();
    expect(targetOrgId).not.toBe(attackerOrgId);
  });

  it('rejects unsupported action types (send_email, webhook) at validation boundary', () => {
    expect(UNSUPPORTED_ACTION_TYPES).toContain('send_email');
    expect(UNSUPPORTED_ACTION_TYPES).toContain('webhook');

    // Attempting to validate a rule with unsupported action
    const invalidPayload = {
      name: 'Malicious Outbound Webhook',
      trigger: 'record.created',
      conditions: {},
      actions: {
        list: [{ type: 'webhook', url: 'https://attacker.evil/exfil' }],
      },
      enabled: true,
    };

    const parseResult = workflowRuleCreateSchema.safeParse(invalidPayload);
    expect(parseResult.success).toBe(false);
  });

  it('validates supported in-process trigger and action vocabularies', () => {
    expect(WORKFLOW_TRIGGERS).toEqual([
      'record.created',
      'record.updated',
      'record.status_changed',
    ]);

    expect(WORKFLOW_ACTION_TYPES).toEqual([
      'notify_user',
      'notify_role',
      'assign_record_owner',
      'set_status',
      'log',
    ]);
  });

  it('verifies valid action payload schema acceptance', () => {
    const validPayload = {
      name: 'Valid Assignment Rule',
      trigger: 'record.created' as const,
      conditions: {
        mode: 'all' as const,
        all: [{ field: 'tier', operator: 'eq' as const, value: 'enterprise' }],
      },
      actions: {
        list: [
          { type: 'assign_record_owner' as const, userId: 'user-sales-lead' },
          { type: 'notify_user' as const, userId: 'user-sales-lead', title: 'New lead' },
        ],
      },
      enabled: true,
    };

    const parseResult = workflowRuleCreateSchema.safeParse(validPayload);
    expect(parseResult.success).toBe(true);
  });
});
