/**
 * Unit tests for portal file storage helpers.
 *
 * The portal serves blobs uploaded by the team, so a stored path is untrusted
 * input as far as the download route is concerned: it must stay inside the
 * storage root.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  assertSafeStoragePath,
  readStoredFile,
  resolveStorageRoot,
  sanitizeFileName,
} from '@/lib/portal/storage';

let storageRoot: string;
const originalRoot = process.env.STORAGE_LOCAL_PATH;

beforeAll(async () => {
  storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agencyos-portal-storage-'));
  process.env.STORAGE_LOCAL_PATH = storageRoot;
  await fs.mkdir(path.join(storageRoot, 'org_1'), { recursive: true });
  await fs.writeFile(path.join(storageRoot, 'org_1', 'brief.pdf'), 'pdf-bytes');
});

afterAll(async () => {
  if (originalRoot === undefined) delete process.env.STORAGE_LOCAL_PATH;
  else process.env.STORAGE_LOCAL_PATH = originalRoot;
  await fs.rm(storageRoot, { recursive: true, force: true });
});

describe('assertSafeStoragePath', () => {
  it('resolves a relative stored path inside the root', () => {
    const resolved = assertSafeStoragePath(storageRoot, path.join('org_1', 'brief.pdf'));
    expect(resolved).toBe(path.join(storageRoot, 'org_1', 'brief.pdf'));
  });

  it('rejects a traversal that escapes the root', () => {
    expect(() => assertSafeStoragePath(storageRoot, '../../etc/passwd')).toThrowError(
      expect.objectContaining({ statusCode: 400 })
    );
  });

  it('rejects an absolute path outside the root', () => {
    expect(() => assertSafeStoragePath(storageRoot, '/etc/passwd')).toThrowError(
      expect.objectContaining({ statusCode: 400 })
    );
  });
});

describe('readStoredFile', () => {
  it('reads a stored file from the configured root', async () => {
    const file = await readStoredFile({
      storagePath: path.join('org_1', 'brief.pdf'),
      originalName: 'brief.pdf',
      mimeType: 'application/pdf',
    });

    expect(file.buffer.toString()).toBe('pdf-bytes');
    expect(file.size).toBe(9);
    expect(file.mimeType).toBe('application/pdf');
  });

  it('answers 404 for a missing blob', async () => {
    await expect(
      readStoredFile({
        storagePath: path.join('org_1', 'missing.pdf'),
        originalName: 'missing.pdf',
        mimeType: 'application/pdf',
      })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('refuses to read outside the storage root', async () => {
    await expect(
      readStoredFile({
        storagePath: '../../../etc/passwd',
        originalName: 'passwd',
        mimeType: 'text/plain',
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('defaults to octet-stream when the asset has no mime type', async () => {
    const file = await readStoredFile({
      storagePath: path.join('org_1', 'brief.pdf'),
      originalName: 'brief.pdf',
      mimeType: null,
    });
    expect(file.mimeType).toBe('application/octet-stream');
  });
});

describe('sanitizeFileName', () => {
  it('strips directories and unsafe characters from a download name', () => {
    // path.basename() drops the directories, then every unsafe character becomes
    // an underscore — the served Content-Disposition name cannot traverse paths
    // or carry shell metacharacters.
    expect(sanitizeFileName('../../evil;rm -rf.pdf')).toBe('evil_rm_-rf.pdf');
    expect(sanitizeFileName('brief.pdf')).toBe('brief.pdf');
  });

  it('falls back to a safe default for an empty name', () => {
    expect(sanitizeFileName('')).toBe('download.bin');
  });
});

describe('resolveStorageRoot', () => {
  it('honours STORAGE_LOCAL_PATH', () => {
    expect(resolveStorageRoot()).toBe(path.resolve(storageRoot));
  });
});
