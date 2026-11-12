// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import https from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { replicate } from '../../../scripts/backup/replication.mjs';
import { runScheduledBackup } from '../../../scripts/backup/scheduled-backup.mjs';
import {
  assertAnchored,
  loadShippingConfig,
  readInventory,
  recoverShipped,
  ship,
  signRequest,
  verifyShipped,
} from '../../../scripts/backup/shipping.mjs';

/**
 * An in-process, TLS-only stand-in for an S3-compatible bucket. It implements
 * only what the adapter relies on (GET, conditional PUT, S3 error documents)
 * and lets a test inject provider failures. A real S3-compatible server is
 * exercised separately in the `backup-verify` CI job.
 */
const SECRET = 'test-secret-access-key-NEVER-LOGGED';
const ACCESS = 'AKIDTESTSHIPPING';
const objects = new Map<string, Buffer>();
let requests: string[] = [];
type Intercept = (
  method: string,
  key: string,
  body: Buffer,
  res: ServerResponse,
  req: IncomingMessage
) => boolean;
let intercept: Intercept | null = null;
const xml = (res: ServerResponse, status: number, code: string) => {
  // Real providers echo the access key id in error documents.
  res.writeHead(status, { 'content-type': 'application/xml' });
  res.end(`<Error><Code>${code}</Code><AWSAccessKeyId>${ACCESS}</AWSAccessKeyId></Error>`);
};
let server: https.Server;
let certDir: string;
let caFile: string;
let port: number;

beforeAll(async () => {
  certDir = await mkdtemp(path.join(os.tmpdir(), 'ship-cert-'));
  caFile = path.join(certDir, 'cert.pem');
  execFileSync(
    'openssl',
    [
      ...['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost'],
      ...['-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'],
      ...['-keyout', path.join(certDir, 'key.pem'), '-out', caFile],
    ],
    { stdio: 'ignore' }
  );
  server = https.createServer(
    { key: await readFile(path.join(certDir, 'key.pem')), cert: await readFile(caFile) },
    (req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        const method = req.method ?? '';
        const key = (req.url ?? '').replace(/^\/test-bucket\//, '');
        requests.push(`${method} ${req.url}`);
        if (!String(req.headers.authorization).startsWith(`AWS4-HMAC-SHA256 Credential=${ACCESS}/`))
          return xml(res, 403, 'AccessDenied');
        if (intercept?.(method, key, body, res, req)) return;
        if (method === 'GET') {
          const found = objects.get(key);
          if (!found) return xml(res, 404, 'NoSuchKey');
          res.writeHead(200, { 'content-length': found.length });
          return res.end(found);
        }
        if (method !== 'PUT') return xml(res, 405, 'MethodNotAllowed');
        if (createHash('sha256').update(body).digest('hex') !== req.headers['x-amz-content-sha256'])
          return xml(res, 400, 'XAmzContentSHA256Mismatch');
        if (req.headers['if-none-match'] === '*' && objects.has(key))
          return xml(res, 412, 'PreconditionFailed');
        objects.set(key, body);
        res.writeHead(200);
        res.end();
      });
    }
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(certDir, { recursive: true, force: true });
});

const key = 'ab'.repeat(32);
const name = 'agencyos-test.dump';
const objectName = `prod/${name}.age`;
const data = Buffer.alloc(4096, 'confidential fixture data, never upload plaintext');
let root: string, local: string, replicas: string, temp: string, state: string;
let archive: string, replicaFile: string, inventory: string;
let previousPath: string | undefined;
let cachedReplica: Buffer | null = null;
let config: Awaited<ReturnType<typeof loadShippingConfig>>;

const shippingEnv = (overrides: Record<string, string | undefined> = {}) => ({
  BACKUP_SHIPPING_ENDPOINT: `https://localhost:${port}`,
  BACKUP_SHIPPING_REGION: 'us-east-1',
  BACKUP_SHIPPING_BUCKET: 'test-bucket',
  BACKUP_SHIPPING_PREFIX: 'prod',
  BACKUP_SHIPPING_ACCESS_KEY_ID: ACCESS,
  BACKUP_SHIPPING_SECRET_ACCESS_KEY: SECRET,
  BACKUP_SHIPPING_INVENTORY: inventory,
  BACKUP_SHIPPING_CA_FILE: caFile,
  BACKUP_REPLICATION_KEY_ID: 'k2026-11',
  BACKUP_REPLICATION_DIR: replicas,
  ...overrides,
});
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const puts = () => requests.filter((line) => line.startsWith('PUT')).length;
const lines = async () => (await readFile(inventory, 'utf8')).trim().split('\n');
const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as Error & { mismatch?: boolean };
  }
  throw new Error('Expected the operation to fail');
};

beforeEach(async () => {
  objects.clear();
  requests = [];
  intercept = null;
  root = await mkdtemp(path.join(os.tmpdir(), 'ship-test-'));
  [local, replicas, temp, state] = ['local', 'replicas', 'temp', 'state'].map((dir) =>
    path.join(root, dir)
  );
  const bin = path.join(root, 'bin');
  await Promise.all([local, replicas, temp, state, bin].map((p) => mkdir(p, { mode: 0o700 })));
  archive = path.join(local, name);
  replicaFile = path.join(replicas, `${name}.age`);
  inventory = path.join(state, 'inventory.jsonl');
  await writeFile(archive, data, { mode: 0o600 });
  await writeFile(
    `${archive}.json`,
    JSON.stringify({
      archive: name,
      format: 'pg_dump custom',
      bytes: data.length,
      sha256: sha256(data),
      archiveObjects: { tableData: 1 },
    }),
    { mode: 0o600 }
  );
  await writeFile(
    path.join(bin, 'pg_restore'),
    "#!/bin/sh\nprintf '6; 0 123 TABLE DATA public fixture owner\\n'\n",
    { mode: 0o700 }
  );
  previousPath = process.env.PATH;
  process.env.PATH = `${bin}:${previousPath}`;
  // The existing encrypted replication produces the only thing that is shipped.
  // Its scrypt work factor is deliberate, so the fixture is encrypted once.
  if (cachedReplica) await writeFile(replicaFile, cachedReplica, { mode: 0o600 });
  else {
    await replicate({ archive, destination: replicas, key });
    cachedReplica = await readFile(replicaFile);
  }
  config = await loadShippingConfig(shippingEnv());
  config.retryDelayMs = 1;
});
afterEach(async () => {
  process.env.PATH = previousPath;
  await rm(root, { force: true, recursive: true });
});

describe('shipping configuration and request signing', () => {
  it('produces the same SigV4 signature as botocore for a fixed request', () => {
    // Expected value generated independently with botocore's S3SigV4Auth.
    const signed = signRequest({
      method: 'PUT',
      host: 's3.example.test:9000',
      pathname: '/agencyos-backups/prod/agencyos-test.dump.age',
      headers: {
        'content-type': 'application/octet-stream',
        'if-none-match': '*',
        'content-length': '5',
      },
      payloadHash: '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072',
      region: 'eu-central-1',
      credentials: {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        sessionToken: null,
      },
      now: new Date('2026-11-12T10:20:30Z'),
    });
    expect(signed.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20261112/eu-central-1/s3/aws4_request, ' +
        'SignedHeaders=content-type;host;if-none-match;x-amz-content-sha256;x-amz-date, ' +
        'Signature=fd9a7bd5a9113d97322d9167321e7f68088a00f8dedb299ec60d9fe61d279226'
    );
  });

  it('requires TLS and complete configuration, and keeps credentials out of serialized config', async () => {
    for (const overrides of [
      { BACKUP_SHIPPING_ENDPOINT: `http://localhost:${port}` },
      { BACKUP_SHIPPING_ENDPOINT: `https://user:pass@localhost:${port}` },
      { BACKUP_SHIPPING_ENDPOINT: undefined },
      { BACKUP_SHIPPING_BUCKET: '../other' },
      { BACKUP_SHIPPING_PREFIX: '../escape' },
      { BACKUP_SHIPPING_PREFIX: 'a/../b' },
      { BACKUP_SHIPPING_SECRET_ACCESS_KEY: undefined },
      { BACKUP_SHIPPING_ACCESS_KEY_ID: '' },
      { BACKUP_REPLICATION_KEY_ID: undefined },
      { BACKUP_SHIPPING_INVENTORY: 'relative/inventory.jsonl' },
      { BACKUP_SHIPPING_CA_FILE: path.join(root, 'missing.pem') },
    ]) {
      const error = await failure(loadShippingConfig(shippingEnv(overrides)));
      expect(error.message).not.toContain(SECRET);
    }
    expect(JSON.stringify(config)).not.toContain(SECRET);
    expect(JSON.stringify(config)).not.toContain(ACCESS);
  });

  it('refuses a server whose certificate is not trusted', async () => {
    const untrusted = await loadShippingConfig(shippingEnv({ BACKUP_SHIPPING_CA_FILE: undefined }));
    untrusted.retryDelayMs = 1;
    await expect(ship({ name, config: untrusted })).rejects.toThrow(/unreachable/);
    expect(requests).toEqual([]);
  });
});

describe('shipping encrypted replicas', () => {
  it('ships ciphertext only, verifies it by download and records it in the inventory', async () => {
    const result = await ship({ name, config });
    const ciphertext = await readFile(replicaFile);
    expect(result).toMatchObject({
      status: 'uploaded',
      object: objectName,
      sha256: sha256(ciphertext),
      bytes: ciphertext.length,
      verification: 'verified',
    });
    const stored = objects.get(objectName)!;
    expect(stored.equals(ciphertext)).toBe(true);
    expect(stored.includes(data.subarray(0, 32))).toBe(false);
    // Look, conditional create, read back. No DELETE, HEAD or listing.
    expect(requests).toEqual([
      `GET /test-bucket/${objectName}`,
      `PUT /test-bucket/${objectName}`,
      `GET /test-bucket/${objectName}`,
    ]);
    const { entries, head } = await readInventory(inventory);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      seq: 1,
      backupId: name,
      sha256: sha256(ciphertext),
      objectKey: objectName,
      bytes: ciphertext.length,
      keyId: 'k2026-11',
      status: 'verified',
      prev: '0'.repeat(64),
    });
    expect(Number.isNaN(Date.parse(entries[0].createdAt))).toBe(false);
    expect(result.inventory).toEqual({ entries: 1, head });
    const raw = await readFile(inventory, 'utf8');
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain(ACCESS);
    expect(await readFile(archive)).toEqual(data);
  }, 30000);

  it('is idempotent: a repeat neither uploads nor adds an inventory entry', async () => {
    await ship({ name, config });
    const again = await ship({ name, config });
    expect(again.status).toBe('already-present');
    expect(puts()).toBe(1);
    expect(await lines()).toHaveLength(1);
  }, 30000);

  it('refuses to ship anything that is not an age-encrypted replica', async () => {
    await rm(replicaFile);
    await writeFile(replicaFile, data, { mode: 0o600 });
    await expect(ship({ name, config })).rejects.toThrow(/not an age-encrypted replica/);
    await rm(replicaFile);
    await symlink(archive, replicaFile);
    await expect(ship({ name, config })).rejects.toThrow();
    await expect(ship({ name: '../local/agencyos-test.dump', config })).rejects.toThrow();
    await chmod(replicas, 0o755);
    await expect(ship({ name, config })).rejects.toThrow();
    expect(requests).toEqual([]);
    expect(objects.size).toBe(0);
  });

  it('reports a failed upload without secrets and leaves local files and inventory untouched', async () => {
    intercept = (method, _key, _body, res) => {
      if (method !== 'PUT') return false;
      xml(res, 503, 'ServiceUnavailable');
      return true;
    };
    const before = await readFile(replicaFile);
    const error = await failure(ship({ name, config }));
    expect(error.message).toMatch(/HTTP 503 ServiceUnavailable.*3 attempt/);
    expect(error.message).not.toContain(SECRET);
    expect(error.message).not.toContain(ACCESS);
    expect(puts()).toBe(3);
    expect(objects.size).toBe(0);
    expect(await readFile(replicaFile)).toEqual(before);
    expect(await readFile(archive)).toEqual(data);
    expect(await readdir(state)).toEqual([]);
  }, 30000);

  it('does not retry a permission error', async () => {
    intercept = (method, _key, _body, res) => {
      if (method !== 'PUT') return false;
      xml(res, 403, 'AccessDenied');
      return true;
    };
    await expect(ship({ name, config })).rejects.toThrow(/HTTP 403 AccessDenied/);
    expect(puts()).toBe(1);
  });

  it('retries a transient failure and a lost response without duplicating or replacing', async () => {
    let failures = 1;
    intercept = (method, _key, _body, res) => {
      if (method !== 'PUT' || failures-- <= 0) return false;
      xml(res, 500, 'InternalError');
      return true;
    };
    expect((await ship({ name, config })).status).toBe('uploaded');
    expect(puts()).toBe(2);

    // The object is stored but the connection drops before the response.
    objects.clear();
    requests = [];
    await rm(inventory);
    let dropped = false;
    intercept = (method, objectKey, body, res) => {
      if (method !== 'PUT' || dropped) return false;
      dropped = true;
      objects.set(objectKey, body);
      res.destroy();
      return true;
    };
    const result = await ship({ name, config });
    expect(result.status).toBe('already-present');
    expect(puts()).toBe(1);
    expect(objects.get(objectName)!.equals(await readFile(replicaFile))).toBe(true);
    expect(await lines()).toHaveLength(1);
  }, 30000);

  it('never overwrites a remote object with different contents', async () => {
    const other = Buffer.from('a different object that must survive');
    objects.set(objectName, other);
    const error = await failure(ship({ name, config }));
    expect(error.message).toMatch(/refusing to overwrite/);
    expect(error.mismatch).toBe(true);
    expect(puts()).toBe(0);
    expect(objects.get(objectName)).toBe(other);
    const { entries } = await readInventory(inventory);
    expect(entries.map((entry: { status: string }) => entry.status)).toEqual(['failed']);

    // A concurrent writer wins the race after the look: the conditional PUT
    // is refused by the store and the result is still a refusal.
    objects.clear();
    requests = [];
    intercept = (method, objectKey) => {
      if (method === 'PUT') objects.set(objectKey, other);
      return false;
    };
    await expect(ship({ name, config })).rejects.toThrow(/refusing to overwrite/);
    expect(objects.get(objectName)).toBe(other);
  }, 30000);

  it('detects an object corrupted in storage at upload time and later', async () => {
    intercept = (method, objectKey, body, res) => {
      if (method !== 'PUT') return false;
      const damaged = Buffer.from(body);
      damaged[damaged.length - 5] ^= 1;
      objects.set(objectKey, damaged);
      res.writeHead(200);
      res.end();
      return true;
    };
    await expect(ship({ name, config })).rejects.toThrow(/failed read-back verification/);
    expect((await readInventory(inventory)).entries.at(-1).status).toBe('failed');

    intercept = null;
    objects.clear();
    await ship({ name, config });
    expect((await verifyShipped({ name, config })).status).toBe('remote-verified');
    expect(await lines()).toHaveLength(2);
    const damaged = Buffer.from(objects.get(objectName)!);
    damaged[40] ^= 1;
    objects.set(objectName, damaged);
    const error = await failure(verifyShipped({ name, config }));
    expect(error.mismatch).toBe(true);
    expect((await readInventory(inventory)).entries.at(-1).status).toBe('failed');
    await expect(recoverShipped({ name, config, tempDir: temp, key })).rejects.toThrow(
      /does not match the inventory/
    );
    // Truncated, extended and missing objects are refused as well.
    objects.set(objectName, damaged.subarray(0, 100));
    await expect(recoverShipped({ name, config, tempDir: temp, key })).rejects.toThrow();
    objects.set(objectName, Buffer.concat([damaged, damaged]));
    await expect(recoverShipped({ name, config, tempDir: temp, key })).rejects.toThrow();
    objects.clear();
    await expect(verifyShipped({ name, config })).rejects.toThrow(/missing/);
    expect(await readdir(temp)).toEqual([]);
  }, 30000);
});

describe('recovery from object storage', () => {
  it('retrieves, checks against the inventory, decrypts and hands over to the verifier', async () => {
    await ship({ name, config });
    // Recovery must work on a host that no longer has the local replica.
    await rm(replicaFile);
    let seen = false;
    const result = await recoverShipped({
      name,
      config,
      tempDir: temp,
      key,
      verify: async (recovered: string) => {
        seen = true;
        expect(await readFile(recovered)).toEqual(data);
        expect(JSON.parse(await readFile(`${recovered}.json`, 'utf8')).sha256).toBe(sha256(data));
      },
    });
    expect(result).toMatchObject({ status: 'restore-verified', object: objectName });
    expect(seen).toBe(true);
    expect(await readdir(temp)).toEqual([]);
  }, 30000);

  it('fails with the wrong key or key version and leaves nothing behind', async () => {
    await ship({ name, config });
    await expect(
      recoverShipped({ name, config, tempDir: temp, key: 'cd'.repeat(32) })
    ).rejects.toThrow(/Decryption, manifest validation or restore verification failed/);
    const rotated = await loadShippingConfig(
      shippingEnv({ BACKUP_REPLICATION_KEY_ID: 'k2027-01' })
    );
    await expect(recoverShipped({ name, config: rotated, tempDir: temp, key })).rejects.toThrow(
      /different encryption key version/
    );
    await expect(
      recoverShipped({
        name,
        config,
        tempDir: temp,
        key,
        verify: async () => {
          throw new Error('restore failed');
        },
      })
    ).rejects.toThrow();
    expect(await readdir(temp)).toEqual([]);
    await chmod(temp, 0o755);
    await expect(recoverShipped({ name, config, tempDir: temp, key })).rejects.toThrow();
    await expect(
      recoverShipped({ name: 'agencyos-unknown.dump', config, tempDir: temp, key })
    ).rejects.toThrow(/not recorded/);
  }, 30000);
});

describe('backup inventory', () => {
  it('chains entries and detects edits, removal, reordering and truncation', async () => {
    await ship({ name, config });
    const anchoredHead = (await verifyShipped({ name, config })).inventory.head;
    objects.clear();
    await failure(verifyShipped({ name, config }));
    await ship({ name, config });
    const original = await lines();
    expect(original).toHaveLength(3);
    const { entries, head } = await readInventory(inventory);
    expect(entries.map((entry: { status: string }) => entry.status)).toEqual([
      'verified',
      'failed',
      'verified',
    ]);
    expect(entries[1].prev).toBe(entries[0].hash);
    expect(head).toBe(entries[2].hash);
    expect(() => assertAnchored({ entries }, anchoredHead)).not.toThrow();

    const rewrite = (content: string) => writeFile(inventory, content, { mode: 0o600 });
    const edited = JSON.parse(original[1]);
    edited.status = 'verified';
    for (const tampered of [
      [original[0], JSON.stringify(edited), original[2]],
      [original[0], original[2]],
      [original[1], original[0], original[2]],
      [original[1], original[2]],
    ]) {
      await rewrite(`${tampered.join('\n')}\n`);
      await expect(readInventory(inventory)).rejects.toThrow(/integrity check failed/);
      await expect(ship({ name, config })).rejects.toThrow(/integrity check failed/);
    }
    await rewrite(original.join('\n'));
    await expect(readInventory(inventory)).rejects.toThrow(/integrity check failed/);

    // Dropping the newest entries leaves a valid chain; only an anchor kept
    // elsewhere reveals it. This is why the local file alone is advisory.
    await rewrite(`${original[0]}\n`);
    const truncated = await readInventory(inventory);
    expect(truncated.entries).toHaveLength(1);
    expect(() => assertAnchored(truncated, head)).toThrow(/rewritten or truncated/);
  }, 30000);

  it('never rebinds a backup identifier to different ciphertext', async () => {
    await ship({ name, config });
    const before = await readFile(inventory, 'utf8');
    await rm(replicaFile);
    await replicate({ archive, destination: replicas, key });
    requests = [];
    await expect(ship({ name, config })).rejects.toThrow(/different contents/);
    expect(requests).toEqual([]);
    expect(await readFile(inventory, 'utf8')).toBe(before);
  }, 30000);

  it('refuses an unsafe inventory location or a concurrent writer', async () => {
    await writeFile(`${inventory}.lock`, '', { mode: 0o600 });
    await expect(ship({ name, config })).rejects.toThrow(/locked/);
    await rm(`${inventory}.lock`);
    const outside = path.join(root, 'outside.jsonl');
    await writeFile(outside, '');
    await symlink(outside, inventory);
    await expect(ship({ name, config })).rejects.toThrow();
    expect(await readFile(outside, 'utf8')).toBe('');
    await rm(inventory);
    await chmod(state, 0o755);
    await expect(ship({ name, config })).rejects.toThrow(/mode 0700/);
  }, 30000);
});

describe('scheduled runner integration', () => {
  const run = (env: Record<string, string | undefined>) =>
    runScheduledBackup(['--dir', local, '--keep', '1'], {
      env: { DATABASE_URL: 'postgresql://u:p@localhost:5432/db', ...env },
      logger: { log() {}, error() {} },
      runBackup: async () => ({
        exitCode: 0,
        stdout: `[backup] destination ${archive}\n`,
        stderr: '',
      }),
    });
  const replication = () => ({ BACKUP_REPLICATION_DIR: replicas, BACKUP_REPLICATION_KEY: key });

  it('does not ship unless shipping is explicitly configured', async () => {
    const { exitCode, result } = await run(replication());
    expect(exitCode).toBe(0);
    expect(result!.shipping.status).toBe('not-configured');
    expect(requests).toEqual([]);
  }, 30000);

  it('ships after replication and exposes the inventory head without secrets', async () => {
    const { exitCode, result } = await run({ ...replication(), ...shippingEnv() });
    expect(exitCode).toBe(0);
    expect(result!.shipping).toMatchObject({ status: 'succeeded', object: objectName });
    expect(result!.shipping.inventoryHead).toBe((await readInventory(inventory)).head);
    const saved = await readFile(path.join(local, 'last-run.json'), 'utf8');
    expect(saved).not.toContain(SECRET);
    expect(saved).not.toContain(ACCESS);
  }, 30000);

  it('keeps local backups and skips retention when shipping fails', async () => {
    intercept = (_method, _key, _body, res) => {
      xml(res, 503, 'ServiceUnavailable');
      return true;
    };
    const older = path.join(local, 'agencyos-older.dump');
    await writeFile(older, data, { mode: 0o600 });
    const env = { ...replication(), ...shippingEnv({ BACKUP_SHIPPING_ATTEMPTS: '1' }) };
    const { exitCode, result } = await run(env);
    expect(exitCode).not.toBe(0);
    expect(result!.backup.status).toBe('succeeded');
    expect(result!.replication.status).toBe('succeeded');
    expect(result!.shipping.status).toBe('failed');
    expect(result!.error.code).toBe('shipping_failed');
    expect(result!.retention).toMatchObject({ status: 'skipped', reason: 'shipping_failed' });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(await readFile(archive)).toEqual(data);
    expect(await readFile(older)).toEqual(data);

    // A later prune-only run must not delete what was never shipped.
    const pruneOnly = await runScheduledBackup(
      ['--dir', local, '--retention-only', '--keep', '1'],
      {
        env: {},
        logger: { log() {}, error() {} },
      }
    );
    expect(pruneOnly.result!.retention.reason).toBe('latest_shipping_failed');
    expect(await readFile(older)).toEqual(data);

    // Shipping configured without encrypted replication uploads nothing.
    requests = [];
    const plainOnly = await run(shippingEnv({ BACKUP_REPLICATION_DIR: undefined }));
    expect(plainOnly.result!.shipping.status).toBe('failed');
    expect(requests).toEqual([]);
  }, 30000);
});
