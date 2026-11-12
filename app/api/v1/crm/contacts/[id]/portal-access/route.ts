import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireOrganization } from '@/lib/permissions';
import { auth } from '@/lib/auth-server';
import { cookies } from 'next/headers';
import {
  inviteContactToPortal,
  revokeContactPortalAccess,
} from '@/lib/services/portal/portal-auth-service';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: contactId } = await params;
    const cookieStore = await cookies();
    const result = await auth.api.getSession({
      headers: { cookie: cookieStore.toString() },
    });

    if (!result?.session || !result.user) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }

    const { organizationId } = await requireOrganization(result.user.id);

    const portalAccess = await prisma.clientPortalAccess.findUnique({
      where: {
        organizationId_contactId: { organizationId, contactId },
      },
      select: {
        id: true,
        email: true,
        status: true,
        invitedAt: true,
        activatedAt: true,
        revokedAt: true,
        lastLoginAt: true,
      },
    });

    return NextResponse.json({ portalAccess });
  } catch (error) {
    const err = error as { statusCode?: number; message?: string };
    const status = err.statusCode || 500;
    return NextResponse.json({ error: err.message || 'Failed to fetch portal access' }, { status });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: contactId } = await params;
    const body = await request.json();

    const result = await inviteContactToPortal({
      contactId,
      email: body.email,
    });

    return NextResponse.json(result);
  } catch (error) {
    const err = error as { statusCode?: number; message?: string };
    const status = err.statusCode || 500;
    return NextResponse.json({ error: err.message || 'Failed to invite contact' }, { status });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: contactId } = await params;

    const result = await revokeContactPortalAccess({
      contactId,
    });

    return NextResponse.json(result);
  } catch (error) {
    const err = error as { statusCode?: number; message?: string };
    const status = err.statusCode || 500;
    return NextResponse.json(
      { error: err.message || 'Failed to revoke portal access' },
      { status }
    );
  }
}
