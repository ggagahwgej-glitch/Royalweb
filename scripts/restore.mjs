#!/usr/bin/env node
/**
 * Offline snapshot restore.
 *
 * Swapping a SQLite file under a running server corrupts it, so restoring is a
 * deliberate CLI operation performed with the app stopped:
 *
 *   npm run db:restore -- data/snapshots/royalweb-snapshot-....rwbak
 *
 * The passphrase is read from ROYALWEB_SNAPSHOT_PASSPHRASE so it never lands in
 * shell history, or prompted for interactively.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run db:restore -- <snapshot.rwbak>');
  process.exit(1);
}

const KDF = { N: 32768, r: 8, p: 1 };

function decrypt(doc, passphrase) {
  const salt = Buffer.from(doc.kdf.salt, 'base64url');
  const key = crypto.scryptSync(passphrase.normalize('NFKC'), salt, 32, { ...KDF, maxmem: 128 * 1024 * 1024 });
  const aad = Buffer.from(
    [doc.format, doc.version, doc.alg, doc.kdf.name, doc.kdf.N, doc.kdf.r, doc.kdf.p, doc.kdf.salt].join('|'),
    'utf8'
  );
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(doc.iv, 'base64url'));
  decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(doc.tag, 'base64url'));
  const out = Buffer.concat([decipher.update(Buffer.from(doc.data, 'base64url')), decipher.final()]);
  return out.toString('utf8');
}

const raw = fs.readFileSync(file, 'utf8');
let doc;
try {
  doc = JSON.parse(raw);
} catch {
  console.error('That file is not a ROYALWEB snapshot.');
  process.exit(1);
}
if (doc.format !== 'royalweb-snapshot') {
  console.error(`Not a database snapshot (format: ${doc.format}). Credential backups are restored from the dashboard.`);
  process.exit(1);
}

let passphrase = process.env.ROYALWEB_SNAPSHOT_PASSPHRASE;
if (!passphrase) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  passphrase = await rl.question('Snapshot passphrase: ');
  rl.close();
}

let base64;
try {
  base64 = decrypt(doc, passphrase);
} catch {
  console.error('Wrong passphrase, or the file has been modified. Nothing was restored.');
  process.exit(1);
}

const DATA_DIR = process.env.ROYALWEB_DATA_DIR || path.join(process.cwd(), 'data');
const target = process.env.ROYALWEB_DB_PATH || path.join(DATA_DIR, 'royalweb.db');
const outFile = `${target}.restored`;
fs.writeFileSync(outFile, Buffer.from(base64, 'base64'), { mode: 0o600 });
console.log(`✓ decrypted ${(fs.statSync(outFile).size / 1024).toFixed(0)} KB → ${outFile}`);
console.log('');
console.log('The live database was NOT touched. To switch over:');
console.log('  1. stop the app');
console.log(`  2. mv "${target}" "${target}.before-restore"`);
console.log(`  3. mv "${outFile}" "${target}"`);
console.log('  4. start the app again');
