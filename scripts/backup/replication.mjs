/** Encrypted replication using the standard age passphrase format. */
import { createHash, randomBytes } from 'node:crypto';
import { constants, createWriteStream } from 'node:fs';
import { lstat, open, link, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Encrypter, Decrypter } from 'age-encryption';
import { ARCHIVE_NAME_PATTERN, MANIFEST_FORMAT, isInside } from './retention.mjs';
import { runTool, sha256File } from './lib.mjs';
import { createInterface } from 'node:readline';

const MAX_MANIFEST = 1024 * 1024;
const fail = (message) => {
  throw new Error(message);
};

// Reject symlinked components and paths replaceable by other users. Sticky
// directories such as /tmp are acceptable only as parents, never as the root.
export async function protectedDirectory(value) {
  if (!value || !path.isAbsolute(value)) fail('A protected absolute directory is required');
  const dir = path.resolve(value);
  let current = path.parse(dir).root;
  for (const part of dir.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink())
      fail('Directory path contains a symlink or non-directory');
    if (info.uid !== process.getuid() && info.uid !== 0) fail('Directory has an untrusted owner');
    if (info.mode & 0o022 && !(current !== dir && info.mode & 0o1000))
      fail('Directory is writable by other users');
  }
  const info = await lstat(dir);
  if (info.uid !== process.getuid() || info.mode & 0o077)
    fail('Directory must be owned by this user and mode 0700');
  if ((await realpath(dir)) !== dir) fail('Directory path must not contain symlinks');
  return dir;
}

async function regularFile(file) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile()) fail('Expected a regular file');
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

/** @param {Record<string, string | undefined>} env */
export async function loadKey(env = process.env) {
  if (Boolean(env.BACKUP_REPLICATION_KEY) === Boolean(env.BACKUP_REPLICATION_KEY_FILE))
    fail('Configure exactly one replication key source');
  let value = env.BACKUP_REPLICATION_KEY;
  if (env.BACKUP_REPLICATION_KEY_FILE) {
    if (!path.isAbsolute(env.BACKUP_REPLICATION_KEY_FILE)) fail('Key file path must be absolute');
    const file = path.resolve(env.BACKUP_REPLICATION_KEY_FILE);
    await protectedDirectory(path.dirname(file));
    const handle = await regularFile(file);
    try {
      const info = await handle.stat();
      if (info.uid !== process.getuid() || info.mode & 0o077 || info.size > 128)
        fail('Key file must be owner-only');
      value = (await handle.readFile('utf8')).trim();
    } finally {
      await handle.close();
    }
  }
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value))
    fail('Replication key must be 32 random bytes in lowercase hexadecimal');
  return value;
}

export function assertKeySeparation(env, directories) {
  if (!env.BACKUP_REPLICATION_KEY_FILE) return;
  const keyPath = path.resolve(env.BACKUP_REPLICATION_KEY_FILE);
  for (const value of directories.filter(Boolean)) {
    const dir = path.resolve(value);
    if (keyPath === dir || isInside(dir, keyPath))
      fail('Key file must be separate from backup, replica and temporary storage');
  }
}

function validateManifest(manifest, name) {
  if (
    !ARCHIVE_NAME_PATTERN.test(name) ||
    manifest?.archive !== name ||
    manifest.format !== MANIFEST_FORMAT ||
    !/^[0-9a-f]{64}$/.test(manifest.sha256 ?? '') ||
    !Number.isSafeInteger(manifest.bytes) ||
    manifest.bytes < 1024 ||
    !Number.isSafeInteger(manifest.archiveObjects?.tableData) ||
    manifest.archiveObjects.tableData < 1
  )
    fail('Invalid backup manifest');
}
function separate(a, b) {
  if (a === b || isInside(a, b) || isInside(b, a))
    fail('Backup, destination and temporary directories must be separate');
}
async function localBackup(archive) {
  if (!archive || !path.isAbsolute(archive)) fail('An absolute backup path is required');
  archive = path.resolve(archive);
  const dir = await protectedDirectory(path.dirname(archive));
  const name = path.basename(archive);
  if (!ARCHIVE_NAME_PATTERN.test(name)) fail('Invalid backup name');
  const mh = await regularFile(`${archive}.json`);
  let bytes;
  try {
    if ((await mh.stat()).size > MAX_MANIFEST) fail('Manifest too large');
    bytes = await mh.readFile();
  } finally {
    await mh.close();
  }
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail('Invalid backup manifest');
  }
  validateManifest(manifest, name);
  const handle = await regularFile(archive);
  if ((await handle.stat()).size !== manifest.bytes) {
    await handle.close();
    fail('Backup size mismatch');
  }
  return { dir, name, bytes, manifest, handle };
}

// Payload is a bounded length-prefixed original manifest followed by the raw
// archive. Framing is not cryptography: the whole payload is one age file.
async function* payload(backup) {
  const size = Buffer.alloc(4);
  size.writeUInt32BE(backup.bytes.length);
  yield size;
  yield backup.bytes;
  const hash = createHash('sha256');
  let count = 0;
  for await (const chunk of backup.handle.createReadStream({ autoClose: false, start: 0 })) {
    hash.update(chunk);
    count += chunk.length;
    yield chunk;
  }
  if (count !== backup.manifest.bytes || hash.digest('hex') !== backup.manifest.sha256)
    fail('Backup checksum mismatch');
}

/** Read and authenticate the entire age object; optionally write archive to a private file. */
async function inspectReplica(file, key, name, output, expectedManifest) {
  const handle = await regularFile(file);
  let out;
  try {
    const decrypt = new Decrypter();
    decrypt.addPassphrase(key);
    const plain = await decrypt.decrypt(
      Readable.toWeb(handle.createReadStream({ autoClose: false }))
    );
    let pending = Buffer.alloc(0),
      length = null,
      manifestBytes = null,
      manifest = null;
    const hash = createHash('sha256');
    let count = 0;
    if (output) out = await open(output, 'wx', 0o600);
    for await (const data of Readable.fromWeb(plain)) {
      let chunk = Buffer.from(data);
      if (!manifest) {
        pending = Buffer.concat([pending, chunk]);
        if (length === null && pending.length >= 4) {
          length = pending.readUInt32BE(0);
          pending = pending.subarray(4);
          if (!length || length > MAX_MANIFEST) fail('Invalid encrypted metadata');
        }
        if (length === null || pending.length < length) continue;
        manifestBytes = pending.subarray(0, length);
        try {
          manifest = JSON.parse(manifestBytes.toString('utf8'));
        } catch {
          fail('Invalid encrypted metadata');
        }
        validateManifest(manifest, name);
        if (expectedManifest && !manifestBytes.equals(expectedManifest))
          fail('Replica already exists with different content');
        chunk = pending.subarray(length);
        pending = Buffer.alloc(0);
      }
      count += chunk.length;
      if (count > manifest.bytes) fail('Replica size mismatch');
      hash.update(chunk);
      if (out && chunk.length) await out.writeFile(chunk);
    }
    if (!manifest || count !== manifest.bytes || hash.digest('hex') !== manifest.sha256)
      fail('Replica checksum mismatch');
    if (out) await out.sync();
    return { manifestBytes, manifest };
  } finally {
    if (out) await out.close();
    await handle.close();
  }
}

/** Filesystem adapter contract: publish once, then read and verify the object. */
export async function replicate({ archive, destination, key }) {
  if (!key || !/^[0-9a-f]{64}$/.test(key)) fail('Invalid replication key');
  const dest = await protectedDirectory(destination);
  const backup = await localBackup(archive);
  archive = path.join(backup.dir, backup.name);
  const partial = path.join(dest, `.partial-${randomBytes(16).toString('hex')}.age`);
  const target = path.join(dest, `${backup.name}.age`);
  try {
    separate(backup.dir, dest);
    // Verify source even when the destination already exists.
    for await (const chunk of payload(backup)) {
      if (!chunk.length) fail('Empty backup chunk');
    }
    let hasTableData = false;
    const env = { ...process.env };
    delete env.BACKUP_REPLICATION_KEY;
    delete env.BACKUP_REPLICATION_KEY_FILE;
    const listed = await runTool('pg_restore', ['--list', archive], {
      env,
      stdout: (stream) => {
        const lines = createInterface({ input: stream });
        lines.on('line', (line) => {
          if (/^\d+;\s+\d+\s+\d+\s+TABLE DATA (?!ATTACH\b)/.test(line)) hasTableData = true;
        });
      },
    });
    if (listed.code !== 0 || !hasTableData) fail('Backup archive validation failed');
    try {
      await inspectReplica(target, key, backup.name, null, backup.bytes);
      return {
        status: 'already-present',
        object: path.basename(target),
        sha256: await sha256File(target),
      };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const enc = new Encrypter();
    enc.setPassphrase(key);
    const ciphertext = await enc.encrypt(Readable.toWeb(Readable.from(payload(backup))));
    await pipeline(
      Readable.fromWeb(ciphertext),
      createWriteStream(partial, { flags: 'wx', mode: 0o600 })
    );
    const ph = await regularFile(partial);
    try {
      await ph.sync();
    } finally {
      await ph.close();
    }
    const digest = await sha256File(partial);
    // Verify the encrypted bytes before publishing; never publish incomplete data.
    await inspectReplica(partial, key, backup.name, null, backup.bytes);
    try {
      await link(partial, target);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    await inspectReplica(target, key, backup.name, null, backup.bytes);
    // A racing writer may have encrypted the same payload differently.
    const actual = await sha256File(target);
    if (actual !== digest) {
      // The authenticated, matching pre-existing object is an idempotent success.
      return { status: 'already-present', object: path.basename(target), sha256: actual };
    }
    const dh = await open(dest, 'r');
    try {
      await dh.sync();
    } finally {
      await dh.close();
    }
    return { status: 'uploaded', object: path.basename(target), sha256: actual };
  } finally {
    await backup.handle.close();
    await rm(partial, { force: true });
  }
}

/** @param {{name: string, destination: string, tempDir: string, key: string, verify?: ((archive: string) => Promise<void>) | null}} options */
export async function recover({ name, destination, tempDir, key, verify = null }) {
  if (!key || !/^[0-9a-f]{64}$/.test(key)) fail('Invalid replication key');
  if (!ARCHIVE_NAME_PATTERN.test(name ?? '')) fail('Invalid backup name');
  const dest = await protectedDirectory(destination);
  const temp = await protectedDirectory(tempDir);
  separate(dest, temp);
  const { mkdtemp, writeFile } = await import('node:fs/promises');
  const work = await mkdtemp(path.join(temp, 'agencyos-recovery-'));
  const archive = path.join(work, name);
  try {
    const { manifestBytes } = await inspectReplica(
      path.join(dest, `${name}.age`),
      key,
      name,
      archive
    );
    await writeFile(`${archive}.json`, manifestBytes, { flag: 'wx', mode: 0o600 });
    if (verify) await verify(archive);
    return { status: verify ? 'restore-verified' : 'integrity-verified' };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
