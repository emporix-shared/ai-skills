#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// Validates each skill's `metadata.sources` drift index (see ADR-0001, the
// emporix-skill-authoring skill, and .scratch ticket 18/22): the committed,
// machine-readable list of diffable primary-source spec paths a skill's
// operative claims trace to. The drift checker matches platform changes
// against these paths, so they must stay well-formed.
//
// It also validates the optional anchor axis (drift-provider-version ticket
// 01): `metadata.anchor: <scheme>:<artifact-id>@<semver> <pinned|grounded>`
// and the drift-run stamp `metadata.anchor-checked: <semver> <YYYY-MM-DD>`.
// For a `pinned` anchor the version must also occur in the skill body (the
// reader is told to use it). It cannot tell how MANY occurrences there should
// be, so a partial bump still passes — the drift-check edit checklist covers
// that. Release existence needs the network: scripts/check-anchors.mjs.
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
// Also validates `metadata.guidelines`: a space-separated string of https URLs
// for skills grounded on external guidance pages rather than a spec (e.g. the
// skill-authoring best practices). The drift run re-reads those pages.
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

// A guideline entry: one absolute https URL, no whitespace.
const GUIDELINE_URL = /^https:\/\/[^\s/]+\.[^\s/]+\/\S*$/;

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

// Read a flat `  key: value` scalar from the metadata block (one indent level,
// like generate-catalog.mjs). Returns null when absent.
function metaScalar(raw, key) {
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  let inMeta = false;
  for (const line of m[1].split('\n')) {
    if (/^\s*#/.test(line) || !line.trim()) continue;
    if (/^metadata:\s*$/.test(line)) { inMeta = true; continue; }
    if (inMeta && /^\S/.test(line)) break;
    if (!inMeta) continue;
    const kv = line.match(new RegExp(`^\\s+${key}:\\s*(.*?)\\s*$`));
    if (kv) return kv[1];
  }
  return null;
}

const SEMVER = '\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?';
// Only `github:` has a release lookup today (scripts/check-anchors.mjs); the
// `npm:` / `registry:` schemes are reserved and rejected until implemented.
const ANCHOR = new RegExp(`^github:([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)@(${SEMVER}) (pinned|grounded)$`);
const ANCHOR_CHECKED = new RegExp(`^(${SEMVER}) (\\d{4}-\\d{2}-\\d{2})$`);

function checkAnchor(s, problems) {
  const anchor = metaScalar(s.raw, 'anchor');
  const checked = metaScalar(s.raw, 'anchor-checked');
  if (anchor === null) {
    if (checked !== null) problems.push(`${s.name}: anchor-checked without an anchor`);
    return 0;
  }
  const a = anchor.match(ANCHOR);
  if (!a) {
    problems.push(`${s.name}: malformed anchor "${anchor}" — expected github:<owner>/<repo>@<semver> <pinned|grounded>`);
    return 1;
  }
  const [, , version, relation] = a;
  if (checked !== null && !ANCHOR_CHECKED.test(checked)) {
    problems.push(`${s.name}: malformed anchor-checked "${checked}" — expected <semver> <YYYY-MM-DD>`);
  }
  if (relation === 'pinned') {
    const body = s.raw.replace(/^---\n[\s\S]*?\n---/, '');
    if (!body.includes(version)) {
      problems.push(`${s.name}: pinned anchor version ${version} does not occur in the skill body — the body tells readers a different version`);
    }
  }
  return 1;
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

// Extract metadata.guidelines as an array of URLs. The value is a single
// space-separated string (the spec allows only string metadata values).
// Absent `guidelines` is treated as an empty list.
function parseGuidelines(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return [];
  let inMeta = false;
  for (const line of m[1].split('\n')) {
    if (/^\s*#/.test(line) || !line.trim()) continue;
    if (/^metadata:\s*$/.test(line)) { inMeta = true; continue; }
    if (inMeta && /^\S/.test(line)) break;
    if (!inMeta) continue;
    const g = line.match(/^\s+guidelines:\s*(.*)$/);
    if (g) return g[1].trim().split(/\s+/).filter(Boolean);
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
let guidelines = 0;
let anchors = 0;
for (const s of skills) {
  anchors += checkAnchor(s, problems);
  const sources = parseSources(s.raw, s.source);
  for (const p of sources) {
    checked++;
    if (!SPEC_PATH.test(p)) {
      problems.push(`${s.name}: malformed source path "${p}" — expected <domain>/<service>/api-reference/api.yml`);
    }
  }
  for (const u of parseGuidelines(s.raw)) {
    guidelines++;
    if (!GUIDELINE_URL.test(u)) {
      problems.push(`${s.name}: malformed guideline "${u}" — expected an https:// URL`);
    }
  }
}

if (problems.length) {
  console.error('DRIFT INDEX INVALID:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(`metadata.sources OK (${checked} path(s), ${guidelines} guideline URL(s) across ${skills.length} skill(s)); ${anchors} anchor(s) well-formed`);
process.exit(0);
