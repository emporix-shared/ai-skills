#!/usr/bin/env node
// @ts-check
// SPDX-License-Identifier: MIT
//
// Zip an extension project for Emporix hosting.
// Entry script: HELP + runMain over the shared libs in ./lib (node: imports only).

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EXIT, ScriptError, runMain } from './lib/cli.mjs';
import { writeZip } from './lib/zip.mjs';

const HELP = `Usage:
  node package.mjs [project-dir] [--out <file.zip>]

The archive root holds the project files directly (package.json at top level);
node_modules, dist, .git and local artifacts are excluded. The hosting build runs
npm install and npm run build (vite --mode prod) on the uploaded source.

Stdout is the zip path only (warnings go to stderr).
`;

const options = { out: { type: 'string' }, help: { type: 'boolean', short: 'h' } };

/** Directories skipped at any depth. */
const SKIP_ANYWHERE = new Set(['node_modules', '.git', '.ai']);
/** Directories skipped only at the project root (as the bash `dist/*` patterns did). */
const SKIP_AT_ROOT = new Set(['dist', 'dist-ssr', '.vite', 'coverage', '.firebase']);

/** @param {string} name @returns {boolean} */
const skipFile = (name) => name === '.DS_Store' || name.endsWith('.log') || name.endsWith('.local') || name.endsWith('.zip');

/**
 * @param {string} root
 * @param {string} rel forward-slash path relative to root ('' for the root)
 * @param {import('./lib/zip.mjs').ZipEntry[]} out
 * @param {string[]} warnings
 */
function walk(root, rel, out, warnings) {
  const dir = rel ? join(root, ...rel.split('/')) : root;
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (SKIP_ANYWHERE.has(entry.name) || (!rel && SKIP_AT_ROOT.has(entry.name))) continue;
      walk(root, path, out, warnings);
    } else if (entry.isFile()) {
      if (skipFile(entry.name)) continue;
      const file = join(root, ...path.split('/'));
      if (entry.name.startsWith('.env') && !['.env', '.env.example', '.env.prod'].includes(entry.name)) warnings.push(`${path} is included in the archive; make sure it holds no secrets.`);
      out.push({ name: path, data: readFileSync(file), mtime: statSync(file).mtime });
    } else {
      warnings.push(`Skipped ${path}: not a regular file or directory.`);
    }
  }
}

/** @param {Date} d @returns {string} YYYYMMDD-HHMMSS */
const stamp = (d) => {
  const p = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

runMain({ help: HELP, options }, async ({ values, positionals }) => {
  const project = resolve(positionals[0] ?? '.');
  const pkgFile = join(project, 'package.json');
  if (!existsSync(pkgFile)) throw new ScriptError(EXIT.FAILED, `No package.json in ${project}`);
  /** @type {any} */
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
  } catch (err) {
    throw new ScriptError(EXIT.FAILED, `Invalid JSON in ${pkgFile}: ${/** @type {Error} */ (err).message}`);
  }
  if (!pkg?.scripts?.build) throw new ScriptError(EXIT.FAILED, 'package.json has no "build" script');
  const name = String(pkg.name || 'extension').replace(/[^A-Za-z0-9._-]+/g, '-');

  /** @type {string[]} */
  const warnings = [];
  const read = (/** @type {string} */ f) => (existsSync(join(project, f)) ? readFileSync(join(project, f), 'utf8') : null);
  const envProd = read('.env.prod');
  if (envProd === null || !/^VITE_API_URL=/m.test(envProd)) warnings.push(".env.prod with VITE_API_URL is missing; the hosting build uses 'vite build --mode prod'.");
  const vite = read('vite.config.ts');
  if (vite !== null && !vite.includes('https://admin.emporix.io')) warnings.push('vite.config.ts does not whitelist https://admin.emporix.io; the non-interactive CORS check fails in the hosting build.');
  if (vite !== null && !/filename:\s*['"]remoteEntry\.js['"]/.test(vite)) warnings.push('The federation filename is not remoteEntry.js.');

  /** @type {import('./lib/zip.mjs').ZipEntry[]} */
  const entries = [];
  walk(project, '', entries, warnings);

  const out = resolve(values.out ?? join(project, '.ai', 'md-extension', 'dist', `${name}-${stamp(new Date())}.zip`));
  mkdirSync(join(out, '..'), { recursive: true });
  writeZip(out, entries);

  const kb = Math.max(1, Math.round(statSync(out).size / 1024));
  console.error(`Packaged ${name} -> ${out} (${entries.length} files, ${kb} KB)`);
  for (const w of warnings) console.error(`WARNING: ${w}`);
  if (warnings.length) console.error('Review the warnings above before deploying.');
  console.log(out);
});
