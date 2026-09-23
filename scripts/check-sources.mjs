#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// Validates each skill's `metadata.sources` drift index (see ADR-0001, the
// emporix-skill-authoring skill, and .scratch ticket 18/22): the committed,
// machine-readable list of diffable primary-source spec paths a skill's
// operative claims trace to. The drift checker matches platform changes
// against these paths, so they must stay well-formed.
//
//   node scripts/check-sources.mjs           validate all skills
//   node scripts/check-sources.mjs --check   same; the flag CI passes for parity
//
// This is a STRUCTURAL check only — it asserts each entry looks like an
// `api-references` spec path and is hermetic (no api-references clone needed).
// It deliberately CANNOT catch a well-formed-but-nonexistent path (a typo'd
// service name): real existence is caught where the clone lives — the
// authoring self-run and the drift run — not in CI.
//
// Skill sources: skills/*/SKILL.md and skills/community/*/SKILL.md.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// A spec path under api-references: <domain>/<service>/<...>api-reference/api.yml.
// The `[a-z0-9-]*api-reference` allowance accepts service-specific variants
// (e.g. approval-service's `approval-api-reference/`) while still rejecting a
// wrong extension (`api.yaml`), a missing api-reference segment, or junk.
const SPEC_PATH = /^[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]*api-reference\/api\.yml$/;

function findSkills() {
  const skills = [];
  const scan = (dir) => {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) return;
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (dir === 'skills' && (entry.name === 'community' || entry.name === 'templates')) continue;
      const skillPath = join(abs, entry.name, 'SKILL.md');
      if (!existsSync(skillPath)) continue;
      skills.push({ name: entry.name, source: relative(ROOT, skillPath), raw: readFileSync(skillPath, 'utf8') });
    }
  };
  scan('skills');
  scan('skills/community');
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

// Extract metadata.sources as an array of strings. Handles the two YAML shapes
// the template documents: an inline `sources: []` and a block list of
// `    - <path>` items. Absent `sources` is treated as an empty list.
function parseSources(raw, source) {
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!m) throw new Error(`${source}: missing YAML frontmatter`);
  const lines = m[1].split('\n');
  let inMeta = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*#/.test(line) || !line.trim()) continue;
    if (/^metadata:\s*$/.test(line)) { inMeta = true; continue; }
    if (inMeta && /^\S/.test(line)) break; // dedent out of metadata block
    if (!inMeta) continue;
    const sub = line.match(/^(\s+)sources:\s*(.*)$/);
    if (!sub) continue;
    const [, indent, inline] = sub;
    if (inline.trim() === '[]') return [];
    if (inline.trim()) return [inline.trim()]; // rare inline scalar
    const items = [];
    while (i + 1 < lines.length) {
      const next = lines[i + 1];
      if (/^\s*#/.test(next) || !next.trim()) { i++; continue; }
      const item = next.match(/^\s+-\s+(.+?)\s*$/);
      // Stop at a line indented no deeper than `sources:` (a sibling key).
      if (!item || next.search(/\S/) <= indent.length) break;
      items.push(item[1]);
      i++;
    }
    return items;
  }
  return [];
}

const skills = findSkills();
if (skills.length === 0) {
  console.error('No skills found under skills/ — refusing to validate an empty catalog.');
  process.exit(1);
}

const problems = [];
let checked = 0;
for (const s of skills) {
  const sources = parseSources(s.raw, s.source);
  for (const p of sources) {
    checked++;
    if (!SPEC_PATH.test(p)) {
      problems.push(`${s.name}: malformed source path "${p}" — expected <domain>/<service>/api-reference/api.yml`);
    }
  }
}

if (problems.length) {
  console.error('DRIFT INDEX INVALID:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(`metadata.sources OK (${checked} path(s) across ${skills.length} skill(s))`);
process.exit(0);
