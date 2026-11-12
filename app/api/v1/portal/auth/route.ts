/**
 * Client Portal Authentication API Endpoints
 *
 * POST /api/v1/portal/auth/login - Request magic sign-in link
 * POST /api/v1/portal/auth/verify - Verify token, activate if pending, and set session cookie
 * POST /api/v1/portal/auth/logout - Invalidate session and clear cookie
 */

import { NextResponse } from 'next/server';
import {
  requestPortalLoginLink,
  verifyPortalTokenAndLogin,
  logoutClientPortal,
} from '@/lib/services/portal/portal-auth-service';

export async function POST(request: Request) {
  try {
    const { pathname } = new URL(request.url);
    const body = await request.json().catch(() => ({}));

    if (pathname.endsWith('/logout')) {
      await logoutClientPortal();
      return NextResponse.json({ success: true });
    }

    if (pathname.endsWith('/verify') || body.token) {
      const res = await verifyPortalTokenAndLogin(body);
      return NextResponse.json(res, { status: 200 });
    }

    // Default: login link request
    const res = await requestPortalLoginLink(body);
    return NextResponse.json(res, { status: 200 });
  } catch (err) {
    const statusCode = (err as Error & { statusCode?: number }).statusCode ?? 500;
    return NextResponse.json(
      { error: (err as Error).message || 'Portal authentication request failed' },
      { status: statusCode }
    );
  }
}
