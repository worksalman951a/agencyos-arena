import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/services/automation/run-workflow-service', () => ({
  dispatchWorkflowEvent: vi.fn(),
}));

import { dispatchWorkflowEvent } from '@/lib/services/automation/run-workflow-service';
import { POST } from '@/app/api/v1/automation/events/route';

const mockDispatch = dispatchWorkflowEvent as unknown as ReturnType<typeof vi.fn>;

describe('POST /api/v1/automation/events', () => {
  it('rejects caller-supplied events while trusted server-side producers are absent', async () => {
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
      error: expect.stringContaining('trusted server-side event producers'),
    });
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
