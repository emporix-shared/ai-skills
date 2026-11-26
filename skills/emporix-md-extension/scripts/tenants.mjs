#!/usr/bin/env node
// @ts-check
// SPDX-License-Identifier: MIT
//
// Manage Emporix tenant profiles in ~/.emporix/tenants.json (override with EMPORIX_TENANTS_FILE).
// Entry script: HELP + runMain over the shared libs in ./lib (node: imports only).

import { readFileSync } from 'node:fs';
import { EXIT, ScriptError, runMain } from './lib/cli.mjs';
import { PROFILES_FILE, ensureProfilesFile, hostingPreflight, listProfiles, preflightFailure, resolveSession } from './lib/emporix.mjs';
import { openFile } from './lib/platform.mjs';

const HELP = `Usage:
  node tenants.mjs list              table of profiles, never prints secrets
  node tenants.mjs init              create the file from a template if missing (0600 where supported) and open it in the editor
  node tenants.mjs open              open the file in the editor
  node tenants.mjs path              print the file path
  node tenants.mjs check <alias>     mint/validate a token for the profile and probe Hosting access (read-only)

Editor: \$EMPORIX_EDITOR, else cursor, code, then the OS opener.
`;

const options = { help: { type: 'boolean', short: 'h' } };


/** Open the profiles file; a missing editor is a hint, not a failure. */
async function openProfiles() {
  try {
    await openFile(PROFILES_FILE);
  } catch (err) {
    console.error(/** @type {Error} */ (err).message);
  }
}

runMain({ help: HELP, options }, async ({ positionals }) => {
  const [sub, alias] = positionals;
  switch (sub) {
    case 'path':
      console.log(PROFILES_FILE);
      return;
    case 'init': {
      const existed = (() => { try { readFileSync(PROFILES_FILE); return true; } catch { return false; } })();
      ensureProfilesFile();
      if (existed) console.log(`Profiles file already exists: ${PROFILES_FILE}`);
      else {
        console.log(`Created tenant profiles template: ${PROFILES_FILE}`);
        console.log('Fill in tenant, apiUrl and clientId/clientSecret (or token) for each profile you need, then save.');
      }
      await openProfiles();
      return;
    }
    case 'open':
      ensureProfilesFile();
      await openProfiles();
      return;
    case 'list': {
      const profiles = listProfiles();
      if (!profiles.length) throw new ScriptError(EXIT.FAILED, 'No profiles defined.');
      const rows = profiles.map((p) => [p.alias, p.tenant ?? '-', p.apiUrl, p.auth === 'token' ? 'token (static)' : p.auth === 'incomplete' ? 'INCOMPLETE' : p.auth, p.isDefault ? '*' : '', p.tenant ? p.description : 'missing tenant']);
      const head = ['ALIAS', 'TENANT', 'API URL', 'AUTH', 'DEFAULT', 'NOTE'];
      const width = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
      const fmt = (/** @type {string[]} */ r) => r.map((c, i) => String(c).padEnd(width[i])).join('  ').trimEnd();
      console.log(fmt(head));
      for (const r of rows) console.log(fmt(r));
      return;
    }
    case 'check': {
      if (!alias) throw new ScriptError(EXIT.USAGE, 'Usage: node tenants.mjs check <alias>');
      const session = await resolveSession({ alias });
      console.log(`Profile '${alias}': tenant=${session.tenant} api=${session.apiUrl} token=obtained`);
      const pre = await hostingPreflight(session);
      switch (pre.kind) {
        case 'available':
          console.log(`Hosting available for tenant ${session.tenant}. Ready to deploy.`);
          return;
        case 'unavailable':
        case 'failed':
          throw preflightFailure(pre, undefined);
      }
      return;
    }
    default:
      throw new ScriptError(EXIT.USAGE, `Expected one of: list, init, open, path, check <alias>${sub ? ` (got "${sub}")` : ''}\n\n${HELP}`);
  }
});
