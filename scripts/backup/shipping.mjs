/**
 * Off-site shipping of ALREADY ENCRYPTED backup replicas to one S3-compatible
 * bucket, plus a hash-chained local inventory (Phase 4D / Batch 3C-2B).
 *
 * Deliberately small and dependency-free (Node built-ins only):
 *
 *  - Only `<archive>.age` files produced by `replication.mjs` are shipped. The
 *    shipper never sees the replication key or a plaintext archive.
 *  - HTTPS only. Redirects are not followed, so there is no downgrade path.
 *  - An object is never replaced: an existing key is read back and compared,
 *    and the upload itself is conditional (`If-None-Match: *`).
 *  - Every shipped object is downloaded again and its SHA-256 compared.
 *  - The identity needs GetObject, PutObject and ListBucket only. Nothing here
 *    issues a DELETE, and nothing assumes object lock or versioning exists.
 *  - The inventory is tamper-EVIDENT only against someone who cannot rewrite
 *    the whole file. It is advisory until its head hash is anchored elsewhere.
 */
import { createHash, createHmac } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, mkdtemp, open, readFile, rm } from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { ARCHIVE_NAME_PATTERN } from './retention.mjs';
import { protectedDirectory, recover } from './replication.mjs';

const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');
const GENESIS = '0'.repeat(64);
const AGE_HEADER = Buffer.from('age-encryption.org/v1\n-> scrypt ');
/** Largest object a single S3 PutObject accepts. Multipart is not implemented. */
const MAX_OBJECT_BYTES = 5 * 1024 ** 3;
const MAX_INVENTORY_BYTES = 64 * 1024 * 1024;
const SHA256 = /^[0-9a-f]{64}$/;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

/**
 * An error whose message is safe to print: it never contains credentials,
 * response bodies or backup contents.
 */
export class ShippingError extends Error {
  /** @param {string} message @param {{ transient?: boolean, mismatch?: boolean }} [flags] */
  constructor(message, { transient = false, mismatch = false } = {}) {
    super(message);
    this.name = 'ShippingError';
    this.transient = transient;
    this.mismatch = mismatch;
  }
}
const fail = (message, flags) => {
  throw new ShippingError(message, flags);
};

/**
 * Validate the shipping configuration. Anything missing or malformed fails
 * closed. Credentials are kept non-enumerable so the returned object can be
 * logged or serialized without exposing them.
 *
 * @param {Record<string, string | undefined>} env
 */
export async function loadShippingConfig(env = process.env) {
  let endpoint;
  try {
    endpoint = new URL(env.BACKUP_SHIPPING_ENDPOINT ?? '');
  } catch {
    fail('BACKUP_SHIPPING_ENDPOINT must be an https:// URL');
  }
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== '/'
  )
    fail('BACKUP_SHIPPING_ENDPOINT must be a bare https:// origin (TLS is required)');
  const region = env.BACKUP_SHIPPING_REGION ?? '';
  if (!/^[a-z0-9-]{1,32}$/.test(region)) fail('BACKUP_SHIPPING_REGION is missing or invalid');
  const bucket = env.BACKUP_SHIPPING_BUCKET ?? '';
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || bucket.includes('..'))
    fail('BACKUP_SHIPPING_BUCKET is missing or invalid');
  const prefix = env.BACKUP_SHIPPING_PREFIX ?? '';
  if (prefix && !/^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/.test(prefix))
    fail('BACKUP_SHIPPING_PREFIX is invalid');
  const accessKeyId = env.BACKUP_SHIPPING_ACCESS_KEY_ID ?? '';
  const secretAccessKey = env.BACKUP_SHIPPING_SECRET_ACCESS_KEY ?? '';
  const sessionToken = env.BACKUP_SHIPPING_SESSION_TOKEN || null;
  if (
    !/^[A-Za-z0-9]{3,128}$/.test(accessKeyId) ||
    !/^[\x21-\x7e]{8,256}$/.test(secretAccessKey) ||
    (sessionToken && !/^[\x21-\x7e]{1,4096}$/.test(sessionToken))
  )
    fail('Object storage credentials are missing or malformed');
  const keyId = env.BACKUP_REPLICATION_KEY_ID ?? '';
  if (!KEY_ID.test(keyId))
    fail('BACKUP_REPLICATION_KEY_ID (a non-secret key version label) is required');
  const inventory = env.BACKUP_SHIPPING_INVENTORY ?? '';
  if (!path.isAbsolute(inventory)) fail('BACKUP_SHIPPING_INVENTORY must be an absolute path');
  const attempts = Number(env.BACKUP_SHIPPING_ATTEMPTS ?? '3');
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10)
    fail('BACKUP_SHIPPING_ATTEMPTS must be between 1 and 10');
  let ca;
  if (env.BACKUP_SHIPPING_CA_FILE) {
    // An additional trust anchor for a privately issued certificate. It can
    // only add a CA; certificate verification is never disabled.
    if (!path.isAbsolute(env.BACKUP_SHIPPING_CA_FILE))
      fail('BACKUP_SHIPPING_CA_FILE must be an absolute path');
    try {
      ca = await readFile(env.BACKUP_SHIPPING_CA_FILE);
    } catch {
      fail('BACKUP_SHIPPING_CA_FILE could not be read');
    }
  }
  const config = {
    endpoint: endpoint.origin,
    host: endpoint.host,
    hostname: endpoint.hostname,
    port: endpoint.port ? Number(endpoint.port) : 443,
    region,
    bucket,
    prefix,
    keyId,
    inventory: path.resolve(inventory),
    replicaDir: env.BACKUP_REPLICATION_DIR ?? null,
    attempts,
    retryDelayMs: 1000,
    timeoutMs: 60_000,
    ca,
  };
  Object.defineProperty(config, 'credentials', {
    enumerable: false,
    value: Object.freeze({ accessKeyId, secretAccessKey, sessionToken }),
  });
  return config;
}

/** Names of environment variables that must never reach a child process. */
export const SHIPPING_SECRET_ENV = Object.freeze([
  'BACKUP_SHIPPING_ACCESS_KEY_ID',
  'BACKUP_SHIPPING_SECRET_ACCESS_KEY',
  'BACKUP_SHIPPING_SESSION_TOKEN',
]);

const hmac = (key, value) => createHmac('sha256', key).update(value).digest();

/**
 * AWS Signature Version 4 for a path-style S3 request with no query string.
 * Object keys are restricted to URI-unreserved characters and `/`, so the
 * canonical path needs no further encoding.
 *
 * @returns {Record<string, string>} the headers to send, including Authorization
 */
export function signRequest({
  method,
  host,
  pathname,
  headers = {},
  payloadHash,
  region,
  credentials,
  now,
}) {
  const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  /** @type {Record<string, string>} */
  const all = { ...headers, host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  if (credentials.sessionToken) all['x-amz-security-token'] = credentials.sessionToken;
  // content-length is transport framing; the payload hash already covers the body.
  const names = Object.keys(all)
    .filter((name) => name !== 'content-length')
    .sort();
  const signedHeaders = names.join(';');
  const canonical = [
    method,
    pathname,
    '',
    ...names.map((name) => `${name}:${all[name].trim()}`),
    '',
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${date}/${region}/s3/aws4_request`;
  const toSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    createHash('sha256').update(canonical).digest('hex'),
  ].join('\n');
  let key = hmac(`AWS4${credentials.secretAccessKey}`, date);
  for (const part of [region, 's3', 'aws4_request']) key = hmac(key, part);
  const signature = hmac(key, toSign).toString('hex');
  return {
    ...all,
    authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

/**
 * One signed HTTPS request. A 2xx body is streamed into `sink`; any other body
 * is discarded except for its S3 error code. Response bodies are never logged:
 * S3 error documents can echo the access key id and the string to sign.
 */
function s3Request(
  config,
  { method, key, payloadHash = EMPTY_SHA256, headers = {}, source, sink }
) {
  return new Promise((resolve, reject) => {
    const pathname = `/${config.bucket}/${key}`;
    const request = https.request(
      {
        hostname: config.hostname,
        port: config.port,
        method,
        path: pathname,
        ca: config.ca,
        timeout: config.timeoutMs,
        headers: signRequest({
          method,
          host: config.host,
          pathname,
          headers,
          payloadHash,
          region: config.region,
          credentials: config.credentials,
          now: new Date(),
        }),
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 200 && status < 300 && sink) {
          pipeline(response, sink).then(() => resolve({ status, code: null }), reject);
          return;
        }
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          if (size < 65536) chunks.push(chunk);
          size += chunk.length;
        });
        response.on('error', reject);
        response.on('end', () => {
          const body = Buffer.concat(chunks).toString('latin1');
          resolve({ status, code: /<Code>([A-Za-z0-9]{1,64})<\/Code>/.exec(body)?.[1] ?? null });
        });
      }
    );
    request.on('timeout', () => request.destroy(new Error('Object storage request timed out')));
    request.on('error', reject);
    if (source) pipeline(source, request).catch(reject);
    else request.end();
  });
}

/** Turn an unexpected HTTP response into a safe error. 5xx, 408 and 429 may be retried. */
function httpFailure(action, { status, code }) {
  const transient = status >= 500 || status === 408 || status === 429;
  return new ShippingError(
    `Object storage ${action} failed (HTTP ${status}${code ? ` ${code}` : ''})`,
    { transient }
  );
}

/**
 * Download an object, hashing it as it streams and refusing more than `limit`
 * bytes. Returns `null` when the key does not exist.
 *
 * @returns {Promise<{ sha256: string, bytes: number } | null>}
 */
async function fetchObject(config, key, { limit, out = null }) {
  const hash = createHash('sha256');
  let bytes = 0;
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > limit)
        return callback(
          new ShippingError('Remote object does not match the expected size', { mismatch: true })
        );
      hash.update(chunk);
      if (out) out.write(chunk).then(() => callback(), callback);
      else callback();
    },
  });
  const response = await s3Request(config, { method: 'GET', key, sink });
  if (response.status === 404 && response.code === 'NoSuchKey') return null;
  if (response.status !== 200) throw httpFailure('download', response);
  return { sha256: hash.digest('hex'), bytes };
}

/** Retry transient failures (network errors, 5xx, throttling) with backoff. */
async function withRetries(config, operation) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const retryable = !(error instanceof ShippingError) || error.transient;
      if (!retryable) throw error;
      if (attempt >= config.attempts)
        fail(
          error instanceof ShippingError
            ? `${error.message}; gave up after ${attempt} attempt(s)`
            : `Object storage was unreachable or the connection failed; gave up after ${attempt} attempt(s)`
        );
      await sleep(config.retryDelayMs * 2 ** (attempt - 1));
    }
  }
}

function objectKey(config, name) {
  if (!ARCHIVE_NAME_PATTERN.test(name ?? '')) fail('Invalid backup name');
  return `${config.prefix ? `${config.prefix}/` : ''}${name}.age`;
}

/** Open the local encrypted replica and refuse anything that is not age ciphertext. */
async function localReplica(replicaDir, name) {
  let dir;
  try {
    dir = await protectedDirectory(replicaDir);
  } catch {
    fail('BACKUP_REPLICATION_DIR must be the protected directory holding encrypted replicas');
  }
  let handle;
  try {
    handle = await open(path.join(dir, `${name}.age`), READ_FLAGS);
  } catch {
    fail('Encrypted replica not found; run encrypted replication first');
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) fail('Encrypted replica is not a regular file');
    if (info.size > MAX_OBJECT_BYTES)
      fail('Encrypted replica exceeds the 5 GiB single-request limit; multipart is not supported');
    const head = Buffer.alloc(AGE_HEADER.length);
    await handle.read(head, 0, head.length, 0);
    if (!head.equals(AGE_HEADER))
      fail('Refusing to ship a file that is not an age-encrypted replica');
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false, start: 0 })) {
      hash.update(chunk);
      bytes += chunk.length;
    }
    if (bytes !== info.size) fail('Encrypted replica changed while it was being read');
    return { handle, bytes, sha256: hash.digest('hex'), createdAt: info.mtime.toISOString() };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Inventory: an append-only JSON-lines file in which every entry commits to
// the hash of the previous one.
// ---------------------------------------------------------------------------

const ENTRY_FIELDS = [
  'seq',
  'backupId',
  'sha256',
  'objectKey',
  'bytes',
  'createdAt',
  'keyId',
  'status',
  'recordedAt',
  'prev',
];
const entryHash = (entry) =>
  createHash('sha256')
    .update(JSON.stringify(ENTRY_FIELDS.map((field) => entry[field])))
    .digest('hex');

function validEntry(entry, seq, prev) {
  return (
    entry !== null &&
    typeof entry === 'object' &&
    Object.keys(entry).length === ENTRY_FIELDS.length + 1 &&
    entry.seq === seq &&
    entry.prev === prev &&
    ARCHIVE_NAME_PATTERN.test(entry.backupId) &&
    SHA256.test(entry.sha256) &&
    typeof entry.objectKey === 'string' &&
    entry.objectKey.endsWith(`${entry.backupId}.age`) &&
    Number.isSafeInteger(entry.bytes) &&
    entry.bytes > 0 &&
    typeof entry.createdAt === 'string' &&
    typeof entry.recordedAt === 'string' &&
    KEY_ID.test(entry.keyId) &&
    (entry.status === 'verified' || entry.status === 'failed') &&
    entry.hash === entryHash(entry)
  );
}

/**
 * Read the inventory and verify the whole chain. Any malformed line, gap,
 * reordering, edit or truncated final line fails; a missing file is an empty
 * inventory. Removing entries from the END, or replacing the entire file, is
 * NOT detectable from the file alone — compare `head` with a copy anchored
 * outside this host and storage account (see `assertAnchored`).
 *
 * @param {string} file absolute path inside a protected (0700) directory
 */
export async function readInventory(file) {
  if (!file || !path.isAbsolute(file)) fail('Inventory path must be absolute');
  try {
    await protectedDirectory(path.dirname(file));
  } catch {
    fail('Inventory directory must exist, be owned by this user and be mode 0700');
  }
  let handle;
  try {
    handle = await open(file, READ_FLAGS);
  } catch (error) {
    if (error.code === 'ENOENT') return { entries: [], head: GENESIS };
    fail('Inventory could not be opened');
  }
  let text;
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.uid !== process.getuid() || info.mode & 0o077)
      fail('Inventory must be an owner-only regular file');
    if (info.size > MAX_INVENTORY_BYTES) fail('Inventory is too large');
    text = await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
  const entries = [];
  let head = GENESIS;
  if (text) {
    if (!text.endsWith('\n')) fail('Inventory integrity check failed');
    for (const line of text.slice(0, -1).split('\n')) {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        fail('Inventory integrity check failed');
      }
      if (!validEntry(entry, entries.length + 1, head)) fail('Inventory integrity check failed');
      entries.push(entry);
      head = entry.hash;
    }
  }
  return { entries, head };
}

/** A previously anchored head must still be part of the chain. */
export function assertAnchored({ entries }, anchor) {
  if (!SHA256.test(anchor ?? '')) fail('Anchor must be a 64-character lowercase hex head hash');
  if (anchor !== GENESIS && !entries.some((entry) => entry.hash === anchor))
    fail('Anchored head is not part of this inventory: history was rewritten or truncated');
}

/** A backup identifier is bound to one ciphertext, object key and key version forever. */
function assertConsistent(entries, fields) {
  for (const entry of entries) {
    if (
      entry.backupId === fields.backupId &&
      (entry.sha256 !== fields.sha256 ||
        entry.objectKey !== fields.objectKey ||
        entry.bytes !== fields.bytes ||
        entry.keyId !== fields.keyId)
    )
      fail('Inventory already records this backup with different contents; refusing to continue');
  }
}

/**
 * Append one entry. Existing entries are never rewritten; a repeated status
 * for the same backup is a no-op so retries stay idempotent.
 */
async function appendInventory(file, fields, now) {
  const lock = `${file}.lock`;
  await readInventory(file); // validates the directory before the lock is created
  let lockHandle;
  try {
    lockHandle = await open(lock, 'wx', 0o600);
  } catch {
    fail('Inventory is locked by another run (remove a stale .lock only when none is active)');
  }
  try {
    const { entries, head } = await readInventory(file);
    assertConsistent(entries, fields);
    const last = entries.findLast((entry) => entry.backupId === fields.backupId);
    if (last?.status === fields.status) return { entry: last, head, count: entries.length };
    const entry = {
      seq: entries.length + 1,
      ...fields,
      recordedAt: now().toISOString(),
      prev: head,
    };
    entry.hash = entryHash(entry);
    const handle = await open(
      file,
      constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW,
      0o600
    );
    try {
      await handle.write(`${JSON.stringify(entry)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    return { entry, head: entry.hash, count: entry.seq };
  } finally {
    await lockHandle.close();
    await rm(lock, { force: true });
  }
}

async function recordedEntry(config, name) {
  if (!ARCHIVE_NAME_PATTERN.test(name ?? '')) fail('Invalid backup name');
  const { entries } = await readInventory(config.inventory);
  const entry = entries.findLast((candidate) => candidate.backupId === name);
  if (!entry) fail('Backup is not recorded in the inventory');
  return entry;
}

const identity = ({ backupId, sha256, objectKey: key, bytes, createdAt, keyId }) => ({
  backupId,
  sha256,
  objectKey: key,
  bytes,
  createdAt,
  keyId,
});

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/**
 * Ship one encrypted replica and record it. Safe to repeat: an identical
 * remote object is accepted, a different one is never replaced.
 *
 * @param {{ name: string, config: Awaited<ReturnType<typeof loadShippingConfig>>, now?: () => Date }} options
 */
export async function ship({ name, config, now = () => new Date() }) {
  const key = objectKey(config, name);
  const replica = await localReplica(config.replicaDir, name);
  try {
    const fields = {
      backupId: name,
      sha256: replica.sha256,
      objectKey: key,
      bytes: replica.bytes,
      createdAt: replica.createdAt,
      keyId: config.keyId,
    };
    assertConsistent((await readInventory(config.inventory)).entries, fields);
    let status;
    try {
      status = await withRetries(config, async () => {
        // Each attempt starts by looking: a previous attempt whose response
        // was lost may already have stored the object.
        let remote = await fetchObject(config, key, { limit: replica.bytes });
        let uploaded = false;
        if (!remote) {
          const put = await s3Request(config, {
            method: 'PUT',
            key,
            payloadHash: replica.sha256,
            headers: {
              'content-length': String(replica.bytes),
              'content-type': 'application/octet-stream',
              // Atomic create-only where the provider implements it; the
              // look-before-write above covers providers that ignore it.
              'if-none-match': '*',
            },
            source: replica.handle.createReadStream({ autoClose: false, start: 0 }),
          });
          const stored = put.status >= 200 && put.status < 300;
          // 412: a concurrent writer created the key first. Compare, never replace.
          if (!stored && put.status !== 412) throw httpFailure('upload', put);
          uploaded = stored;
          remote = await fetchObject(config, key, { limit: replica.bytes });
          if (!remote) fail('Uploaded object could not be read back', { transient: true });
        }
        if (remote.sha256 !== replica.sha256 || remote.bytes !== replica.bytes)
          fail(
            uploaded
              ? 'Uploaded object failed read-back verification'
              : 'Remote object already exists with different content; refusing to overwrite',
            { mismatch: true }
          );
        return uploaded ? 'uploaded' : 'already-present';
      });
    } catch (error) {
      if (error.mismatch)
        await appendInventory(config.inventory, { ...fields, status: 'failed' }, now).catch(
          () => {}
        );
      throw error;
    }
    const recorded = await appendInventory(
      config.inventory,
      { ...fields, status: 'verified' },
      now
    );
    return {
      status,
      object: key,
      sha256: replica.sha256,
      bytes: replica.bytes,
      keyId: config.keyId,
      verification: 'verified',
      inventory: { entries: recorded.count, head: recorded.head },
    };
  } finally {
    await replica.handle.close();
  }
}

/** Download `entry`'s object (optionally into `out`) and compare it with the inventory. */
async function fetchRecorded(config, entry, out = null) {
  const remote = await fetchObject(config, entry.objectKey, { limit: entry.bytes, out });
  if (!remote) fail('Remote object is missing', { mismatch: true });
  if (remote.sha256 !== entry.sha256 || remote.bytes !== entry.bytes)
    fail('Remote object does not match the inventory', { mismatch: true });
}

/**
 * Re-download a shipped object and compare it with the inventory. The outcome
 * is appended to the inventory when it changes.
 */
export async function verifyShipped({ name, config, now = () => new Date() }) {
  const entry = await recordedEntry(config, name);
  let status = 'verified';
  let failure = null;
  try {
    await withRetries(config, () => fetchRecorded(config, entry));
  } catch (error) {
    if (!error.mismatch) throw error;
    status = 'failed';
    failure = error;
  }
  const recorded = await appendInventory(config.inventory, { ...identity(entry), status }, now);
  if (failure) throw failure;
  return {
    status: 'remote-verified',
    object: entry.objectKey,
    sha256: entry.sha256,
    inventory: { entries: recorded.count, head: recorded.head },
  };
}

/**
 * Retrieve a shipped object into a fresh private directory, check it against
 * the inventory, then hand it to the existing `recover()` for authenticated
 * decryption, manifest/checksum validation and (optionally) the isolated
 * PostgreSQL restore verifier. Everything retrieved is removed afterwards.
 *
 * @param {{ name: string, config: any, tempDir: string, key: string, verify?: ((archive: string) => Promise<void>) | null }} options
 */
export async function recoverShipped({ name, config, tempDir, key, verify = null }) {
  const entry = await recordedEntry(config, name);
  if (entry.keyId !== config.keyId)
    fail('Inventory records a different encryption key version for this backup');
  let temp;
  try {
    temp = await protectedDirectory(tempDir);
  } catch {
    fail('Temporary directory must exist, be owned by this user and be mode 0700');
  }
  const work = await mkdtemp(path.join(temp, 'agencyos-shipped-'));
  try {
    const remote = path.join(work, 'remote');
    const plain = path.join(work, 'plain');
    await mkdir(remote, { mode: 0o700 });
    await mkdir(plain, { mode: 0o700 });
    await withRetries(config, async () => {
      const out = await open(
        path.join(remote, `${name}.age`),
        constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
        0o600
      );
      try {
        await fetchRecorded(config, entry, out);
        await out.sync();
      } finally {
        await out.close();
      }
    });
    let result;
    try {
      result = await recover({ name, destination: remote, tempDir: plain, key, verify });
    } catch {
      fail('Decryption, manifest validation or restore verification failed');
    }
    return {
      status: result.status,
      object: entry.objectKey,
      sha256: entry.sha256,
      keyId: entry.keyId,
      inventorySeq: entry.seq,
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
