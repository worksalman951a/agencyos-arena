import { describe, expect, it } from 'vitest';

import { POST } from '@/app/api/v1/automation/events/route';

describe('POST /api/v1/automation/events', () => {
  it('rejects caller-supplied events while keeping public dispatch disabled', async () => {
    const request = new Request('http://localhost/api/v1/automation/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'record.created',
        recordType: 'Task',
        recordId: 'task-1',
        record: { ownerId: 'attacker-controlled' },
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('disabled through the HTTP API'),
    });
  });
});
