/**
 * Audit: every API route reaches the database through an authenticated path.
 *
 * Routes delegate to `lib/services/**`, where the session organization is
 * resolved and permissions are enforced. A route that talks to Prisma directly
 * (or to a service nothing guards) would bypass that, and neither TypeScript nor
 * the service tests would notice — so both are checked against the source.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const APP_DIR = path.join(ROOT, 'app');
const API_DIR = path.join(APP_DIR, 'api');
const SERVICES_DIR = path.join(ROOT, 'lib', 'services');

/** Public endpoints, with the reason they may skip the session guard. */
const PUBLIC_ROUTES: Record<string, string> = {
  'api/auth/[...slug]/route.ts': 'Better Auth owns its own session handling.',
  'api/health/route.ts': 'Liveness probe: unauthenticated by design, reports no tenant data.',
  'api/v1/documents/links/[token]/route.ts':
    'Public share links: the unguessable token is the credential.',
  'api/auth/bootstrap-organization/route.ts':
    'Sign-up hand-off: authenticates the caller itself before creating the organization.',
};

/**
 * Service modules that intentionally do not authenticate: they run inside a
 * transaction opened by a guarded caller, or they are pure helpers.
 */
const UNGUARDED_SERVICES = new Set(['lib/services/settings/document-numbering.ts']);

const GUARD_PATTERN =
  /requirePermission|requireOrganization|getAuthorizedUser|auth\.api\.getSession|getSessionUser|assertAuthenticated/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const relative = (file: string) => path.relative(ROOT, file).split(path.sep).join('/');

describe('API route authorization', () => {
  const routes = walk(API_DIR).filter(
    (file) => file.endsWith('route.ts') && !file.includes('__tests__')
  );
  const publicRoutes = new Set(Object.keys(PUBLIC_ROUTES));
  const guardedRoutes = routes
    .map(relative)
    .map((file) => file.replace(/^app\//, ''))
    .filter((file) => !publicRoutes.has(file));

  it('finds the API routes', () => {
    expect(routes.length).toBeGreaterThan(50);
  });

  it('never touches Prisma directly outside the public allow-list', () => {
    const bypassing = guardedRoutes.filter((file) =>
      fs.readFileSync(path.join(APP_DIR, file), 'utf8').includes('@/lib/db')
    );

    expect(bypassing).toEqual([]);
  });

  it('delegates every guarded route to the service layer', () => {
    const orphaned = guardedRoutes.filter((file) => {
      const source = fs.readFileSync(path.join(APP_DIR, file), 'utf8');
      return !source.includes('@/lib/services/') && !GUARD_PATTERN.test(source);
    });

    expect(orphaned).toEqual([]);
  });

  it('keeps every public route justified', () => {
    for (const [route, reason] of Object.entries(PUBLIC_ROUTES)) {
      expect(fs.existsSync(path.join(APP_DIR, route)), `${route} should exist`).toBe(true);
      expect(reason.length).toBeGreaterThan(10);
    }
  });
});

describe('service layer authorization', () => {
  const services = walk(SERVICES_DIR).filter(
    (file) => file.endsWith('.ts') && !file.includes('__tests__') && !file.endsWith('.test.ts')
  );

  it('authenticates every service that reaches the database', () => {
    const unguarded = services
      .map(relative)
      .filter((file) => !UNGUARDED_SERVICES.has(file))
      .filter((file) => {
        const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
        if (!source.includes('@/lib/db')) return false;
        return !GUARD_PATTERN.test(source);
      });

    expect(unguarded).toEqual([]);
  });

  it('keeps the unguarded-service allow-list honest', () => {
    for (const file of UNGUARDED_SERVICES) {
      expect(fs.existsSync(path.join(ROOT, file)), `${file} should exist`).toBe(true);
    }
  });
});
