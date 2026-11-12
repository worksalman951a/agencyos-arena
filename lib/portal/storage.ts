/**
 * Local file storage helpers for portal downloads.
 *
 * The portal serves files that internal staff uploaded into the same storage root
 * (`STORAGE_LOCAL_PATH`). Path resolution is confined to that root: a stored path
 * that escapes it (absolute path, `..`, symlink-style prefix) is rejected instead
 * of being read.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { codedError } from '@/lib/portal/access-control';

export function resolveStorageRoot(): string {
  return path.resolve(
    /*turbopackIgnore: true*/
    process.env.STORAGE_LOCAL_PATH ||
      path.join(/*turbopackIgnore: true*/ process.cwd(), 'storage', 'uploads')
  );
}

export function sanitizeFileName(rawName: string): string {
  const base = path.basename(rawName || 'download.bin');
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '');
  return (cleaned || 'download.bin').slice(0, 180);
}

/** Resolve a stored path inside the storage root, or throw 400. */
export function assertSafeStoragePath(storageRoot: string, storedPath: string): string {
  const resolved = path.resolve(storageRoot, storedPath);
  if (resolved !== storageRoot && !resolved.startsWith(storageRoot + path.sep)) {
    throw codedError('Invalid storage path', 400);
  }
  return resolved;
}

export interface StoredFile {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  size: number;
}

/**
 * Read a stored file by its `FileAsset.storagePath`.
 *
 * A missing blob is reported as 404: the caller already knows the metadata row
 * exists, and there is no advantage to distinguishing the two cases.
 */
export async function readStoredFile(input: {
  storagePath: string;
  originalName: string;
  mimeType: string | null;
}): Promise<StoredFile> {
  const storageRoot = resolveStorageRoot();
  const absolutePath = assertSafeStoragePath(storageRoot, input.storagePath);

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(/*turbopackIgnore: true*/ absolutePath);
  } catch {
    throw codedError('File content not found', 404);
  }

  return {
    buffer,
    originalName: sanitizeFileName(input.originalName),
    mimeType: input.mimeType || 'application/octet-stream',
    size: buffer.byteLength,
  };
}
