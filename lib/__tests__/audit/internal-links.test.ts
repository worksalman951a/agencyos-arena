/**
 * Audit: no dead internal links.
 *
 * Every `href="/…"` literal in `app/` and `components/` must resolve to a page
 * that exists (dynamic segments match anything in their position). A renamed
 * route otherwise leaves a link that 404s only when a user clicks it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '.git', 'dist', 'out'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function routePatterns(): string[] {
  return walk(path.join(ROOT, 'app'))
    .filter((file) => file.endsWith('page.tsx'))
    .map((file) => {
      const rel = path.relative(path.join(ROOT, 'app'), file).split(path.sep).join('/');
      return '/' + rel.replace(/\/page\.tsx$/, '').replace(/^page\.tsx$/, '');
    });
}

function routeExists(href: string, patterns: string[]): boolean {
  const clean = (href.split('?')[0].split('#')[0].replace(/\/$/, '') || '/').toLowerCase();
  const segments = clean.split('/').filter(Boolean);
  return patterns.some((pattern) => {
    const patternSegments = pattern.toLowerCase().split('/').filter(Boolean);
    if (patternSegments.length !== segments.length) return false;
    return patternSegments.every((segment, index) =>
      segment.startsWith('[') ? true : segment === segments[index]
    );
  });
}

describe('internal links', () => {
  const patterns = routePatterns();
  const sources = walk(path.join(ROOT, 'app'))
    .concat(walk(path.join(ROOT, 'components')))
    .filter((file) => /\.(tsx?|jsx?)$/.test(file) && !file.includes('__tests__'));

  it('resolves every static internal href to an existing page', () => {
    const dead: string[] = [];

    for (const file of sources) {
      const source = fs.readFileSync(file, 'utf8');
      const hrefs = [
        ...source.matchAll(/href=(?:"([^"]*)"|\{'([^']*)'\}|`([^`$]*)`)/g),
        ...source.matchAll(/router\.(?:push|replace)\(\s*['"`]([^'"`$]*)['"`]/g),
      ];
      for (const match of hrefs) {
        const href = match[1] ?? match[2] ?? match[3];
        if (!href || !href.startsWith('/') || href.startsWith('//')) continue;
        // API endpoints, anchors inside a page, and asset buckets are not pages.
        if (/^\/(api|_next)\//.test(href) || href === '/') continue;
        if (!routeExists(href, patterns)) {
          dead.push(`${path.relative(ROOT, file)} -> ${href}`);
        }
      }
    }

    expect(dead).toEqual([]);
  });
});
