/**
 * Audit: every state-changing route is covered by the origin check.
 *
 * The origin check lives in `middleware.ts` and matches `/api/v1/*` plus the
 * `bootstrap-organization` handler. That is a *pattern*, so a future route added
 * outside it (say `/api/internal/...` or a new `/api/auth/...` sibling) would be
 * unprotected and nothing else in the suite would notice: the route-level tests
 * assert behaviour, not coverage.
 *
 * This guard walks the route handlers that export an unsafe method and fails if
 * any of them is outside the protected patterns without being explicitly
 * justified below.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const API_DIR = path.join(ROOT, 'app', 'api');

/** Mirrors `CSRF_PROTECTED_API_PREFIXES` / `CSRF_PROTECTED_EXTRA_PATHS` in middleware.ts. */
const PROTECTED_PREFIXES = ['v1/'];
const PROTECTED_EXACT = ['auth/bootstrap-organization/route.ts'];

/**
 * Unsafe-method routes that intentionally rely on another origin defence.
 * Each entry must state what performs the check instead.
 */
const JUSTIFIED: Record<string, string> = {
  'auth/[...slug]/route.ts':
    "Better Auth's own originCheckMiddleware + formCsrfMiddleware validate Origin and Fetch Metadata on every unsafe request (node_modules/better-auth/dist/api/middlewares/origin-check.mjs).",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name === 'route.ts') out.push(full);
  }
  return out;
}

const relative = (file: string) => path.relative(API_DIR, file).split(path.sep).join('/');

describe('CSRF coverage of state-changing API routes', () => {
  const routes = walk(API_DIR).map(relative);

  const mutating = routes.filter((route) => {
    const source = fs.readFileSync(path.join(API_DIR, route), 'utf8');
    return /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\b/.test(source);
  });

  it('finds the mutating routes', () => {
    expect(mutating.length).toBeGreaterThan(50);
  });

  it('has no mutating route outside the middleware-protected patterns', () => {
    const uncovered = mutating.filter((route) => {
      if (JUSTIFIED[route]) return false;
      if (PROTECTED_EXACT.includes(route)) return false;
      return !PROTECTED_PREFIXES.some((prefix) => route.startsWith(prefix));
    });

    expect(uncovered).toEqual([]);
  });

  it('keeps every justification honest', () => {
    for (const [route, reason] of Object.entries(JUSTIFIED)) {
      expect(routes, `${route} should exist`).toContain(route);
      expect(reason.length, `${route} needs a real reason`).toBeGreaterThan(20);
    }
  });

  it('declares the bootstrap handler as protected in middleware', () => {
    const middleware = fs.readFileSync(path.join(ROOT, 'middleware.ts'), 'utf8');
    expect(middleware).toContain("'/api/auth/bootstrap-organization'");
    expect(middleware).toContain("'/api/v1/'");
  });
});
