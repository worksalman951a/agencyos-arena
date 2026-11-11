/**
 * Workflow event HTTP dispatch is intentionally disabled.
 *
 * This route previously trusted caller-supplied record snapshots and used a
 * read permission to execute actions that write records. Business-domain
 * services now emit validated, tenant-scoped events internally. The HTTP route
 * nevertheless stays disabled: events must originate from those server-side
 * services, never from a caller-supplied payload.
 */

import { NextResponse } from 'next/server';

export async function POST(_request: Request) {
  // Do not parse or trust any caller-controlled event payload.
  void _request;

  return NextResponse.json(
    {
      error:
        'Workflow event dispatch is disabled through the HTTP API; business events are produced by trusted server-side services.',
    },
    { status: 410 }
  );
}
