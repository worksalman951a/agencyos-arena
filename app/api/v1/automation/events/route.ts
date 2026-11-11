/**
 * Workflow event HTTP dispatch is intentionally disabled.
 *
 * This route previously trusted caller-supplied record snapshots and used a
 * read permission to execute actions that write records. There are currently no
 * trusted business-event producers in the application, so accepting an HTTP
 * event would let callers forge event origins and record fields. Re-enable only
 * after events are emitted by trusted server-side domain services and their
 * affected-record authorization is verified.
 */

import { NextResponse } from 'next/server';

export async function POST(_request: Request) {
  // Do not parse or trust any caller-controlled event payload.
  void _request;

  return NextResponse.json(
    {
      error:
        'Workflow event dispatch is unavailable through the HTTP API until trusted server-side event producers are configured.',
    },
    { status: 410 }
  );
}
