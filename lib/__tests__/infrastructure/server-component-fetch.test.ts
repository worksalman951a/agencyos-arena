/**
 * Regression guard: Server Components must not use browser-only APIs.
 *
 * Three bug classes were fixed in this codebase and must not return:
 *
 * 1. `await fetch('/api/v1/...')` in a Server Component. There is no origin in
 *    the Node.js runtime, so this throws `Failed to parse URL`. Server
 *    Components must call the service layer directly (see lib/page-data.ts).
 *
 * 2. Event handlers (`onClick`, `onSubmit`, `onChange`) inside a Server
 *    Component. Handlers cannot be serialised to the client, so the element
 *    throws at render time ("Event handlers cannot be passed to Client
 *    Component props"). Interactive markup belongs in a `'use client'` module.
 *
 * 3. Browser globals (`window`, `document`) referenced during server render.
 *
 * Client Components ('use client') are unaffected: relative fetch, handlers and
 * browser globals are all correct there.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const APP_DIR = path.join(ROOT, 'app');

function collectFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) collectFiles(full, acc);
    else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) acc.push(full);
  }
  return acc;
}

interface Finding {
  file: string;
  line: number;
  rule: string;
  detail: string;
}

function analyse(file: string): Finding[] {
  const source = readFileSync(file, 'utf8');
  const isClientComponent = /^\s*['"]use client['"]/m.test(source);
  if (isClientComponent) return [];

  // Route handlers legitimately parse `new URL(request.url)`; they must still
  // not call themselves over HTTP, so they are checked like any server module.
  const findings: Finding[] = [];

  source.split('\n').forEach((line, index) => {
    const code = line.trim();
    if (!code || code.startsWith('//') || code.startsWith('*')) return;

    const relativeFetch = /fetch\(\s*[`'"]\//.exec(code);
    if (relativeFetch) {
      findings.push({
        file,
        line: index + 1,
        rule: 'relative-fetch',
        detail: code,
      });
    }

    const handler = /\b(onClick|onSubmit|onChange)=\{/.exec(code);
    if (handler) {
      findings.push({
        file,
        line: index + 1,
        rule: 'event-handler-in-server-component',
        detail: code,
      });
    }

    const browserGlobal = /\b(window|document|localStorage|sessionStorage)\./.exec(code);
    if (browserGlobal) {
      findings.push({
        file,
        line: index + 1,
        rule: 'browser-global-in-server-module',
        detail: code,
      });
    }
  });

  return findings;
}

function format(findings: Finding[]): string {
  return findings
    .map((f) => `${path.relative(ROOT, f.file)}:${f.line} [${f.rule}] ${f.detail}`)
    .join('\n');
}

describe('Server Components do not use browser-only APIs', () => {
  it('never calls its own API with a relative fetch', () => {
    const findings = collectFiles(APP_DIR)
      .flatMap(analyse)
      .filter((f) => f.rule === 'relative-fetch');

    expect(
      findings,
      `\nRelative fetch() in a server module throws "Failed to parse URL" in the Node.js runtime.\n` +
        `Call the service layer directly (see lib/page-data.ts) instead:\n${format(findings)}\n`
    ).toEqual([]);
  });

  it('never passes event handlers from a Server Component', () => {
    const findings = collectFiles(APP_DIR)
      .flatMap(analyse)
      .filter((f) => f.rule === 'event-handler-in-server-component');

    expect(
      findings,
      `\nEvent handlers cannot be passed from Server Components; move the markup into a\n` +
        `'use client' module (or use a form action):\n${format(findings)}\n`
    ).toEqual([]);
  });

  it('never touches browser globals while rendering on the server', () => {
    const findings = collectFiles(APP_DIR)
      .flatMap(analyse)
      .filter((f) => f.rule === 'browser-global-in-server-module');

    expect(
      findings,
      `\nwindow/document do not exist in the Node.js runtime:\n${format(findings)}\n`
    ).toEqual([]);
  });

  it('scans a meaningful number of App Router modules', () => {
    expect(collectFiles(APP_DIR).length).toBeGreaterThan(100);
  });
});
