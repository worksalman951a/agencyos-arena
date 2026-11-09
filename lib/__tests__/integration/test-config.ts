/**
 * Shared configuration for AgencyOS integration tests.
 *
 * Integration tests drive real HTTP endpoints, so the server URL must be
 * resolved from the environment instead of being hardcoded:
 *
 *   1. TEST_SERVER_URL     - explicit override (CI and local runs)
 *   2. BETTER_AUTH_URL     - the canonical app URL used by Better Auth
 *   3. http://localhost:3001 - local development default
 *
 * Port 3000 is reserved for a different local project and must never be
 * contacted by AgencyOS, locally or in CI.
 */

const DEFAULT_TEST_SERVER_URL = 'http://localhost:3001';

export const SERVER_URL =
  process.env.TEST_SERVER_URL ?? process.env.BETTER_AUTH_URL ?? DEFAULT_TEST_SERVER_URL;
