#!/usr/bin/env node
// @ts-check
// SPDX-License-Identifier: MIT
//
// Scaffold a new Management Dashboard extension from emporix/md-module-template.
// Entry script: HELP + runMain over the shared libs in ./lib (node: imports only).

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT, ScriptError, runMain } from './lib/cli.mjs';
import { runTool } from './lib/platform.mjs';

const HELP = `Usage:
  node scaffold.mjs <kebab-name> [target-dir] [--display "Display Name"] [--skip-install]

  --display <name>   display name used in README and index.html title
  --skip-install     do not run npm install
  -h, --help         show this help

Clones the template (shallow, MD_TEMPLATE_REPO overrides), removes its .git history,
sets package.json name, README title and index.html title, keeps federation name
"extension" and remoteEntry.js, adds /.ai to .gitignore, creates .ai/md-extension/,
runs dev-settings-patch, git init + first commit, then npm install.
The last stdout line is the absolute project path.
`;

const options = { 'skip-install': { type: 'boolean' }, display: { type: 'string' }, help: { type: 'boolean', short: 'h' } };

const DEFAULT_TEMPLATE = 'https://github.com/emporix/md-module-template';

/** @param {string} s */
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** @param {string} label @param {{status:number, stderr:string}} r */
function must(label, r) {
  if (r.status !== 0) throw new ScriptError(EXIT.FAILED, `${label} failed (exit ${r.status})${r.stderr.trim() ? `:\n${r.stderr.trim()}` : ''}`);
}

runMain({ help: HELP, options }, async ({ values, positionals }) => {
  const [name, targetArg, extra] = positionals;
  if (!name) throw new ScriptError(EXIT.USAGE, 'Usage: node scaffold.mjs <kebab-name> [target-dir] [--display "Name"] [--skip-install]');
  if (extra !== undefined) throw new ScriptError(EXIT.USAGE, `Unexpected argument: ${extra}`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) throw new ScriptError(EXIT.USAGE, `Name must be kebab-case (lowercase letters, digits, hyphens): ${name}`);
  const target = resolve(targetArg ?? `./${name}`);
  const display = values.display ?? name.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  if (Number(process.versions.node.split('.')[0]) < 20) throw new ScriptError(EXIT.FAILED, `Node >= 20 is required (found ${process.version}).`);
  must('Checking for git (a required tool)', runTool('git', ['--version']));
  if (!values['skip-install']) must('Checking for npm (a required tool)', runTool('npm', ['--version']));
  if (existsSync(target) && readdirSync(target).length > 0) throw new ScriptError(EXIT.FAILED, `Target directory is not empty: ${target}`);

  const repo = process.env.MD_TEMPLATE_REPO || DEFAULT_TEMPLATE;
  const ref = process.env.MD_TEMPLATE_REF;
  console.log(`Cloning ${repo}${ref ? ` (ref ${ref})` : ''} into ${target}`);
  must('git clone', runTool('git', ['clone', '--quiet', '--depth', '1', ...(ref ? ['--branch', ref] : []), repo, target]));
  rmSync(join(target, '.git'), { recursive: true, force: true, maxRetries: 3 });

  const pkgFile = join(target, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
  pkg.name = name;
  pkg.version = '0.1.0';
  writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);

  const readme = join(target, 'README.md');
  if (existsSync(readme)) {
    const intro = `## Introduction\n\n\`${name}\` is an Emporix Management Dashboard extension (Module Federation remote built with Vite + React), scaffolded from [md-module-template](https://github.com/emporix/md-module-template).\n\n<!-- Describe what this extension does and which Emporix APIs it uses. -->\n`;
    const text = readFileSync(readme, 'utf8')
      .replace(/^# .*$/m, () => `# ${display}`)
      .replace(/^## Introduction\r?\n\r?\n[\s\S]*?(?=\r?\n## )/m, () => intro);
    writeFileSync(readme, text);
  }
  const indexHtml = join(target, 'index.html');
  if (existsSync(indexHtml)) {
    writeFileSync(indexHtml, readFileSync(indexHtml, 'utf8').replace(/<title>.*<\/title>/, () => `<title>${escapeHtml(display)}</title>`));
  }

  const gitignore = join(target, '.gitignore');
  const ignored = existsSync(gitignore) ? readFileSync(gitignore, 'utf8') : '';
  if (!ignored.split(/\r?\n/).some((l) => l.trim() === '/.ai')) {
    appendFileSync(gitignore, `${ignored && !ignored.endsWith('\n') ? '\n' : ''}\n# local agent artifacts\n/.ai\n`);
  }
  mkdirSync(join(target, '.ai', 'md-extension'), { recursive: true });

  if (!values['skip-install']) {
    console.log('Installing dependencies (this also syncs the shared AI rules)...');
    must('npm install', runTool('npm', ['install', '--no-audit', '--no-fund'], { cwd: target, inherit: true }));
    // The upstream template occasionally ships prettier drift; normalize so `npm run lint` starts green.
    runTool('npx', ['eslint', '.', '--fix'], { cwd: target });
  }

  // Let dev-open.mjs pre-fill tenant/token/language in the standalone shell.
  const patch = spawnSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'dev-settings-patch.mjs'), target], { encoding: 'utf8', windowsHide: true });
  if (patch.status !== 0) console.error(`${patch.stderr.trim()}\nThe URL-settings patch was not applied; see references/local-run.md.`);

  must('git init', runTool('git', ['init', '--quiet'], { cwd: target }));
  must('git add', runTool('git', ['add', '-A'], { cwd: target }));
  const configured = (/** @type {string} */ key, /** @type {string} */ fallback) => runTool('git', ['config', key], { cwd: target }).stdout.trim() || fallback;
  const author = process.env.GIT_AUTHOR_NAME || configured('user.name', 'scaffold');
  const email = process.env.GIT_AUTHOR_EMAIL || configured('user.email', 'scaffold@local');
  must('git commit', runTool('git', ['-c', `user.name=${author}`, '-c', `user.email=${email}`, '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', `chore: scaffold ${name} from md-module-template`], { cwd: target }));

  console.log(`\nScaffolded "${display}" (${name})`);
  console.log('  federation name : extension   (keep: hosting registers remoteEntry.js under this scope)');
  console.log('  dev             : npm run dev, then node <skill>/scripts/dev-open.mjs --tenant <alias>   (opens the browser pre-authenticated)');
  console.log('  checks          : npm run lint && npm run typecheck && npm run test:run');
  console.log('  build/preview   : npm run build && npm run preview   -> http://localhost:4173/assets/remoteEntry.js');
  console.log(target);
});
