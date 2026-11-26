#!/usr/bin/env node
// @ts-check
// SPDX-License-Identifier: MIT
//
// Create an Emporix hosting for a Management Dashboard extension and register it as an extension (module) or a perspective.
// Entry script: HELP + runMain over the shared libs in ./lib (node: imports only).

import { EXIT, ScriptError, runMain } from './lib/cli.mjs';
import { hostingPreflight, preflightFailure, resolveSession } from './lib/emporix.mjs';
import { readHostingRecord, writeHostingRecord } from './lib/records.mjs';

const HELP = `Usage:
  node hosting-create.mjs --id <hostingId> --type extension|perspective --name "<EN display name>"
                          [--name-de "<DE display name>"] [--url-path /path] [--allowed-groups g1,g2]
                          [--tenant <profile-alias>] [--project <extension-dir>]

  --id <hostingId>        hosting id
  --type <type>           extension or perspective (perspective requires --url-path)
  --name <text>           EN display name
  --name-de <text>        DE display name
  --url-path </path>      perspective URL path, must start with /
  --allowed-groups <g,g>  comma-separated groups allowed to see the perspective
  --tenant <alias>        profile from ~/.emporix/tenants.json
  --project <dir>         extension project (default: current directory)
  -h, --help              show this help

Needs Hosting access: a read-only preflight runs first; with no access nothing is
written (exit 4, manual route printed). Writes <project>/.ai/md-extension/hosting.json
so deploy.mjs can pick the hosting up. Re-running with the same id is a no-op.
`;

const options = { id: { type: 'string' }, type: { type: 'string' }, name: { type: 'string' }, 'name-de': { type: 'string' }, 'url-path': { type: 'string' }, 'allowed-groups': { type: 'string' }, tenant: { type: 'string' }, project: { type: 'string' }, help: { type: 'boolean', short: 'h' } };

/** @param {string|undefined} defaultUrl */
const remoteEntryOf = (defaultUrl) => (defaultUrl ? `${defaultUrl.replace(/\/+$/, '')}/assets/remoteEntry.js` : null);

/** @param {{siteId:string, defaultUrl:string|null, remoteEntryUrl:string|null}} h @param {string} file */
function printHosting(h, file) {
  console.log(`  site id      : ${h.siteId}        (use this with deploy.mjs --hosting)`);
  console.log(`  default URL  : ${h.defaultUrl ?? '(unknown)'}`);
  console.log(`  remoteEntry  : ${h.remoteEntryUrl ?? '(unknown)'}   (live after the first successful deploy)`);
  console.log(`  saved to     : ${file}`);
}

runMain({ help: HELP, options }, async ({ values }) => {
  const { id, type, name } = values;
  if (!id || !type || !name) throw new ScriptError(EXIT.USAGE, '--id, --type and --name are required');
  if (type !== 'extension' && type !== 'perspective') throw new ScriptError(EXIT.USAGE, '--type must be extension or perspective');
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) throw new ScriptError(EXIT.USAGE, `Hosting id must be lowercase letters, digits and hyphens: ${id}`);
  if (id.length > 41) throw new ScriptError(EXIT.USAGE, `Hosting id is limited to 41 characters (${id.length} given)`);
  const urlPath = values['url-path'];
  const groups = values['allowed-groups'];
  /** @type {import('./lib/emporix.mjs').Registration} */
  let registration;
  switch (type) {
    case 'extension':
      if (urlPath !== undefined || groups !== undefined) throw new ScriptError(EXIT.USAGE, '--url-path and --allowed-groups only apply to --type perspective');
      registration = { type: 'extension' };
      break;
    case 'perspective':
      if (!urlPath) throw new ScriptError(EXIT.USAGE, '--url-path is required for a perspective (must start with /)');
      if (!urlPath.startsWith('/')) throw new ScriptError(EXIT.USAGE, '--url-path must start with /');
      registration = { type: 'perspective', urlPath: /** @type {`/${string}`} */ (urlPath), allowedGroups: groups ? groups.split(',').map((/** @type {string} */ g) => g.trim()).filter(Boolean) : null };
      break;
  }

  const rec = readHostingRecord(values.project);
  if (rec && rec.hostingId !== id) {
    throw new ScriptError(EXIT.USAGE, `${values.project ?? '.'}/.ai/md-extension/hosting.json already records hosting '${rec.hostingId}'. One project has one hosting: use another project directory, or delete the record.`);
  }
  // same alias order as the other scripts: --tenant, then the profile recorded in hosting.json, then the default
  const session = await resolveSession({ alias: values.tenant ?? rec?.profile ?? null });
  const siteId = `${session.tenant}-${id}`;
  if (siteId.length > 63) throw new ScriptError(EXIT.USAGE, `tenant + '-' + id must be <= 63 characters (${siteId} is ${siteId.length})`);
  const file = `${values.project ?? '.'}/.ai/md-extension/hosting.json`;
  if (rec) {
    if (rec.tenant !== session.tenant) throw new ScriptError(EXIT.USAGE, `${file} belongs to tenant ${rec.tenant}, not ${session.tenant}. Use another project directory, or delete the record.`);
    console.log(`Hosting '${id}' is already recorded for tenant ${rec.tenant}.`);
    printHosting(rec, file);
    return;
  }

  const pre = await hostingPreflight(session);
  if (pre.kind !== 'available') throw preflightFailure(pre, values.project);

  const profile = session.origin.kind === 'profile' ? session.origin.alias : null;
  /** @param {string|null} defaultUrl @returns {import('./lib/records.mjs').HostingRecord} */
  const record = (defaultUrl) => ({
    tenant: session.tenant, profile, hostingId: id, siteId, defaultUrl, remoteEntryUrl: remoteEntryOf(defaultUrl ?? undefined),
    type, urlPath: urlPath ?? null, createdAt: new Date().toISOString(),
  });
  const existing = pre.hostings?.find((h) => h.siteId === siteId);
  if (existing) {
    const saved = record(existing.defaultUrl);
    writeHostingRecord(values.project, saved);
    console.log(`Hosting site ${siteId} already exists on tenant ${session.tenant}; recorded it, nothing was created.`);
    printHosting(saved, file);
    return;
  }

  console.log(`Creating ${type} hosting '${id}' for tenant ${session.tenant}...`);
  const created = await pre.gate.createHosting({ id, name, nameDe: values['name-de'] ?? null, registration });
  const saved = { ...record(created.defaultUrl), siteId: created.siteId, remoteEntryUrl: created.remoteEntryUrl };
  writeHostingRecord(values.project, saved);
  console.log('\nHosting created.');
  printHosting(saved, file);
});
