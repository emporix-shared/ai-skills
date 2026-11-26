#!/usr/bin/env node
// @ts-check
// SPDX-License-Identifier: MIT
//
// Open the running standalone dev shell in the browser, pre-filled with the tenant and a token from the selected profile.
// Entry script: HELP + runMain over the shared libs in ./lib (node: imports only).

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT, ScriptError, runMain } from './lib/cli.mjs';
import { resolveSession } from './lib/emporix.mjs';
import { openUrl } from './lib/platform.mjs';
import { readHostingRecord } from './lib/records.mjs';

const HELP = `Usage:
  node dev-open.mjs [--tenant <profile-alias>] [--project <dir>] [--url http://localhost:5173]
                    [--language en] [--no-env]

  --tenant <alias>   profile (default: .ai/md-extension/hosting.json profile, then the default profile)
  --project <dir>    extension project (default: current directory)
  --url <url>        dev server URL (default http://localhost:5173)
  --language <code>  UI language written into the URL
  --no-env           do not write VITE_API_URL to <project>/.env.local
  -h, --help         show this help

Ensures settings.helpers.ts accepts URL settings (dev-settings-patch), writes
VITE_API_URL=<profile apiUrl> to <project>/.env.local unless --no-env (gitignored),
and opens <url>/?tenant=...&token=...&language=... in the default browser. The page
stores the values and strips them from the address bar. The token is never printed.
`;

const options = { tenant: { type: 'string' }, project: { type: 'string' }, url: { type: 'string' }, language: { type: 'string' }, 'no-env': { type: 'boolean' }, help: { type: 'boolean', short: 'h' } };

const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

runMain({ help: HELP, options }, async ({ values }) => {
  const project = values.project ?? '.';
  const base = (values.url ?? 'http://localhost:5173').replace(/\/+$/, '');
  const rec = readHostingRecord(values.project);
  const session = await resolveSession({ alias: values.tenant ?? rec?.profile ?? null });

  // URL-settings patch (same script the scaffold runs); failure only means the settings dialog opens instead.
  const patch = spawnSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'dev-settings-patch.mjs'), project], { encoding: 'utf8', windowsHide: true });
  if (patch.status !== 0) console.error('Could not patch settings.helpers.ts automatically; the browser will open the settings dialog instead.');

  if (!values['no-env']) {
    const envFile = join(project, '.env.local');
    const lines = existsSync(envFile) ? readFileSync(envFile, 'utf8').split(/\r?\n/) : [];
    const current = lines.find((l) => l.startsWith('VITE_API_URL='))?.slice('VITE_API_URL='.length);
    if (current !== session.apiUrl) {
      const kept = lines.filter((l) => !l.startsWith('VITE_API_URL=') && l !== '');
      const tmp = `${envFile}.${process.pid}.tmp.local`; // *.local stays gitignored
      writeFileSync(tmp, `${[...kept, `VITE_API_URL=${session.apiUrl}`].join('\n')}\n`);
      renameSync(tmp, envFile);
      console.log(`Set VITE_API_URL=${session.apiUrl} in ${envFile} (Vite restarts the dev server automatically).`);
      await sleep(2000);
    }
  }

  let reachable = false;
  try {
    reachable = (await fetch(`${base}/`, { signal: AbortSignal.timeout(5000) })).status === 200;
  } catch { /* reported below */ }
  if (!reachable) throw new ScriptError(EXIT.FAILED, `Dev server not reachable at ${base}. Start it with 'npm run dev' in ${project}, or pass --url.`);

  const language = values.language ?? session.language ?? 'en';
  const secretUrl = session.urlWithToken(base, { language });
  console.log(`Opening ${secretUrl.safeHref}`);
  try {
    await openUrl(secretUrl);
  } catch (err) {
    throw new ScriptError(EXIT.FAILED, `${/** @type {Error} */ (err).message}\nOpen ${base}/ and enter tenant/token manually.`);
  }
  console.log(`Opened ${base}/ for tenant ${session.tenant} (profile ${session.origin.kind === 'profile' ? session.origin.alias : 'env'}, API ${session.apiUrl}, language ${language}).`);
});
