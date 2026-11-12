import { NextResponse } from 'next/server';
import { executePortalAction } from '@/lib/services/portal/portal-action-service';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const ipAddress = request.headers.get('x-forwarded-for') || undefined;
    const userAgent = request.headers.get('user-agent') || undefined;

    const result = await executePortalAction(body, { ipAddress, userAgent });

    return NextResponse.json(result);
  } catch (error) {
    const err = error as { statusCode?: number; message?: string };
    const status = err.statusCode || 500;
    return NextResponse.json(
      { error: err.message || 'Failed to process document action' },
      { status }
    );
  }
}
