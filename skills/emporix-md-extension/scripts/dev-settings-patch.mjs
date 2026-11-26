#!/usr/bin/env node
// @ts-check
// SPDX-License-Identifier: MIT
//
// Patch src/helpers/settings.helpers.ts so the standalone dev shell accepts ?tenant=&token=&language= in the URL.
// Entry script: HELP + runMain over the shared libs in ./lib (node: imports only).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT, ScriptError, runMain } from './lib/cli.mjs';

const HELP = `Usage:
  node dev-settings-patch.mjs [project-dir]

Patches src/helpers/settings.helpers.ts so the standalone dev shell accepts
?tenant=&token=&language= in the URL (consumed once, persisted to localStorage,
removed from the address bar). dev-open.mjs relies on it.

Idempotent (marker: "emporix-md-extension: url-settings"). Exit 0 when patched or
already patched; exit 1 when the helper file has an unexpected shape, then add the
equivalent manually (see references/local-run.md).
`;

const options = { help: { type: 'boolean', short: 'h' } };

const MARKER = 'emporix-md-extension: url-settings';

const HELPER = [
  `// ${MARKER} — lets scripts/dev-open.mjs pre-fill`,
  '// the standalone shell via ?tenant=&token=&language= (read once, persisted,',
  '// then removed from the address bar).',
  'const applySettingsFromUrl = (): void => {',
  "  if (typeof window === 'undefined' || !window.location?.search) return",
  '  const params = new URLSearchParams(window.location.search)',
  "  const tenant = params.get('tenant')",
  "  const token = params.get('token')",
  "  const language = params.get('language')",
  '  if (tenant === null && token === null && language === null) return',
  '  saveStoredSettings({',
  "    tenant: tenant ?? localStorage.getItem(TENANT_KEY) ?? '',",
  "    language: language ?? localStorage.getItem(LANGUAGE_KEY) ?? 'en',",
  "    token: token ?? localStorage.getItem(TOKEN_KEY) ?? '',",
  '  })',
  "  params.delete('tenant')",
  "  params.delete('token')",
  "  params.delete('language')",
  '  const query = params.toString()',
  '  window.history.replaceState(',
  '    null,',
  "    '',",
  "    `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`",
  '  )',
  '}',
  '',
  '',
];

runMain({ help: HELP, options }, async ({ positionals }) => {
  const file = join(positionals[0] ?? '.', 'src', 'helpers', 'settings.helpers.ts');
  if (!existsSync(file)) throw new ScriptError(EXIT.FAILED, `Not found: ${file}`);
  const source = readFileSync(file, 'utf8');
  if (source.includes(MARKER)) {
    console.log(`Already patched: ${file}`);
    return;
  }
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const anchor = /export const getStoredSettings = \(\): AppState => \{\r?\n/;
  if (!anchor.test(source) || !/export const saveStoredSettings = /.test(source)) {
    throw new ScriptError(EXIT.FAILED, `${file} does not look like the template version; patch manually (see references/local-run.md).`);
  }
  const patched = source.replace(anchor, (m) => HELPER.join(eol) + m + `  applySettingsFromUrl()${eol}`);
  writeFileSync(file, patched);
  console.log(`Patched: ${file}`);
});
