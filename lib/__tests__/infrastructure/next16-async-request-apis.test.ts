/**
 * Next.js 16 async request APIs guard.
 *
 * In Next.js 16 (App Router) `params` and `searchParams` are Promises in both
 * server and client components. Reading them synchronously does not throw a
 * type error when the prop is typed loosely, but at runtime it yields
 * `undefined`:
 *
 *   const { id } = params;              // id === undefined  -> /api/.../undefined
 *   searchParams.page                   // undefined         -> filters ignored
 *
 * This test statically checks every page/layout under app/ so the regression
 * cannot be reintroduced silently. It complements the behavioural tests in
 * contact-detail-page-regression.test.tsx and edit-redirect-pages.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const APP_DIR = path.resolve(__dirname, '../../../app');

function collectFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) collectFiles(full, acc);
    else if (entry === 'page.tsx' || entry === 'layout.tsx') acc.push(full);
  }
  return acc;
}

interface Finding {
  file: string;
  line: number;
  code: string;
  reason: string;
}

function analyse(file: string): Finding[] {
  const source = readFileSync(file, 'utf8');
  const lines = source.split('\n');
  const findings: Finding[] = [];

  const isClient = /^\s*['"]use client['"]/m.test(source);

  // Accepted ways of consuming the async request APIs.
  // Either style counts: `await params` or `const p = await paramsPromise`.
  const awaitsParams = /=\s*await\s+params(Promise)?\b/.test(source);
  const awaitsSearchParams = /=\s*await\s+searchParams(Promise)?\b/.test(source);
  const usesUseParams = /\buseParams\s*\(/.test(source);
  const usesUseSearchParams = /\buseSearchParams\s*\(/.test(source);
  const usesReactUse = /\buse\s*\(\s*params\s*\)/.test(source);
  const chainsParams = /\bparams\s*\.\s*then\s*\(/.test(source);

  lines.forEach((line, index) => {
    const code = line.trim();
    if (!code || code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
    if (code.startsWith('import ')) return;

    // 1. Synchronous destructuring of params.
    if (/^(const|let|var)\s*\{[^}]*\}\s*=\s*params\s*;/.test(code)) {
      findings.push({
        file,
        line: index + 1,
        code,
        reason: 'destructures params synchronously (params is a Promise)',
      });
      return;
    }

    // 2. Direct property access on params.
    if (/\bparams\s*\.\s*[A-Za-z_$]/.test(code) && !/\bparams\s*\.\s*then\s*\(/.test(code)) {
      const handled =
        (isClient && (usesUseParams || usesReactUse || chainsParams)) ||
        (!isClient && awaitsParams);
      if (!handled) {
        findings.push({
          file,
          line: index + 1,
          code,
          reason: 'accesses params.<prop> without awaiting/use()/useParams()',
        });
      }
      return;
    }

    // 3. Direct property access on searchParams.
    if (/\bsearchParams\s*\.\s*[A-Za-z_$]/.test(code) && !/\buseSearchParams\b/.test(code)) {
      const handled = usesUseSearchParams || awaitsSearchParams;
      if (!handled) {
        findings.push({
          file,
          line: index + 1,
          code,
          reason: 'accesses searchParams.<prop> without awaiting it or useSearchParams()',
        });
      }
    }
  });

  return findings;
}

describe('Next.js 16 async request APIs', () => {
  it('never reads params or searchParams synchronously in app/**/page.tsx or layout.tsx', () => {
    const files = collectFiles(APP_DIR);
    const findings = files.flatMap(analyse);

    const report = findings
      .map(
        (f) =>
          `${path.relative(path.resolve(__dirname, '../../..'), f.file)}:${f.line} — ${f.code}\n    ${f.reason}`
      )
      .join('\n');

    expect(findings, `\nSynchronous Next.js 16 request-API access found:\n${report}\n`).toEqual([]);
  });

  it('scans a meaningful number of route files', () => {
    expect(collectFiles(APP_DIR).length).toBeGreaterThan(80);
  });
});
