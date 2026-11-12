#!/usr/bin/env node
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertKeySeparation, loadKey, replicate, recover } from './replication.mjs';

async function main(args) {
  const [action, ...rest] = args;
  if (action === '--help' || !action) {
    console.log(
      'Usage: replicate.mjs upload --backup <absolute-path> | recover --name <archive-name> --temp-dir <absolute-path> [--verify-restore]'
    );
    return;
  }
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--verify-restore' && action === 'recover') opts.verify = true;
    else if (
      (arg === '--backup' && action === 'upload') ||
      ((arg === '--name' || arg === '--temp-dir') && action === 'recover')
    ) {
      if (!rest[i + 1] || rest[i + 1].startsWith('--') || opts[arg])
        throw new Error('Invalid options');
      opts[arg] = rest[++i];
    } else throw new Error('Invalid options');
  }
  assertKeySeparation(process.env, [
    process.env.BACKUP_REPLICATION_DIR,
    opts['--backup'] && path.dirname(opts['--backup']),
    opts['--temp-dir'],
  ]);
  const key = await loadKey();
  let result;
  if (action === 'upload')
    result = await replicate({
      archive: opts['--backup'],
      destination: process.env.BACKUP_REPLICATION_DIR,
      key,
    });
  else if (action === 'recover')
    result = await recover({
      name: opts['--name'],
      tempDir: opts['--temp-dir'],
      destination: process.env.BACKUP_REPLICATION_DIR,
      key,
      verify: opts.verify
        ? (archive) =>
            new Promise((resolve, reject) => {
              const env = { ...process.env };
              delete env.BACKUP_REPLICATION_KEY;
              delete env.BACKUP_REPLICATION_KEY_FILE;
              const child = spawn(
                process.execPath,
                [
                  path.join(path.dirname(fileURLToPath(import.meta.url)), 'verify-restore.mjs'),
                  '--backup',
                  archive,
                ],
                { stdio: 'inherit', env }
              );
              child.on('error', reject);
              child.on('close', (code) =>
                code === 0 ? resolve() : reject(new Error('Isolated restore verification failed'))
              );
            })
        : null,
    });
  else throw new Error('Invalid action');
  console.log(`[replication] ${JSON.stringify(result)}`);
}
main(process.argv.slice(2)).catch(() => {
  console.error(
    '[replication] FAILED: replication or recovery failed; check key, paths and integrity'
  );
  process.exitCode = 3;
});
