// @ts-check
// SPDX-License-Identifier: MIT
//
// Shared CLI shell for every emporix-md-extension entry script: strict
// parseArgs, --help, ScriptError -> exit code, stderr formatting with a secret
// scrubber backstop. Single owner of exit codes.

import { parseArgs } from 'node:util';

export const EXIT = Object.freeze({ OK: 0, FAILED: 1, USAGE: 2, STILL_RUNNING: 3, HOSTING_UNAVAILABLE: 4 });

/** Secret values registered by emporix.mjs (shared through a global symbol so no extra export is needed). */
const SECRETS_KEY = Symbol.for('emporix-md-extension.secrets');

/**
 * A failure with a user-facing message and a process exit code.
 */
export class ScriptError extends Error {
  /**
   * @param {number} exitCode one of EXIT
   * @param {string} message user-facing text (never contains secrets)
   */
  constructor(exitCode, message) {
    super(message);
    this.name = 'ScriptError';
    /** @type {number} */
    this.exitCode = exitCode;
  }
}

/** @returns {string[]} registered secret values worth scrubbing, longest first */
function knownSecrets() {
  const set = /** @type {Set<string>|undefined} */ (/** @type {any} */ (globalThis)[SECRETS_KEY]);
  return set ? [...set].filter((s) => s.length >= 6).sort((a, b) => b.length - a.length) : [];
}

/**
 * Replace registered secrets, bearer tokens and token-like query values.
 * @param {string} text
 * @returns {string}
 */
function scrub(text) {
  let out = text;
  for (const secret of knownSecrets()) out = out.split(secret).join('[redacted]');
  return out
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[redacted]')
    .replace(/([?&](?:access_token|token|client_secret)=)[^&\s"']+/gi, '$1[redacted]');
}

/** Scrub everything the process writes to stdout/stderr from here on. */
function installScrubber() {
  for (const stream of [process.stdout, process.stderr]) {
    const original = stream.write.bind(stream);
    /** @type {any} */ (stream).write = (/** @type {any} */ chunk, /** @type {any[]} */ ...rest) =>
      original(typeof chunk === 'string' ? scrub(chunk) : chunk instanceof Uint8Array ? scrub(Buffer.from(chunk).toString('utf8')) : chunk, ...rest);
  }
}

/**
 * Run an entry script.
 * @param {{help: string, options: import('node:util').ParseArgsConfig['options']}} spec
 * @param {(args: {values: Record<string, any>, positionals: string[]}) => Promise<void|number>} handler
 * @returns {Promise<void>}
 */
export async function runMain(spec, handler) {
  installScrubber();
  /** @type {{values: Record<string, any>, positionals: string[]}} */
  let parsed;
  try {
    parsed = /** @type {any} */ (parseArgs({ args: process.argv.slice(2), options: spec.options, allowPositionals: true, strict: true }));
  } catch (err) {
    process.stderr.write(`${/** @type {Error} */ (err).message}\n\n${spec.help}`);
    process.exitCode = EXIT.USAGE;
    return;
  }
  if (parsed.values.help) {
    process.stdout.write(spec.help);
    process.exitCode = EXIT.OK;
    return;
  }
  try {
    const result = await handler(parsed);
    process.exitCode = typeof result === 'number' ? result : EXIT.OK;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${message}\n`);
    process.exitCode = err instanceof ScriptError ? err.exitCode : EXIT.FAILED;
  }
}
