#!/usr/bin/env node
// @ts-check
// SPDX-License-Identifier: MIT
//
// Upload an extension zip to the Emporix media service and trigger a hosting deployment (build + release).
// Entry script: HELP + runMain over the shared libs in ./lib (node: imports only).

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { EXIT, ScriptError, runMain } from './lib/cli.mjs';
import { hostingPreflight, preflightFailure, resolveSession } from './lib/emporix.mjs';
import { formatBuildReport, pollBuild, printBuildReport } from './lib/build.mjs';
import { readDeployRecord, readHostingRecord, writeDeployRecord } from './lib/records.mjs';

const HELP = `Usage:
  node deploy.mjs --zip <file.zip> [--hosting <siteId>] [--tenant <profile-alias>]
                  [--project <extension-dir>] [--wait]

  --zip <file>       zip from package.mjs
  --hosting <siteId> defaults to siteId in <project>/.ai/md-extension/hosting.json
  --tenant <alias>   defaults to the profile in hosting.json
  --project <dir>    extension project (default: current directory)
  --wait             poll the build until it finishes
  -h, --help         show this help

Needs Hosting access: a read-only preflight runs first; with no access nothing is
uploaded (exit 4, manual route printed). Writes <project>/.ai/md-extension/last-deploy.json.
Re-running reuses an already uploaded media id for the same zip.
Exit codes: 0 success, 1 failure, 2 usage, 3 still running (no --wait), 4 Hosting unavailable.
`;

const options = { zip: { type: 'string' }, hosting: { type: 'string' }, tenant: { type: 'string' }, project: { type: 'string' }, wait: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } };

runMain({ help: HELP, options }, async ({ values }) => {
  const rec = readHostingRecord(values.project);
  if (!values.zip || !existsSync(values.zip)) throw new ScriptError(EXIT.USAGE, '--zip <file.zip> is required and must exist');
  const siteId = values.hosting ?? rec?.siteId;
  if (!siteId) throw new ScriptError(EXIT.USAGE, `--hosting <siteId> is required (e.g. <tenant>-<hostingId>); none found in ${values.project ?? '.'}/.ai/md-extension/hosting.json`);

  const session = await resolveSession({ alias: values.tenant ?? rec?.profile ?? null });
  const profile = session.origin.kind === 'profile' ? session.origin.alias : null;
  const pre = await hostingPreflight(session);
  if (pre.kind !== 'available') throw preflightFailure(pre, values.project);
  if (pre.hostings && !pre.hostings.some((h) => h.siteId === siteId)) {
    throw new ScriptError(EXIT.FAILED, `Hosting site ${siteId} was not found for tenant ${session.tenant}. Existing sites: ${pre.hostings.map((h) => h.siteId).join(', ') || '(none)'}`);
  }

  const bytes = readFileSync(values.zip);
  const zipSha256 = createHash('sha256').update(bytes).digest('hex');
  const filename = basename(values.zip);
  const last = readDeployRecord(values.project);
  let mediaId;
  if (last?.phase === 'uploaded' && last.zipSha256 === zipSha256 && last.tenant === session.tenant && last.siteId === siteId) {
    mediaId = last.mediaId;
    console.log(`Reusing the already uploaded ${filename} (mediaId: ${mediaId}).`);
  } else {
    console.log(`Uploading ${filename} to the media service...`);
    ({ mediaId } = await pre.gate.uploadMedia(bytes, filename));
    writeDeployRecord(values.project, { phase: 'uploaded', tenant: session.tenant, profile, siteId, mediaId, zipSha256, at: new Date().toISOString() });
    console.log(`  mediaId: ${mediaId}`);
  }

  console.log(`Triggering deployment on hosting ${siteId}...`);
  const { buildId } = await pre.gate.triggerDeploy(siteId, mediaId);
  writeDeployRecord(values.project, { phase: 'triggered', tenant: session.tenant, profile, siteId, mediaId, buildId, zipSha256, at: new Date().toISOString() });
  console.log(`Deployment started. buildId: ${buildId}`);

  if (!values.wait) {
    console.log(`Check progress: node deploy-status.mjs --build ${buildId}${profile ? ` --tenant ${profile}` : ''} --project ${values.project ?? '.'} --wait`);
    return EXIT.STILL_RUNNING;
  }
  const phase = await pollBuild(session, buildId, { wait: true, project: values.project });
  const follow = `Follow it with: node deploy-status.mjs --build ${buildId}${profile ? ` --tenant ${profile}` : ''} --project ${values.project ?? '.'} --wait`;
  return printBuildReport(formatBuildReport(phase, { buildId, fallbackSiteUrl: rec?.defaultUrl ?? null, followHint: follow }));
});
