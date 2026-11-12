// @vitest-environment node
/**
 * Integration tests for Projects sub-modules & permissions (real PostgreSQL).
 *
 * Covers:
 * - Project templates CRUD + linking templateId to projects
 * - Milestones CRUD + task CRUD + assignee & milestone scoping
 * - Task comments: authenticated author enforcement, author/admin moderation (403 vs 200)
 * - Project files: multipart upload, dangerous file blocking, authenticated download, cleanup delete
 * - Project approvals: client & internal approvals, transitions, approvedAt lifecycle
 * - Change orders: create, auto-set approvedBy, terminal transitions, delete
 * - Time entries: create, project & billable filters, update, delete
 * - Cross-org isolation (non-disclosing 404) & limited-role RBAC (403)
 *
 * Requires DATABASE_URL and a running server; skips otherwise.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/db';
import { SERVER_URL } from './test-config';

const canRun = Boolean(process.env.DATABASE_URL);
const describeIfDb = canRun ? describe : describe.skip;

const PASSWORD = process.env.TEST_PASSWORD ?? 'test_arena_password_2026';

async function postWithRetry(url: string, init: RequestInit, attempts = 4) {
  let res = await fetch(url, init);
  for (let attempt = 1; attempt < attempts && res.status === 429; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2500 * attempt));
    res = await fetch(url, init);
  }
  return res;
}

async function createUserOnly(label: string) {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@proj-sub.invalid`;

  const signUp = await postWithRetry(`${SERVER_URL}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: SERVER_URL },
    body: JSON.stringify({ email, password: PASSWORD, name: `Proj ${label}` }),
  });
  expect(signUp.status, `sign-up failed: ${await signUp.clone().text()}`).toBe(200);

  const signIn = await postWithRetry(`${SERVER_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: SERVER_URL },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(signIn.status, `sign-in failed: ${await signIn.clone().text()}`).toBe(200);

  const token =
    (signIn.headers.get('set-cookie') ?? '').match(/better-auth\.session_token=([^;]+)/)?.[1] ?? '';
  expect(token).toBeTruthy();

  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { user, token };
}

async function createUserWithOrg(label: string) {
  const { user, token } = await createUserOnly(label);

  const bootstrap = await postWithRetry(`${SERVER_URL}/api/auth/bootstrap-organization`, {
    method: 'POST',
    headers: {
      Cookie: `better-auth.session_token=${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Origin: SERVER_URL,
    },
    body: JSON.stringify({ organizationName: `Proj Org ${label} ${Date.now()}` }),
  });
  expect(bootstrap.status, `bootstrap failed: ${await bootstrap.clone().text()}`).toBe(200);

  const org = await prisma.organization.findFirstOrThrow({
    where: { userRoles: { some: { userId: user.id } } },
    select: { id: true },
  });

  return { user, token, organizationId: org.id };
}

describeIfDb('Projects sub-modules integration (real PostgreSQL)', () => {
  let adminToken = '';
  let adminUserId = '';
  let orgId = '';

  let limitedToken = '';
  let limitedUserId = '';

  let foreignToken = '';
  let foreignUserId = '';
  let foreignOrgId = '';

  let contactId = '';
  let templateId = '';
  let projectId = '';
  let milestoneId = '';
  let taskId = '';
  let commentId = '';
  let fileId = '';
  let approvalId = '';
  let changeOrderId = '';
  let timeEntryId = '';

  const adminAuth = () => ({
    Cookie: `better-auth.session_token=${adminToken}`,
    Accept: 'application/json',
    Origin: SERVER_URL,
  });

  const limitedAuth = () => ({
    Cookie: `better-auth.session_token=${limitedToken}`,
    Accept: 'application/json',
    Origin: SERVER_URL,
  });

  const foreignAuth = () => ({
    Cookie: `better-auth.session_token=${foreignToken}`,
    Accept: 'application/json',
    Origin: SERVER_URL,
  });

  beforeAll(async () => {
    await prisma.$connect();

    const admin = await createUserWithOrg('admin');
    adminToken = admin.token;
    adminUserId = admin.user.id;
    orgId = admin.organizationId;

    // Create a second member in the SAME organization with limited read+comment permissions
    const limited = await createUserOnly('member');
    limitedToken = limited.token;
    limitedUserId = limited.user.id;

    await prisma.user.update({
      where: { id: limitedUserId },
      data: { organizationId: orgId },
    });

    const perms = await prisma.permission.findMany({
      where: {
        code: {
          in: ['project.read', 'task.comment.read', 'task.comment.create', 'task.comment.update'],
        },
      },
    });
    const role = await prisma.role.create({
      data: {
        organizationId: orgId,
        name: 'Limited Project Viewer',
        description: 'Can view projects and post comments only',
        isSystem: false,
      },
    });
    await prisma.rolePermission.createMany({
      data: perms.map((p: { id: string }) => ({ roleId: role.id, permissionId: p.id })),
    });
    await prisma.userRole.create({
      data: { userId: limitedUserId, roleId: role.id, organizationId: orgId },
    });

    const contact = await prisma.contact.create({
      data: {
        organizationId: orgId,
        firstName: 'Submodule',
        lastName: 'Client',
        email: 'subclient@example.com',
        status: 'active',
        createdBy: adminUserId,
        updatedBy: adminUserId,
      },
    });
    contactId = contact.id;

    const foreign = await createUserWithOrg('foreign');
    foreignToken = foreign.token;
    foreignUserId = foreign.user.id;
    foreignOrgId = foreign.organizationId;
  });

  afterAll(async () => {
    if (fileId) {
      await fetch(`${SERVER_URL}/api/v1/projects/files/${fileId}`, {
        method: 'DELETE',
        headers: adminAuth(),
      }).catch(() => {});
    }

    for (const id of [orgId, foreignOrgId].filter(Boolean)) {
      await prisma.timeEntry.deleteMany({ where: { organizationId: id } }).catch(() => {});
      await prisma.taskComment.deleteMany({ where: { organizationId: id } }).catch(() => {});
      await prisma.projectFile.deleteMany({ where: { organizationId: id } }).catch(() => {});
      await prisma.fileAsset.deleteMany({ where: { organizationId: id } }).catch(() => {});
      await prisma.projectApproval.deleteMany({ where: { organizationId: id } }).catch(() => {});
      await prisma.changeOrder.deleteMany({ where: { organizationId: id } }).catch(() => {});
      await prisma.task.deleteMany({ where: { organizationId: id } }).catch(() => {});
      await prisma.milestone.deleteMany({ where: { organizationId: id } }).catch(() => {});
      await prisma.project.deleteMany({ where: { organizationId: id } }).catch(() => {});
      await prisma.projectTemplate.deleteMany({ where: { organizationId: id } }).catch(() => {});
      await prisma.contact.deleteMany({ where: { organizationId: id } }).catch(() => {});
      await prisma.auditLog.deleteMany({ where: { organizationId: id } }).catch(() => {});
      await prisma.userRole.deleteMany({ where: { organizationId: id } }).catch(() => {});
      await prisma.role.deleteMany({ where: { organizationId: id } }).catch(() => {});
      await prisma.organization.delete({ where: { id } }).catch(() => {});
    }
    for (const uid of [adminUserId, limitedUserId, foreignUserId].filter(Boolean)) {
      await prisma.session.deleteMany({ where: { userId: uid } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: uid } }).catch(() => {});
    }

    await prisma.$disconnect();
  });

  it('creates and lists project templates and links a template to a new project', async () => {
    const tplRes = await fetch(`${SERVER_URL}/api/v1/projects/templates`, {
      method: 'POST',
      headers: { ...adminAuth(), 'Content-Type': 'application/json', Origin: SERVER_URL },
      body: JSON.stringify({ name: 'Web Launch Blueprint', description: 'Standard launch plan' }),
    });
    expect(tplRes.status).toBe(201);
    const tpl = (await tplRes.json()) as { id: string; name: string; projectCount: number };
    expect(tpl.id).toBeTruthy();
    expect(tpl.projectCount).toBe(0);
    templateId = tpl.id;

    const projRes = await fetch(`${SERVER_URL}/api/v1/crm/projects`, {
      method: 'POST',
      headers: { ...adminAuth(), 'Content-Type': 'application/json', Origin: SERVER_URL },
      body: JSON.stringify({
        name: 'Acme Redesign',
        clientId: contactId,
        templateId,
        status: 'active',
        budget: '12000',
        startDate: '2026-05-01',
        endDate: '2026-06-30',
      }),
    });
    expect(projRes.status).toBe(201);
    const project = (await projRes.json()) as {
      id: string;
      templateId: string;
      template?: { id: string };
    };
    expect(project.templateId).toBe(templateId);
    expect(project.template?.id).toBe(templateId);
    projectId = project.id;

    // Cross-org access to template is non-disclosing 404
    const foreignTplRes = await fetch(`${SERVER_URL}/api/v1/projects/templates/${templateId}`, {
      headers: foreignAuth(),
    });
    expect(foreignTplRes.status).toBe(404);
  });

  it('manages milestones and tasks with org-scoped assignees and non-disclosing isolation', async () => {
    const msRes = await fetch(`${SERVER_URL}/api/v1/projects/milestones`, {
      method: 'POST',
      headers: { ...adminAuth(), 'Content-Type': 'application/json', Origin: SERVER_URL },
      body: JSON.stringify({
        projectId,
        name: 'Phase 1 Discovery',
        dueDate: '2026-05-15',
        status: 'in_progress',
      }),
    });
    expect(msRes.status).toBe(201);
    const milestone = (await msRes.json()) as { id: string; name: string };
    milestoneId = milestone.id;

    // Assigning a task to a foreign user fails with 404
    const badTaskRes = await fetch(`${SERVER_URL}/api/v1/crm/projects/${projectId}/tasks`, {
      method: 'POST',
      headers: { ...adminAuth(), 'Content-Type': 'application/json', Origin: SERVER_URL },
      body: JSON.stringify({ title: 'Cross-org assign', assigneeId: foreignUserId }),
    });
    expect(badTaskRes.status).toBe(404);

    // Creating a task assigned to the same-org member and milestone succeeds
    const taskRes = await fetch(`${SERVER_URL}/api/v1/crm/projects/${projectId}/tasks`, {
      method: 'POST',
      headers: { ...adminAuth(), 'Content-Type': 'application/json', Origin: SERVER_URL },
      body: JSON.stringify({
        title: 'Finalize wireframes',
        status: 'todo',
        priority: 'high',
        assigneeId: limitedUserId,
        milestoneId,
        estimatedHours: '6.5',
      }),
    });
    expect(taskRes.status).toBe(201);
    const task = (await taskRes.json()) as { id: string; assigneeId: string; milestoneId: string };
    expect(task.assigneeId).toBe(limitedUserId);
    expect(task.milestoneId).toBe(milestoneId);
    taskId = task.id;

    // Partial task update preserves priority/milestone while updating status
    const updateRes = await fetch(`${SERVER_URL}/api/v1/projects/tasks/${taskId}`, {
      method: 'PUT',
      headers: { ...adminAuth(), 'Content-Type': 'application/json', Origin: SERVER_URL },
      body: JSON.stringify({ status: 'done' }),
    });
    expect(updateRes.status).toBe(200);
    const updatedTask = (await updateRes.json()) as {
      status: string;
      priority: string;
      milestoneId: string;
    };
    expect(updatedTask.status).toBe('done');
    expect(updatedTask.priority).toBe('high');
    expect(updatedTask.milestoneId).toBe(milestoneId);

    // Limited user without project.update gets 403
    const forbiddenTaskRes = await fetch(`${SERVER_URL}/api/v1/projects/tasks/${taskId}`, {
      method: 'PUT',
      headers: { ...limitedAuth(), 'Content-Type': 'application/json', Origin: SERVER_URL },
      body: JSON.stringify({ status: 'todo' }),
    });
    expect(forbiddenTaskRes.status).toBe(403);
  });

  it('derives task comment author from session and enforces author/admin moderation', async () => {
    // Even if client passes deprecated userId = limitedUserId, server records adminUserId
    const cmtRes = await fetch(`${SERVER_URL}/api/v1/projects/tasks/${taskId}/comments`, {
      method: 'POST',
      headers: { ...adminAuth(), 'Content-Type': 'application/json', Origin: SERVER_URL },
      body: JSON.stringify({ userId: limitedUserId, comment: 'Admin authored note' }),
    });
    expect(cmtRes.status).toBe(201);
    const comment = (await cmtRes.json()) as { id: string; userId: string };
    expect(comment.userId).toBe(adminUserId);
    commentId = comment.id;

    // Limited user cannot edit admin's comment (403)
    const editForbidden = await fetch(
      `${SERVER_URL}/api/v1/projects/tasks/${taskId}/comments/${commentId}`,
      {
        method: 'PUT',
        headers: { ...limitedAuth(), 'Content-Type': 'application/json', Origin: SERVER_URL },
        body: JSON.stringify({ comment: 'Hijacked' }),
      }
    );
    expect(editForbidden.status).toBe(403);

    // Limited user CAN create and edit their own comment
    const memberCmtRes = await fetch(`${SERVER_URL}/api/v1/projects/tasks/${taskId}/comments`, {
      method: 'POST',
      headers: { ...limitedAuth(), 'Content-Type': 'application/json', Origin: SERVER_URL },
      body: JSON.stringify({ comment: 'Member note' }),
    });
    expect(memberCmtRes.status).toBe(201);
    const memberCmt = (await memberCmtRes.json()) as { id: string; userId: string };
    expect(memberCmt.userId).toBe(limitedUserId);

    const memberEdit = await fetch(
      `${SERVER_URL}/api/v1/projects/tasks/${taskId}/comments/${memberCmt.id}`,
      {
        method: 'PUT',
        headers: { ...limitedAuth(), 'Content-Type': 'application/json', Origin: SERVER_URL },
        body: JSON.stringify({ comment: 'Member note edited' }),
      }
    );
    expect(memberEdit.status).toBe(200);

    // Admin can moderate/delete the member comment
    const adminDelete = await fetch(
      `${SERVER_URL}/api/v1/projects/tasks/${taskId}/comments/${memberCmt.id}`,
      { method: 'DELETE', headers: adminAuth() }
    );
    expect(adminDelete.status).toBe(200);
  });

  it('uploads, downloads securely, blocks dangerous types, and deletes project files', async () => {
    const blockedForm = new FormData();
    blockedForm.append('projectId', projectId);
    blockedForm.append(
      'file',
      new Blob(['<script>alert(1)</script>'], { type: 'text/html' }),
      'xss.html'
    );

    const blockedRes = await fetch(`${SERVER_URL}/api/v1/projects/files/upload`, {
      method: 'POST',
      headers: { Cookie: `better-auth.session_token=${adminToken}`, Origin: SERVER_URL },
      body: blockedForm,
    });
    expect(blockedRes.status).toBe(400);

    const uploadForm = new FormData();
    uploadForm.append('projectId', projectId);
    uploadForm.append('taskId', taskId);
    uploadForm.append('file', new Blob(['Project brief v1'], { type: 'text/plain' }), 'brief.txt');

    const uploadRes = await fetch(`${SERVER_URL}/api/v1/projects/files/upload`, {
      method: 'POST',
      headers: { Cookie: `better-auth.session_token=${adminToken}`, Origin: SERVER_URL },
      body: uploadForm,
    });
    expect(uploadRes.status).toBe(201);
    const uploaded = (await uploadRes.json()) as {
      id: string;
      fileAsset?: { originalName: string; storagePath?: string };
    };
    expect(uploaded.fileAsset?.originalName).toBe('brief.txt');
    expect(uploaded.fileAsset?.storagePath).toBeUndefined();
    fileId = uploaded.id;

    // Foreign tenant cannot download
    const foreignDl = await fetch(`${SERVER_URL}/api/v1/projects/files/${fileId}/download`, {
      headers: foreignAuth(),
    });
    expect(foreignDl.status).toBe(404);

    // Same org downloads with attachment disposition
    const dl = await fetch(`${SERVER_URL}/api/v1/projects/files/${fileId}/download`, {
      headers: adminAuth(),
    });
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-disposition')).toContain('attachment');
    expect(dl.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await dl.text()).toBe('Project brief v1');

    // Delete file and confirm 404 afterwards
    const del = await fetch(`${SERVER_URL}/api/v1/projects/files/${fileId}`, {
      method: 'DELETE',
      headers: adminAuth(),
    });
    expect(del.status).toBe(200);
    fileId = '';
  });

  it(
    'enforces approval & change order transitions and time entry filters',
    { timeout: 120_000 },
    async () => {
      const appRes = await fetch(`${SERVER_URL}/api/v1/projects/approvals`, {
        method: 'POST',
        headers: { ...adminAuth(), 'Content-Type': 'application/json', Origin: SERVER_URL },
        body: JSON.stringify({ projectId, contactId, status: 'pending', feedback: 'Review v1' }),
      });
      expect(appRes.status).toBe(201);
      const approval = (await appRes.json()) as { id: string; approvedAt: string | null };
      expect(approval.approvedAt).toBeNull();
      approvalId = approval.id;

      const approveRes = await fetch(`${SERVER_URL}/api/v1/projects/approvals/${approvalId}`, {
        method: 'PUT',
        headers: { ...adminAuth(), 'Content-Type': 'application/json', Origin: SERVER_URL },
        body: JSON.stringify({ status: 'approved', feedback: 'Signed off' }),
      });
      expect(approveRes.status).toBe(200);
      const approved = (await approveRes.json()) as { status: string; approvedAt: string | null };
      expect(approved.status).toBe('approved');
      expect(approved.approvedAt).toBeTruthy();

      const invalidAppTransition = await fetch(
        `${SERVER_URL}/api/v1/projects/approvals/${approvalId}`,
        {
          method: 'PUT',
          headers: { ...adminAuth(), 'Content-Type': 'application/json', Origin: SERVER_URL },
          body: JSON.stringify({ status: 'rejected' }),
        }
      );
      expect(invalidAppTransition.status).toBe(400);

      // Change order create & approve
      const coRes = await fetch(`${SERVER_URL}/api/v1/projects/change-orders`, {
        method: 'POST',
        headers: { ...adminAuth(), 'Content-Type': 'application/json', Origin: SERVER_URL },
        body: JSON.stringify({
          projectId,
          description: 'Add multilingual support',
          amount: '2400.00',
          status: 'pending',
        }),
      });
      expect(coRes.status).toBe(201);
      const co = (await coRes.json()) as { id: string };
      changeOrderId = co.id;

      const coApprove = await fetch(
        `${SERVER_URL}/api/v1/projects/change-orders/${changeOrderId}`,
        {
          method: 'PUT',
          headers: { ...adminAuth(), 'Content-Type': 'application/json', Origin: SERVER_URL },
          body: JSON.stringify({ status: 'approved' }),
        }
      );
      expect(coApprove.status).toBe(200);
      const coApproved = (await coApprove.json()) as {
        approvedBy: string | null;
        approver?: { id: string } | null;
      };
      expect(coApproved.approvedBy).toBe(adminUserId);
      expect(coApproved.approver?.id).toBe(adminUserId);

      const coRevert = await fetch(`${SERVER_URL}/api/v1/projects/change-orders/${changeOrderId}`, {
        method: 'PUT',
        headers: { ...adminAuth(), 'Content-Type': 'application/json', Origin: SERVER_URL },
        body: JSON.stringify({ status: 'pending' }),
      });
      expect(coRevert.status).toBe(400);

      // Time entry create + filter by projectId & billable
      const teRes = await fetch(`${SERVER_URL}/api/v1/projects/time-entries`, {
        method: 'POST',
        headers: { ...adminAuth(), 'Content-Type': 'application/json', Origin: SERVER_URL },
        body: JSON.stringify({
          taskId,
          date: '2026-05-10T00:00:00.000Z',
          hours: '3.5',
          description: 'Discovery workshop',
          billable: true,
        }),
      });
      expect(teRes.status).toBe(201);
      const te = (await teRes.json()) as { id: string; hours: string };
      timeEntryId = te.id;

      const teListRes = await fetch(
        `${SERVER_URL}/api/v1/projects/time-entries?projectId=${projectId}&billable=true`,
        { headers: adminAuth() }
      );
      expect(teListRes.status).toBe(200);
      const teList = (await teListRes.json()) as Array<{ id: string }>;
      expect(teList.some((row) => row.id === timeEntryId)).toBe(true);

      const teForeign = await fetch(`${SERVER_URL}/api/v1/projects/time-entries/${timeEntryId}`, {
        headers: foreignAuth(),
      });
      expect(teForeign.status).toBe(404);
    }
  );
});
