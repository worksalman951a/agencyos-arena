/**
 * Unit tests for client collaboration: approval requests and comments.
 *
 * Focus: identity is always taken from the session, decisions are terminal,
 * history is append-only, and an internal note can never appear in a
 * client-facing query.
 */

vi.mock('@/lib/db', () => ({
  prisma: {
    clientApproval: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    clientApprovalEvent: { create: vi.fn(), findMany: vi.fn() },
    clientComment: { create: vi.fn(), findMany: vi.fn() },
    clientAccess: { findFirst: vi.fn() },
    clientResourceGrant: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/portal/access-control', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/portal/access-control')>();
  return {
    ...actual,
    requirePortalAccess: vi.fn(),
    requirePortalCapability: vi.fn(),
    requireGrantedResource: vi.fn(),
  };
});

vi.mock('@/lib/portal/audit', () => ({ writePortalAudit: vi.fn() }));
vi.mock('@/lib/portal/notify', () => ({ notifyUser: vi.fn(), notifyInternalStaff: vi.fn() }));
vi.mock('@/lib/portal/internal-actor', () => ({ requireInternalActor: vi.fn() }));

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { prisma } from '@/lib/db';
import {
  requireGrantedResource,
  requirePortalAccess,
  requirePortalCapability,
} from '@/lib/portal/access-control';
import { notifyInternalStaff, notifyUser } from '@/lib/portal/notify';
import { requireInternalActor } from '@/lib/portal/internal-actor';
import {
  cancelClientApprovalRequest,
  createClientApprovalRequest,
  respondToClientApproval,
} from '@/lib/services/portal/client-approval-service';
import {
  createClientComment,
  createInternalComment,
  listClientVisibleComments,
} from '@/lib/services/portal/client-comment-service';

const mockRequirePortalAccess = requirePortalAccess as unknown as ReturnType<typeof vi.fn>;
const mockRequirePortalCapability = requirePortalCapability as unknown as ReturnType<typeof vi.fn>;
const mockRequireGrantedResource = requireGrantedResource as unknown as ReturnType<typeof vi.fn>;
const mockRequireInternalActor = requireInternalActor as unknown as ReturnType<typeof vi.fn>;
const mockNotifyUser = notifyUser as unknown as ReturnType<typeof vi.fn>;
const mockNotifyInternalStaff = notifyInternalStaff as unknown as ReturnType<typeof vi.fn>;

const mockApprovalFindFirst = prisma.clientApproval.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const mockApprovalCreate = prisma.clientApproval.create as unknown as ReturnType<typeof vi.fn>;
const mockApprovalUpdateMany = prisma.clientApproval.updateMany as unknown as ReturnType<
  typeof vi.fn
>;
const mockApprovalFindUniqueOrThrow = prisma.clientApproval
  .findUniqueOrThrow as unknown as ReturnType<typeof vi.fn>;
const mockEventCreate = prisma.clientApprovalEvent.create as unknown as ReturnType<typeof vi.fn>;
const mockCommentCreate = prisma.clientComment.create as unknown as ReturnType<typeof vi.fn>;
const mockCommentFindMany = prisma.clientComment.findMany as unknown as ReturnType<typeof vi.fn>;
const mockAccessFindFirst = prisma.clientAccess.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockGrantFindFirst = prisma.clientResourceGrant.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const mockTransaction = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;

const organizationId = 'org_1';
const accessId = 'access_1';
const clientUserId = 'client_user_1';

const context = {
  userId: clientUserId,
  email: 'clara@client.test',
  name: 'Clara Client',
  accessId,
  organizationId,
  organizationName: 'Acme Agency',
  contactId: 'contact_1',
  contactName: 'Clara Client',
  role: 'client_approver',
  status: 'active',
  canViewInvoices: true,
  canDownloadFiles: true,
  canComment: true,
  canApprove: true,
};

function pendingApproval(overrides: Record<string, unknown> = {}) {
  return {
    id: 'approval_1',
    organizationId,
    clientAccessId: accessId,
    resourceType: 'project',
    resourceId: 'project_1',
    title: 'Approve homepage design',
    description: null,
    status: 'pending',
    dueAt: null,
    requestedBy: 'admin_1',
    respondedBy: null,
    respondedAt: null,
    responseNote: null,
    createdAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      clientApproval: {
        updateMany: mockApprovalUpdateMany,
        findUniqueOrThrow: mockApprovalFindUniqueOrThrow,
        create: mockApprovalCreate,
      },
      clientApprovalEvent: { create: mockEventCreate },
    })
  );
});

describe('respondToClientApproval', () => {
  beforeEach(() => {
    mockRequirePortalCapability.mockResolvedValue(context);
    mockRequireGrantedResource.mockResolvedValue({ grant: { id: 'grant_1' }, resource: {} });
    mockApprovalFindFirst.mockResolvedValue(pendingApproval());
    mockApprovalUpdateMany.mockResolvedValue({ count: 1 });
    mockApprovalFindUniqueOrThrow.mockResolvedValue(
      pendingApproval({
        status: 'approved',
        respondedBy: clientUserId,
        respondedAt: new Date('2026-11-11T10:00:00.000Z'),
        responseNote: 'Looks great',
      })
    );
  });

  it('requires the approve capability', async () => {
    mockRequirePortalCapability.mockRejectedValue(
      Object.assign(new Error('Forbidden'), { statusCode: 403 })
    );

    await expect(
      respondToClientApproval('approval_1', { decision: 'approved' })
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(mockApprovalFindFirst).not.toHaveBeenCalled();
  });

  it('scopes the approval lookup to the caller client access and organization', async () => {
    await respondToClientApproval('approval_1', { decision: 'approved' });

    expect(mockApprovalFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'approval_1',
        clientAccessId: accessId,
        organizationId,
      },
    });
  });

  it("answers 404 for another client's approval id", async () => {
    mockApprovalFindFirst.mockResolvedValue(null);

    await expect(
      respondToClientApproval('approval_other_client', { decision: 'approved' })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('refuses to answer an already answered request', async () => {
    mockApprovalFindFirst.mockResolvedValue(pendingApproval({ status: 'approved' }));

    await expect(
      respondToClientApproval('approval_1', { decision: 'changes_requested' })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('re-checks the grant so a withdrawn share cannot be answered', async () => {
    mockRequireGrantedResource.mockRejectedValue(
      Object.assign(new Error('Not found'), { statusCode: 404 })
    );

    await expect(
      respondToClientApproval('approval_1', { decision: 'approved' })
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(mockApprovalUpdateMany).not.toHaveBeenCalled();
  });

  it('rejects a payload that tries to supply the responding identity or timestamp', async () => {
    await expect(
      respondToClientApproval('approval_1', {
        decision: 'approved',
        note: 'Looks great',
        respondedBy: 'attacker_user',
        respondedAt: '2020-01-01T00:00:00.000Z',
      } as unknown)
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(mockApprovalUpdateMany).not.toHaveBeenCalled();
  });

  it('records the responding identity and timestamp from the session', async () => {
    mockApprovalUpdateMany.mockResolvedValue({ count: 1 });

    await respondToClientApproval('approval_1', {
      decision: 'approved',
      note: 'Looks great',
    });

    expect(mockApprovalUpdateMany).toHaveBeenCalledWith({
      where: { id: 'approval_1', status: 'pending' },
      data: {
        status: 'approved',
        respondedBy: clientUserId,
        respondedAt: expect.any(Date),
        responseNote: 'Looks great',
      },
    });
  });

  it('appends one immutable history event tagged as a client action', async () => {
    await respondToClientApproval('approval_1', {
      decision: 'changes_requested',
      note: 'Fix the logo',
    });

    expect(mockEventCreate).toHaveBeenCalledTimes(1);
    expect(mockEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId,
        approvalId: 'approval_1',
        actorType: 'client',
        actorUserId: clientUserId,
        action: 'changes_requested',
        note: 'Fix the logo',
      }),
    });
  });

  it('notifies the internal team once the client decides', async () => {
    await respondToClientApproval('approval_1', { decision: 'approved' });

    expect(mockNotifyInternalStaff).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId,
        permissionCode: 'client.approval.read',
        type: 'client.approval.responded',
      })
    );
  });

  it('rejects a decision value outside approved/changes_requested', async () => {
    await expect(
      respondToClientApproval('approval_1', { decision: 'deleted' } as unknown)
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('answers 409 when a concurrent response wins the conditional update', async () => {
    mockApprovalUpdateMany.mockResolvedValue({ count: 0 });

    await expect(
      respondToClientApproval('approval_1', { decision: 'approved' })
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(mockEventCreate).not.toHaveBeenCalled();
  });
});

describe('createClientApprovalRequest', () => {
  beforeEach(() => {
    mockRequireInternalActor.mockResolvedValue({
      userId: 'admin_1',
      organizationId,
      email: 'admin@agency.test',
      role: 'employee',
    });
    mockAccessFindFirst.mockResolvedValue({
      id: accessId,
      userId: clientUserId,
      status: 'active',
      canApprove: true,
    });
    mockGrantFindFirst.mockResolvedValue({ id: 'grant_1', canApprove: true });
    mockApprovalCreate.mockResolvedValue(pendingApproval());
    mockEventCreate.mockResolvedValue({});
  });

  it('refuses to request an approval on a resource that is not shared', async () => {
    mockGrantFindFirst.mockResolvedValue(null);

    await expect(
      createClientApprovalRequest({
        clientAccessId: accessId,
        resourceType: 'project',
        resourceId: 'project_not_shared',
        title: 'Approve',
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('refuses when the share does not allow approvals', async () => {
    mockGrantFindFirst.mockResolvedValue({ id: 'grant_1', canApprove: false });

    await expect(
      createClientApprovalRequest({
        clientAccessId: accessId,
        resourceType: 'project',
        resourceId: 'project_1',
        title: 'Approve',
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('refuses when the client lacks the approve capability', async () => {
    mockAccessFindFirst.mockResolvedValue({
      id: accessId,
      userId: clientUserId,
      status: 'active',
      canApprove: false,
    });

    await expect(
      createClientApprovalRequest({
        clientAccessId: accessId,
        resourceType: 'project',
        resourceId: 'project_1',
        title: 'Approve',
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('answers 404 for a client access from another organization', async () => {
    mockAccessFindFirst.mockResolvedValue(null);

    await expect(
      createClientApprovalRequest({
        clientAccessId: 'access_other_tenant',
        resourceType: 'project',
        resourceId: 'project_1',
        title: 'Approve',
      })
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(mockAccessFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'access_other_tenant', organizationId },
      })
    );
  });

  it('records a "requested" event and notifies the client', async () => {
    await createClientApprovalRequest({
      clientAccessId: accessId,
      resourceType: 'project',
      resourceId: 'project_1',
      title: 'Approve homepage design',
    });

    expect(mockEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'requested', actorType: 'internal' }),
    });
    expect(mockNotifyUser).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId,
        userId: clientUserId,
        type: 'client.approval.requested',
      })
    );
  });
});

describe('cancelClientApprovalRequest', () => {
  it('refuses to cancel an already answered request', async () => {
    mockRequireInternalActor.mockResolvedValue({
      userId: 'admin_1',
      organizationId,
      email: 'admin@agency.test',
      role: 'employee',
    });
    mockApprovalFindFirst.mockResolvedValue(pendingApproval({ status: 'approved' }));

    await expect(cancelClientApprovalRequest('approval_1')).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});

describe('client comments', () => {
  beforeEach(() => {
    mockRequirePortalCapability.mockResolvedValue(context);
    mockRequirePortalAccess.mockResolvedValue(context);
    mockRequireGrantedResource.mockResolvedValue({ grant: { id: 'grant_1' }, resource: {} });
    mockCommentCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      createdAt: new Date(),
      ...data,
    }));
  });

  it('forces client-visible visibility even when the payload asks for internal', async () => {
    await createClientComment({
      resourceType: 'project',
      resourceId: 'project_1',
      body: 'Please adjust the hero image',
      visibility: 'internal',
    });

    const stored = mockCommentCreate.mock.calls[0][0].data as Record<string, unknown>;
    expect(stored.visibility).toBe('client');
    expect(stored.authorType).toBe('client');
    expect(stored.authorUserId).toBe(clientUserId);
  });

  it('requires the comment capability', async () => {
    mockRequirePortalCapability.mockRejectedValue(
      Object.assign(new Error('Forbidden'), { statusCode: 403 })
    );

    await expect(
      createClientComment({ resourceType: 'project', resourceId: 'project_1', body: 'hi' })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('requires the per-grant comment flag', async () => {
    mockRequireGrantedResource.mockRejectedValue(
      Object.assign(new Error('Forbidden'), { statusCode: 403 })
    );

    await expect(
      createClientComment({ resourceType: 'project', resourceId: 'project_1', body: 'hi' })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('only ever queries client-visible comments for a client request', async () => {
    mockCommentFindMany.mockResolvedValue([]);

    await listClientVisibleComments(context, 'project', 'project_1');

    expect(mockCommentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId,
          resourceType: 'project',
          resourceId: 'project_1',
          visibility: 'client',
        },
      })
    );
  });

  it('does not notify the client for an internal-only note', async () => {
    mockRequireInternalActor.mockResolvedValue({
      userId: 'admin_1',
      organizationId,
      email: 'admin@agency.test',
      role: 'employee',
    });
    mockGrantFindFirst.mockResolvedValue({ clientAccessId: accessId });
    mockCommentCreate.mockResolvedValue({
      id: 'comment_1',
      resourceType: 'project',
      resourceId: 'project_1',
      authorType: 'internal',
      visibility: 'internal',
      body: 'Internal: watch scope creep',
      createdAt: new Date(),
    });

    await createInternalComment({
      resourceType: 'project',
      resourceId: 'project_1',
      body: 'Internal: watch scope creep',
      visibility: 'internal',
    });

    expect(mockNotifyUser).not.toHaveBeenCalled();
  });

  it('notifies the client for a client-visible reply', async () => {
    mockRequireInternalActor.mockResolvedValue({
      userId: 'admin_1',
      organizationId,
      email: 'admin@agency.test',
      role: 'employee',
    });
    mockGrantFindFirst.mockResolvedValue({ clientAccessId: accessId });
    mockCommentCreate.mockResolvedValue({
      id: 'comment_2',
      resourceType: 'project',
      resourceId: 'project_1',
      authorType: 'internal',
      visibility: 'client',
      body: 'Thanks — we will adjust that today.',
      createdAt: new Date(),
    });
    mockAccessFindFirst.mockResolvedValue({ userId: clientUserId, status: 'active' });

    await createInternalComment({
      resourceType: 'project',
      resourceId: 'project_1',
      body: 'Thanks — we will adjust that today.',
      visibility: 'client',
    });

    expect(mockNotifyUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: clientUserId, type: 'client.comment.reply' })
    );
  });

  it('refuses an internal comment on a resource that is not shared with any client', async () => {
    mockRequireInternalActor.mockResolvedValue({
      userId: 'admin_1',
      organizationId,
      email: 'admin@agency.test',
      role: 'employee',
    });
    mockGrantFindFirst.mockResolvedValue(null);

    await expect(
      createInternalComment({ resourceType: 'project', resourceId: 'project_1', body: 'note' })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects an unknown resource type', async () => {
    mockRequireInternalActor.mockResolvedValue({
      userId: 'admin_1',
      organizationId,
      email: 'admin@agency.test',
      role: 'employee',
    });

    await expect(
      createInternalComment({ resourceType: 'user', resourceId: 'user_1', body: 'note' })
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
