import 'server-only';

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

/**
 * PostgreSQL connection pool.
 *
 * Prisma 7 talks to Postgres through the pg driver adapter, which manages a pool
 * internally. The limits are configured explicitly here instead of being left to
 * the driver's defaults:
 *
 * - `max` bounds the number of server connections, so a development server with
 *   several concurrent renders cannot exhaust PostgreSQL's connection slots.
 * - `connectionTimeoutMillis` makes an unreachable database surface as an error
 *   (which /admin/health and the API error boundary report) instead of a request
 *   that hangs indefinitely.
 * - `idleTimeoutMillis` releases connections that are no longer used.
 *
 * Note on concurrency: within `prisma.$transaction(...)` every statement shares
 * one pinned connection, so issuing statements concurrently there serialises in
 * pg's (now deprecated) internal queue. Read-only pairs of statements are
 * therefore run with `Promise.all` outside a transaction — see the CRM services.
 */
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

const globalForPrisma = globalThis as unknown as {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error'],
  });

// Reuse one client (and therefore one pool) across hot reloads in development;
// a new pool per module reload leaks connections until Postgres refuses them.
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
