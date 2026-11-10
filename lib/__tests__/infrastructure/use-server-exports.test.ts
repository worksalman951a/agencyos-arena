/**
 * `'use server'` modules may only export async functions.
 *
 * Exporting a class or a plain value from such a module makes Next.js drop every
 * export ("The module has no exports at all"), which only shows up during the
 * production build — tsc and the unit tests stay green. That is exactly how the
 * settings API route broke, so this guard keeps it from happening again.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOTS = ['lib', 'app'];

function walk(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];

  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.next' || entry === '__tests__') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      files.push(...walk(path));
    } else if (path.endsWith('.ts') || path.endsWith('.tsx')) {
      files.push(path);
    }
  }

  return files;
}

function serverActionFiles(): string[] {
  return ROOTS.flatMap((root) => walk(root)).filter((file) => {
    const source = readFileSync(file, 'utf8');
    const head = source.slice(0, 200);
    return /^\s*['"]use server['"];?/.test(head);
  });
}

describe("'use server' module exports", () => {
  const files = serverActionFiles();

  it('finds the server action modules', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('never exports classes or plain values', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      if (/^\s*export\s+class\s/m.test(source)) offenders.push(`${file} (class)`);
      if (/^\s*export\s+(?:const|let|var)\s+\w+\s*=/m.test(source))
        offenders.push(`${file} (value)`);
    }

    expect(offenders).toEqual([]);
  });
});
