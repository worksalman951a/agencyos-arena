// Vitest setup file.
import '@testing-library/jest-dom/vitest';

// React Testing Library's automatic cleanup only registers when a global
// `afterEach` exists. Vitest is not configured with `globals: true`, so
// components rendered by one test stayed mounted; React's scheduler then ran
// work while the jsdom environment was being torn down, which surfaces as
// "ReferenceError: window is not defined" unhandled errors (and a non-zero exit
// even when every assertion passed). Unmount explicitly after each test.
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Unit tests have no clamd daemon to scan uploaded bytes, exactly like the CI
// integration server (which sets the same variable for the server it starts).
// Opting in here keeps the file-upload paths clean-scannable without making the
// fallback implicit in production code — see
// lib/services/security/malware-scanner-service.ts. The default (fail closed) is
// asserted in lib/__tests__/security/malware-scanning.test.ts, which overrides
// this variable for that case.
process.env.MALWARE_SCANNER_ALLOW_OFFLINE_CLEAN ??= 'true';

afterEach(() => {
  cleanup();
});
