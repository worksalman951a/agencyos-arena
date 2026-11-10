/**
 * Audit: every authenticated module renders the shared shell.
 *
 * The sidebar, header, permission filtering and toasts live in the single
 * `ModuleShell`. A module that ships pages without a layout silently renders
 * them without navigation, which is how "missing sidebar" regressions start.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const APP_DIR = path.join(process.cwd(), 'app');

/** Route groups that are intentionally outside the authenticated shell. */
const PUBLIC_DIRS = new Set(['login', 'register', 'api']);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

describe('module layouts', () => {
  const modules = fs
    .readdirSync(APP_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !PUBLIC_DIRS.has(entry.name))
    .map((entry) => entry.name)
    .filter((name) => walk(path.join(APP_DIR, name)).some((file) => file.endsWith('page.tsx')));

  it('finds the application modules', () => {
    expect(modules.length).toBeGreaterThanOrEqual(8);
  });

  it('gives every module a layout that renders ModuleShell', () => {
    const missing = modules.filter((name) => {
      const layout = path.join(APP_DIR, name, 'layout.tsx');
      if (!fs.existsSync(layout)) return true;
      const source = fs.readFileSync(layout, 'utf8');
      return !source.includes('ModuleShell');
    });

    expect(missing).toEqual([]);
  });

  it('does not let a page render its own sidebar or header wrapper', () => {
    const offenders: string[] = [];
    for (const name of modules) {
      for (const file of walk(path.join(APP_DIR, name))) {
        if (!file.endsWith('page.tsx')) continue;
        const source = fs.readFileSync(file, 'utf8');
        if (/<AppShell\b/.test(source)) offenders.push(path.relative(APP_DIR, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
