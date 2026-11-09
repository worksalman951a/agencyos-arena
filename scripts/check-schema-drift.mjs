#!/usr/bin/env node
/**
 * AgencyOS schema-drift check.
 *
 * lib/db.ts intentionally exports the Prisma client as `any` (global cache
 * escape hatch), so TypeScript cannot validate query payloads. That means a
 * service can write a column that does not exist in prisma/schema.prisma and
 * the only symptom is a 500 at runtime — which is exactly how
 * `Estimate.notes` and `Task.createdBy` shipped broken.
 *
 * This script statically compares the top-level `data` keys of every
 * prisma.<model>.create / update / createMany / upsert call in lib/services and
 * app/api against the fields declared in prisma/schema.prisma.
 *
 * Exits non-zero when a write references an unknown field.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SCHEMA_PATH = path.join(ROOT, 'prisma', 'schema.prisma');
const SCAN_DIRS = ['lib/services', 'app/api'];
const OPS = ['create', 'update', 'createMany', 'upsert'];

/** Parse `model Name { ... }` blocks into a map of model -> declared field names. */
function parseModels(source) {
  const models = new Map();
  const modelRe = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let match;
  while ((match = modelRe.exec(source)) !== null) {
    const [, name, body] = match;
    const fields = new Set();
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('//') || line.startsWith('@@')) continue;
      const field = line.split(/\s+/)[0];
      if (/^\w+$/.test(field)) fields.add(field);
    }
    models.set(name, fields);
  }
  return models;
}

/** Recursively collect .ts files under the given directories. */
function collectFiles(dirs) {
  const files = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) files.push(full);
    }
  };
  for (const dir of dirs) walk(path.join(ROOT, dir));
  return files;
}

/** Return the index just past the brace that closes the one at `openIndex`. */
function skipObject(source, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return source.length;
}

/** Collect top-level property keys of an object literal body. */
function topLevelKeys(objectBody) {
  const keys = [];
  let depth = 0;
  for (const rawLine of objectBody.split('\n')) {
    const line = rawLine.trim();
    if (depth === 0 && line && !line.startsWith('//')) {
      const m = line.match(/^(\w+)\s*:/) || line.match(/^(\w+)\s*,?$/);
      if (m) keys.push(m[1]);
    }
    depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
  }
  return keys;
}

const schema = readFileSync(SCHEMA_PATH, 'utf8');
const models = parseModels(schema);
const accessorToModel = new Map();
for (const name of models.keys()) {
  accessorToModel.set(name[0].toLowerCase() + name.slice(1), name);
}

const problems = [];
const callRe = new RegExp(`prisma\\.(\\w+)\\.(${OPS.join('|')})\\(\\s*\\{`, 'g');

for (const file of collectFiles(SCAN_DIRS)) {
  const source = readFileSync(file, 'utf8');
  callRe.lastIndex = 0;
  let match;
  while ((match = callRe.exec(source)) !== null) {
    const model = accessorToModel.get(match[1]);
    if (!model) continue;

    const callBodyEnd = skipObject(source, match.index + match[0].length - 1);
    const callBody = source.slice(match.index + match[0].length, callBodyEnd - 1);

    const dataMatch = callBody.match(/\bdata\s*:\s*\{/);
    if (!dataMatch) continue;

    const dataStart = callBody.indexOf('{', dataMatch.index);
    const dataEnd = skipObject(callBody, dataStart);
    const dataBody = callBody.slice(dataStart + 1, dataEnd - 1);

    for (const key of topLevelKeys(dataBody)) {
      if (!models.get(model).has(key)) {
        const line = source.slice(0, match.index).split('\n').length;
        problems.push({ file: path.relative(ROOT, file), line, model, field: key });
      }
    }
  }
}

if (problems.length > 0) {
  console.error(`Schema drift detected: ${problems.length} unknown field write(s).\n`);
  for (const p of problems) {
    console.error(`  ${p.file}:${p.line}  ${p.model}.${p.field} is not declared in schema.prisma`);
  }
  console.error('\nAdd the column to prisma/schema.prisma with a migration, or fix the service.');
  process.exit(1);
}

console.log(
  `Schema drift check passed: every prisma write in ${SCAN_DIRS.join(', ')} uses declared fields (${models.size} models).`
);
