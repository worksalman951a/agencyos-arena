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

afterEach(() => {
  cleanup();
});
