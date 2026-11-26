#!/usr/bin/env node
// @ts-check
// SPDX-License-Identifier: MIT
//
// Show (and optionally wait for) the status of an Emporix hosting deployment.
// Entry script: HELP + runMain over the shared libs in ./lib (node: imports only).

import { EXIT, ScriptError, runMain } from './lib/cli.mjs';
import { resolveSession } from './lib/emporix.mjs';
import { formatBuildReport, pollBuild, printBuildReport } from './lib/build.mjs';
import { readDeployRecord, readHostingRecord } from './lib/records.mjs';

const HELP = `Usage:
  node deploy-status.mjs [--build <buildId>] [--tenant <profile-alias>] [--project <dir>]
                         [--wait] [--interval 20] [--timeout 900] [--logs]

  --build <id>       defaults to buildId in <project>/.ai/md-extension/last-deploy.json
  --tenant <alias>   defaults to the profile of the last deploy, then the one in hosting.json
  --project <dir>    extension project (default: current directory)
  --wait             poll until the build finishes
  --interval <sec>   poll interval in seconds (default 20)
  --timeout <sec>    give up waiting after this many seconds (default 900)
  --logs             print the full build log
  -h, --help         show this help

Exit code: 0 on SUCCESS, 1 on FAILURE/INTERNAL_ERROR/CANCELLED/TIMEOUT/EXPIRED,
3 while still running (no --wait). On failure the last 60 log lines are always printed.
Read-only: no Hosting write, so no preflight gate is needed.
`;

const options = { build: { type: 'string' }, tenant: { type: 'string' }, project: { type: 'string' }, wait: { type: 'boolean' }, interval: { type: 'string' }, timeout: { type: 'string' }, logs: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } };

/**
 * @param {string} name
 * @param {string|undefined} value seconds as typed
 * @param {number} fallback seconds
 * @returns {number} milliseconds
 */
function seconds(name, value, fallback) {
  if (value === undefined) return fallback * 1000;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new ScriptError(EXIT.USAGE, `--${name} must be a positive number of seconds (got "${value}")`);
  return n * 1000;
}

runMain({ help: HELP, options }, async ({ values }) => {
  const intervalMs = seconds('interval', values.interval, 20);
  const timeoutMs = seconds('timeout', values.timeout, 900);
  const rec = readDeployRecord(values.project);
  const buildId = values.build ?? (rec?.phase === 'triggered' ? rec.buildId : undefined);
  if (!buildId) throw new ScriptError(EXIT.USAGE, `--build <buildId> is required (none found in ${values.project ?? '.'}/.ai/md-extension/last-deploy.json)`);
  const hosting = readHostingRecord(values.project);
  // the deploy record names the profile the build was started with; hosting.json is the older fallback
  const session = await resolveSession({ alias: values.tenant ?? rec?.profile ?? hosting?.profile ?? null });
  const phase = await pollBuild(session, buildId, { wait: values.wait, intervalMs, timeoutMs, project: values.project, fullLogs: values.logs });
  const report = formatBuildReport(phase, {
    buildId,
    fallbackSiteUrl: hosting?.defaultUrl ?? null,
    followHint: values.wait ? `Timed out after ${timeoutMs / 1000}s.` : 'Re-run with --wait to follow it.',
  });
  return printBuildReport(report);
});
