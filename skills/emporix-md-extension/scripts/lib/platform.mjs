// @ts-check
// SPDX-License-Identifier: MIT
//
// Every process.platform branch lives here: browser/editor launch, child
// tools with fixed argv, private file writes.

import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';

const WIN = process.platform === 'win32';

/** @param {string} s quote one argument for cmd.exe */
const quoteWin = (s) => `"${String(s).replace(/"/g, '\\"')}"`;

/**
 * Start a detached process and resolve once it has spawned.
 * @param {string} command
 * @param {string[]} args
 * @returns {Promise<void>}
 */
function launch(command, args) {
  return new Promise((resolve, reject) => {
    const viaShell = WIN && /\.(cmd|bat)$/i.test(command);
    const child = viaShell
      ? spawn([command, ...args].map(quoteWin).join(' '), [], { shell: true, detached: true, stdio: 'ignore', windowsHide: true })
      : spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve(undefined);
    });
  });
}

/** @param {string} p */
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

/**
 * Resolve a command name on PATH (PATHEXT on Windows).
 * @param {string} name
 * @returns {string|null}
 */
function findOnPath(name) {
  const exts = WIN ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean) : [''];
  for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = join(dir, name + ext.toLowerCase());
      if (isFile(candidate)) return candidate;
      const upper = join(dir, name + ext);
      if (isFile(upper)) return upper;
    }
  }
  return null;
}

/** @returns {{command:string, args:(target:string)=>string[]}} the OS opener for files and URLs */
function osOpener() {
  if (process.platform === 'darwin') return { command: 'open', args: (t) => [t] };
  if (WIN) return { command: 'rundll32', args: (t) => ['url.dll,FileProtocolHandler', t] };
  return { command: 'xdg-open', args: (t) => [t] };
}

/**
 * Open a URL in the default browser. Only safeHref may be logged.
 * @param {import('./emporix.mjs').SecretUrl} secretUrl
 * @returns {Promise<void>}
 */
export async function openUrl(secretUrl) {
  const href = secretUrl.href;
  const browser = process.env.BROWSER;
  const opener = osOpener();
  try {
    if (browser) await launch(browser, [href]);
    else await launch(opener.command, opener.args(href));
  } catch (err) {
    const code = /** @type {NodeJS.ErrnoException} */ (err).code ?? 'error';
    throw new Error(`Could not start a browser (${browser ? '$BROWSER' : opener.command}: ${code}). Open ${secretUrl.safeHref} manually.`);
  }
}

/**
 * Open a file in the editor: $EMPORIX_EDITOR, else cursor, code, then OS opener.
 * @param {string} file
 * @returns {Promise<void>}
 */
export async function openFile(file) {
  const editor = process.env.EMPORIX_EDITOR;
  if (editor) {
    await launch(editor, [file]);
    return;
  }
  for (const name of ['cursor', 'code']) {
    const found = findOnPath(name);
    if (!found) continue;
    try {
      await launch(found, [file]);
      return;
    } catch { /* try the next one */ }
  }
  const opener = osOpener();
  try {
    await launch(opener.command, opener.args(file));
  } catch {
    throw new Error(`No editor found; open ${file} manually.`);
  }
}

/**
 * Run git, npm or npx with a fixed argv.
 * @param {'git'|'npm'|'npx'} tool
 * @param {string[]} args
 * @param {{cwd?: string, inherit?: boolean, env?: Record<string,string>}} [opts]
 * @returns {{status:number, stdout:string, stderr:string}}
 */
export function runTool(tool, args, opts = {}) {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env, ...opts.env };
  for (const secret of ['EMPORIX_TOKEN', 'EMPORIX_CLIENT_ID', 'EMPORIX_CLIENT_SECRET']) delete env[secret];
  /** @type {import('node:child_process').SpawnSyncOptionsWithStringEncoding} */
  const options = {
    cwd: opts.cwd,
    env,
    encoding: 'utf8',
    windowsHide: true,
    stdio: opts.inherit ? ['ignore', 'inherit', 'inherit'] : ['ignore', 'pipe', 'pipe'],
  };
  const r = WIN && tool !== 'git'
    ? spawnSync([tool, ...args].map((a, i) => (i === 0 ? a : quoteWin(a))).join(' '), { ...options, shell: true })
    : spawnSync(tool, args, options);
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: (r.stderr ?? '') + (r.error ? `${tool}: ${r.error.message}` : ''),
  };
}

/**
 * Write a file readable only by the owner (0600 where supported).
 * @param {string} file
 * @param {string|Uint8Array} data
 * @returns {void}
 */
export function writePrivateFile(file, data) {
  writeFileSync(file, data, { mode: 0o600 });
  if (WIN) return;
  try { chmodSync(file, 0o600); } catch { /* best effort */ }
}
