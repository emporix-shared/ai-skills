#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// Generates the catalog table (the Skills index with validated badges) inside
// README.md from each skill's SKILL.md frontmatter. The `validated` badge is
// read from `metadata.validated` (spec-compliant location — see ADR-0001 and
// docs/adr, and the emporix-skill-authoring skill).
//
//   node scripts/generate-catalog.mjs          rewrite the catalog table in README.md
//   node scripts/generate-catalog.mjs --check   exit 1 if README's table is stale
//
// The table replaces everything between the marker lines:
//   <!-- catalog:start -->
//   <!-- catalog:end -->
//
// Catalog scope: official + community skills, EXCLUDING contribution
// infrastructure (emporix-skill-authoring is meta-tooling, not a catalog entry).

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const README = join(ROOT, 'README.md');
const START = '<!-- catalog:start -->';
const END = '<!-- catalog:end -->';

// Skills that are contribution infrastructure, not catalog entries.
const INFRASTRUCTURE = new Set(['emporix-skill-authoring', 'emporix-drift-check']);

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
  return skills.filter((s) => !INFRASTRUCTURE.has(s.name)).sort((a, b) => a.name.localeCompare(b.name));
}

// Frontmatter parser that also captures the nested `metadata:` block (the
// adapter generator only reads top-level keys, so this lives here).
function parseFrontmatter(raw, source) {
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!m) throw new Error(`${source}: missing YAML frontmatter`);
  const lines = m[1].split('\n');
  const meta = { metadata: {} };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const top = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!top) continue;
    let [, key, value] = top;
    if (['>-', '>', '|', '|-'].includes(value)) {
      const folded = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) folded.push(lines[++i].trim());
      value = folded.join(' ');
    }
    if (key === 'metadata') {
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) {
        const sub = lines[++i].match(/^\s+([A-Za-z][\w-]*):\s*(.*)$/);
        if (sub) meta.metadata[sub[1]] = sub[2];
      }
    } else {
      meta[key] = value;
    }
  }
  if (!meta.name) throw new Error(`${source}: frontmatter missing "name"`);
  if (!meta.description) throw new Error(`${source}: frontmatter missing "description"`);
  return meta;
}

// The "what it teaches" summary: the capability sentence before "Use when …",
// capped to keep the table column readable (word-boundary truncation).
const MAX = 140;
function teaches(description) {
  const d = description.trim();
  let head = d.split(/\.\s+Use when/i)[0];
  if (head === d) head = d.split(/(?<=\.)\s/)[0]; // fallback: first sentence
  head = head.replace(/\s+/g, ' ').replace(/[.;]+$/, '').trim();
  if (head.length > MAX) {
    const cut = head.slice(0, MAX);
    head = cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:—-]$/, '').trim() + ' …';
    return head;
  }
  return head + '.';
}

function badge(meta) {
  const v = meta.metadata?.validated;
  if (!v) return '⚠️ unvalidated';
  const date = (v.match(/\d{4}-\d{2}-\d{2}/) || [])[0];
  return date ? `✅ \`${date}\`` : '✅ validated';
}

const cell = (s) => s.replace(/\|/g, '\\|');

function buildTable(skills) {
  const rows = skills.map((s) => {
    const meta = parseFrontmatter(s.raw, s.source);
    const link = `[${meta.name}](${s.source})`;
    return `| ${link} | ${cell(teaches(meta.description))} | ${badge(meta)} |`;
  });
  return [
    START,
    '| Skill | What it teaches | Validated |',
    '| --- | --- | --- |',
    ...rows,
    END,
  ].join('\n');
}

const check = process.argv.includes('--check');
const skills = findSkills();
if (skills.length === 0) {
  console.error('No catalog skills found under skills/ — refusing to generate an empty catalog.');
  process.exit(1);
}

const readme = readFileSync(README, 'utf8');
const startIdx = readme.indexOf(START);
const endIdx = readme.indexOf(END);
if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
  console.error(`README.md is missing the catalog markers (${START} … ${END}).`);
  process.exit(1);
}

const table = buildTable(skills);
const next = readme.slice(0, startIdx) + table + readme.slice(endIdx + END.length);

if (next === readme) {
  if (check) console.log(`catalog in sync (${skills.length} skill(s))`);
  process.exit(0);
}

if (check) {
  console.error('DRIFT: README.md catalog table is stale. Run: node scripts/generate-catalog.mjs');
  process.exit(1);
}

writeFileSync(README, next);
console.log(`wrote README.md catalog table (${skills.length} skill(s))`);
