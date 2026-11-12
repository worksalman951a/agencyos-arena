#!/usr/bin/env node
/** CLI for off-site shipping of encrypted replicas. See docs/operations/backup-offsite-shipping.md. */
import { EXIT } from './lib.mjs';
import { assertKeySeparation, loadKey, restoreVerifier } from './replication.mjs';
import {
  ShippingError,
  assertAnchored,
  loadShippingConfig,
  readInventory,
  recoverShipped,
  ship,
  verifyShipped,
} from './shipping.mjs';

const USAGE = `Usage:
  ship.mjs ship --name <archive-name>
  ship.mjs verify --name <archive-name>
  ship.mjs recover --name <archive-name> --temp-dir <absolute-path> [--verify-restore]
  ship.mjs inventory [--anchor <head-hash>]`;
const VALUES = {
  ship: ['--name'],
  verify: ['--name'],
  recover: ['--name', '--temp-dir'],
  inventory: ['--anchor'],
};

async function main(args) {
  const [action, ...rest] = args;
  if (action === '--help' || !action) return console.log(USAGE);
  if (!Object.hasOwn(VALUES, action)) throw new ShippingError('Invalid action');
  /** @type {Record<string, any>} */
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--verify-restore' && action === 'recover') opts.verify = true;
    else if (VALUES[action].includes(arg)) {
      if (!rest[i + 1] || rest[i + 1].startsWith('--') || opts[arg])
        throw new ShippingError('Invalid options');
      opts[arg] = rest[++i];
    } else throw new ShippingError('Invalid options');
  }
  const name = opts['--name'];
  let result;
  if (action === 'inventory') {
    const inventory = await readInventory(process.env.BACKUP_SHIPPING_INVENTORY ?? '');
    if (opts['--anchor']) assertAnchored(inventory, opts['--anchor']);
    const latest = new Map(inventory.entries.map((entry) => [entry.backupId, entry.status]));
    result = {
      status: opts['--anchor'] ? 'chain-valid-anchor-present' : 'chain-valid-unanchored',
      entries: inventory.entries.length,
      backups: latest.size,
      verified: [...latest.values()].filter((status) => status === 'verified').length,
      head: inventory.head,
    };
  } else {
    const config = await loadShippingConfig();
    if (action === 'ship') result = await ship({ name, config });
    else if (action === 'verify') result = await verifyShipped({ name, config });
    else {
      let key;
      try {
        assertKeySeparation(process.env, [opts['--temp-dir'], config.replicaDir]);
        key = await loadKey();
      } catch {
        throw new ShippingError('Replication key is missing, malformed or insecurely stored');
      }
      result = await recoverShipped({
        name,
        config,
        key,
        tempDir: opts['--temp-dir'],
        verify: opts.verify ? restoreVerifier() : null,
      });
    }
  }
  console.log(`[shipping] ${JSON.stringify(result)}`);
}

main(process.argv.slice(2)).catch((error) => {
  // Only ShippingError messages are known to be free of secrets and paths.
  const safe = error instanceof ShippingError;
  console.error(`[shipping] FAILED: ${safe ? error.message : 'unexpected internal error'}`);
  process.exitCode = safe && error.mismatch ? EXIT.INTEGRITY : EXIT.TOOL_FAILED;
});
