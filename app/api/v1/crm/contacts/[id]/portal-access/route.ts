import { NextResponse } from 'next/server';
import {
  getContactPortalAccess,
  inviteContactToPortal,
  revokeContactPortalAccess,
} from '@/lib/services/portal/portal-auth-service';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: contactId } = await params;
    const portalAccess = await getContactPortalAccess(contactId);

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
