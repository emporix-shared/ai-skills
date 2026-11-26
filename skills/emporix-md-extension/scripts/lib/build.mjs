// @ts-check
// SPDX-License-Identifier: MIT
//
// Hosting build status: lookup, polling and log tail. Single owner of the
// status rules; deploy.mjs and deploy-status.mjs both call it in-process.

import { EXIT, ScriptError } from './cli.mjs';
import { apiGet } from './emporix.mjs';

/** @typedef {'QUEUED'|'WORKING'|'SUCCESS'|'FAILURE'|'INTERNAL_ERROR'|'CANCELLED'|'TIMEOUT'|'EXPIRED'} BuildStatus */
/** @typedef {{phase:'running', status:BuildStatus|'UNKNOWN'} | {phase:'succeeded', siteUrl:string|null}
 *          | {phase:'failed', status:BuildStatus, logTail:string[]}} BuildPhase */

/** Statuses that are terminal. An unknown status is never treated as success. */
export const TERMINAL_STATUSES = Object.freeze(['SUCCESS', 'FAILURE', 'INTERNAL_ERROR', 'CANCELLED', 'TIMEOUT', 'EXPIRED']);

const DEFAULT_INTERVAL_MS = 20_000;
const DEFAULT_TIMEOUT_MS = 900_000;
const LOG_TAIL_LINES = 60;

/**
 * The server's status text is an open set; anything not in BuildStatus is UNKNOWN.
 * @param {unknown} raw
 * @returns {BuildStatus|'UNKNOWN'}
 */
function toStatus(raw) {
  switch (raw) {
    case 'QUEUED': case 'WORKING': case 'SUCCESS': case 'FAILURE':
    case 'INTERNAL_ERROR': case 'CANCELLED': case 'TIMEOUT': case 'EXPIRED':
      return raw;
    default:
      return 'UNKNOWN';
  }
}

/**
 * Which phase a status belongs to. BuildStatus|'UNKNOWN' is a closed set: no default branch.
 * @param {BuildStatus|'UNKNOWN'} status
 * @returns {'running'|'succeeded'|'failed'}
 */
function classify(status) {
  switch (status) {
    case 'SUCCESS':
      return 'succeeded';
    case 'FAILURE': case 'INTERNAL_ERROR': case 'CANCELLED': case 'TIMEOUT': case 'EXPIRED':
      return 'failed';
    case 'QUEUED': case 'WORKING': case 'UNKNOWN':
      return 'running';
  }
  throw new Error(`Unclassified build status: ${String(status)}`);
}

/**
 * One read of the deployment (status, steps and logs share one endpoint).
 * @param {import('./emporix.mjs').Session} session
 * @param {string} buildId
 * @returns {Promise<{id:string, status:BuildStatus|'UNKNOWN', steps:{id:string, status:string}[], logs:string}>}
 */
async function fetchBuild(session, buildId) {
  const res = await apiGet(session, `/automation/${encodeURIComponent(session.tenant)}/projects/deployments/${encodeURIComponent(buildId)}/logs`);
  if (res.status < 200 || res.status >= 300) {
    throw new ScriptError(EXIT.FAILED, `Could not read deployment ${buildId} for tenant ${session.tenant} (HTTP ${res.status}). If the id is not found, open Administration -> Hosting -> <hosting> -> Build History for the Deployment ID.`);
  }
  const info = res.body?.buildInfo ?? {};
  const logs = typeof res.body?.logs === 'string' ? res.body.logs : Array.isArray(res.body?.logs) ? res.body.logs.join('\n') : '';
  const steps = Array.isArray(info.steps)
    ? info.steps.map((/** @type {any} */ s) => ({ id: String(s?.id ?? '?'), status: String(s?.status ?? 'PENDING') }))
    : [];
  return { id: typeof info.id === 'string' ? info.id : buildId, status: toStatus(info.status), steps, logs };
}

/**
 * Look up a build's status.
 * @param {import('./emporix.mjs').Session} session
 * @param {string} buildId
 * @returns {Promise<BuildStatus|'UNKNOWN'>}
 */
export async function lookupBuildStatus(session, buildId) {
  return (await fetchBuild(session, buildId)).status;
}

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @param {string} logs @returns {string[]} */
function tailOf(logs) {
  const lines = logs.split(/\r?\n/);
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.slice(-LOG_TAIL_LINES);
}

/**
 * Poll a build until terminal or timeout. Prints progress lines (and the full
 * log with fullLogs) to stdout.
 * @param {import('./emporix.mjs').Session} session
 * @param {string} buildId
 * @param {{wait?: boolean, timeoutMs?: number, intervalMs?: number, project?: string, fullLogs?: boolean}} [opts]
 * @returns {Promise<BuildPhase>}
 */
export async function pollBuild(session, buildId, opts = {}) {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const started = Date.now();
  for (;;) {
    const build = await fetchBuild(session, buildId);
    console.log(`[${new Date().toISOString()}] build ${build.id} status=${build.status}`);
    for (const step of build.steps) console.log(`   ${step.status.padEnd(9)} ${step.id}`);
    const phase = classify(build.status);
    if (phase !== 'running' || !opts.wait || Date.now() - started >= timeoutMs) {
      if (opts.fullLogs && build.logs) console.log(build.logs);
      switch (phase) {
        case 'succeeded':
          return { phase: 'succeeded', siteUrl: build.logs.match(/Hosting URL:\s*(\S+)/)?.[1] ?? null };
        case 'failed':
          return { phase: 'failed', status: /** @type {BuildStatus} */ (build.status), logTail: tailOf(build.logs) };
        case 'running':
          return { phase: 'running', status: build.status };
      }
    }
    await sleep(intervalMs);
  }
}

/**
 * The user-facing report for a finished or still-running build, shared by deploy.mjs and deploy-status.mjs.
 * @param {BuildPhase} phase
 * @param {{buildId:string, fallbackSiteUrl:string|null, followHint:string|null}} ctx followHint: shown when still running
 * @returns {{exitCode:number, stdout:string[], stderr:string[]}}
 */
export function formatBuildReport(phase, ctx) {
  switch (phase.phase) {
    case 'succeeded': {
      const site = phase.siteUrl ?? ctx.fallbackSiteUrl;
      const out = ['Deployment finished successfully.'];
      if (site) out.push(`  site         : ${site}`, `  remoteEntry  : ${site.replace(/\/+$/, '')}/assets/remoteEntry.js`);
      else out.push('  The hosting URL was not in the build log; see Administration -> Hosting.');
      out.push(`  build id     : ${ctx.buildId}`);
      return { exitCode: EXIT.OK, stdout: out, stderr: [] };
    }
    case 'failed':
      return { exitCode: EXIT.FAILED, stdout: [], stderr: [`Deployment ${ctx.buildId} ended with status ${phase.status}. Last log lines:`, ...phase.logTail] };
    case 'running':
      return { exitCode: EXIT.STILL_RUNNING, stdout: [], stderr: [`Build ${ctx.buildId} is still running (status ${phase.status}).${ctx.followHint ? ` ${ctx.followHint}` : ''}`] };
  }
  throw new Error(`Unhandled build phase: ${/** @type {any} */ (phase).phase}`);
}

/** @param {{exitCode:number, stdout:string[], stderr:string[]}} report @returns {number} exit code */
export function printBuildReport(report) {
  for (const l of report.stdout) console.log(l);
  for (const l of report.stderr) console.error(l);
  return report.exitCode;
}
