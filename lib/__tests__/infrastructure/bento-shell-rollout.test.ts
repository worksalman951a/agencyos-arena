import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isBentoShellEnabled } from '@/components/layout/bento-shell-eval';
import { prisma } from '@/lib/db';

vi.mock('@/lib/db', () => ({
  prisma: {
    featureFlag: {
      findFirst: vi.fn(),
    },
  },
}));

describe('Bento Shell Server Rollout Evaluation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false when organizationId is undefined or null', async () => {
    expect(await isBentoShellEnabled(undefined)).toBe(false);
    expect(await isBentoShellEnabled(null)).toBe(false);
    expect(await isBentoShellEnabled('')).toBe(false);
    expect(prisma.featureFlag.findFirst).not.toHaveBeenCalled();
  });

  it('evaluates true when organization has bento_shell flag enabled', async () => {
    vi.mocked(prisma.featureFlag.findFirst).mockResolvedValue({
      id: 'flag-1',
      organizationId: 'org-123',
      flagKey: 'bento_shell',
      enabled: true,
      description: 'Bento UI Shell',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const enabled = await isBentoShellEnabled('org-123');
    expect(enabled).toBe(true);
    expect(prisma.featureFlag.findFirst).toHaveBeenCalledWith({
      where: { organizationId: 'org-123', flagKey: 'bento_shell' },
      select: { enabled: true },
    });
  });

  it('evaluates false when bento_shell flag is disabled for organization', async () => {
    vi.mocked(prisma.featureFlag.findFirst).mockResolvedValue({
      id: 'flag-1',
      organizationId: 'org-123',
      flagKey: 'bento_shell',
      enabled: false,
      description: 'Bento UI Shell',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const enabled = await isBentoShellEnabled('org-123');
    expect(enabled).toBe(false);
  });

  it('falls back safely to false when feature flag record is absent', async () => {
    vi.mocked(prisma.featureFlag.findFirst).mockResolvedValue(null);

    const enabled = await isBentoShellEnabled('org-unknown');
    expect(enabled).toBe(false);
  });

  it('fails safely to false if database throws an exception (fail-closed fallback)', async () => {
    vi.mocked(prisma.featureFlag.findFirst).mockRejectedValue(new Error('DB Connection Timeout'));

    const enabled = await isBentoShellEnabled('org-123');
    expect(enabled).toBe(false);
  });
});
