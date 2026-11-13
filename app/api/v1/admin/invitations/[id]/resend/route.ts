/** POST /api/v1/admin/invitations/:id/resend — rotate and re-send a pending invite. */

import { NextResponse } from 'next/server';

import { apiErrorFrom } from '@/lib/api/route-error';
import { withRateLimit } from '@/lib/security/rate-limit';
import { sessionRateLimitKey } from '@/lib/security/rate-limit-subject';
import { resendInvitation } from '@/lib/services/admin/invitation-service';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRateLimit(
    'invitation-create',
    await sessionRateLimitKey('invitation-create', request),
    async () => {
      try {
        const { id } = await params;
        return NextResponse.json(await resendInvitation(id));
      } catch (error) {
        const { status, message } = apiErrorFrom(error);
        return NextResponse.json({ error: message }, { status });
      }
    }
  );
}
