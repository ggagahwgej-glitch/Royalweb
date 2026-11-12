#!/usr/bin/env node
/**
 * Database CLI entry point.
 * Migrations live in TypeScript, so this script bundles the CLI with esbuild
 * and runs it in plain Node (no Next.js runtime needed).
 *
 *   npm run db:migrate
 *   npm run db:reset
 */
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const outfile = path.join(process.cwd(), '.data-tmp', 'db-cli.mjs');
fs.mkdirSync(path.dirname(outfile), { recursive: true });

await build({
  entryPoints: [path.join(process.cwd(), 'src/lib/db/cli.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['node:sqlite'],
  logLevel: 'warning',
});

const mod = await import(pathToFileURL(outfile).href);
void mod;
