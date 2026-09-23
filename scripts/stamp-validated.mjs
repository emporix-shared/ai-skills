#!/usr/bin/env node
// Stamps the `metadata.validated` entry into a skill's SKILL.md frontmatter, in
// the canonical format the catalog badge reads. This is the mechanical half of
// gate c: the clean-context validation RUN produces the verdict (an agent, in CI
// or locally); a human confirms it; this script does the error-prone writing so
// nobody hand-edits YAML or forgets to regenerate the catalog.
//
// It deliberately does NOT decide whether a skill is validated — it only records
// a decision already made, and refuses to record one with no evidence.
//
// Usage:
//   node scripts/stamp-validated.mjs --skill <name> \
//     --evidence "clean-context run on tenant andidemo4, 3/3 Verify PASS, PR #2"
//   [--date YYYY-MM-DD]   (default: today, UTC)
//   [--agent claude-code] (default: claude-code — the reference validation agent)
//
// After stamping, run `node scripts/generate-catalog.mjs` to flip the README badge.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = process.env.SKILLS_DIR || join(ROOT, 'skills');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

function fail(msg) {
  console.error(`stamp-validated: ${msg}`);
  process.exit(1);
}

const skill = arg('skill');
const evidence = arg('evidence');
const agent = arg('agent') || 'claude-code';
const date = arg('date') || new Date().toISOString().slice(0, 10);

if (!skill) fail('--skill <name> is required');
// Evidence is mandatory: the badge is an attestation, not a boolean. A stamp with
// no evidence line is exactly the cargo-cult tick the gate exists to prevent.
if (!evidence || !evidence.trim()) fail('--evidence "<text>" is required and must be non-empty');
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(`--date must be YYYY-MM-DD, got "${date}"`);

// Resolve the skill dir: official (skills/<name>) or community (skills/community/<name>).
const candidates = [join(SKILLS, skill, 'SKILL.md'), join(SKILLS, 'community', skill, 'SKILL.md')];
const file = candidates.find(existsSync);
if (!file) fail(`no SKILL.md found for "${skill}" (looked in ${candidates.join(', ')})`);

const raw = readFileSync(file, 'utf8');
const lines = raw.split('\n');
if (lines[0] !== '---') fail(`${file}: no YAML frontmatter (expected first line "---")`);
const close = lines.indexOf('---', 1);
if (close === -1) fail(`${file}: unterminated frontmatter (no closing "---")`);

const value = `${date} ${agent} ${evidence.trim()}`;
const validatedLine = `  validated: ${value}`;

// Find the metadata: block and any existing validated: line inside the frontmatter.
let metaIdx = -1;
let validatedIdx = -1;
for (let i = 1; i < close; i++) {
  if (/^metadata:\s*$/.test(lines[i])) metaIdx = i;
  if (metaIdx !== -1 && i > metaIdx && /^  validated:\s/.test(lines[i])) validatedIdx = i;
  // stop scanning metadata children once we hit a non-indented top-level key
  if (metaIdx !== -1 && i > metaIdx && /^\S/.test(lines[i]) && lines[i].trim() !== '') break;
}

if (validatedIdx !== -1) {
  lines[validatedIdx] = validatedLine; // re-validation: replace in place
} else if (metaIdx !== -1) {
  lines.splice(metaIdx + 1, 0, validatedLine); // insert as first metadata child
} else {
  // No metadata block yet — add one just before the closing ---.
  lines.splice(close, 0, 'metadata:', validatedLine);
}

writeFileSync(file, lines.join('\n'));
console.log(`stamped ${file}`);
console.log(`  metadata.validated: ${value}`);
console.log('next: node scripts/generate-catalog.mjs   # flip the README badge to ✅');
