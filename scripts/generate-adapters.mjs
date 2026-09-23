#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// Generates committed adapter files for tier-1 tools that do not consume
// SKILL.md natively (see docs/adr/0001, once migrated: SKILL.md is the only
// authored source of truth; adapters are generated, never hand-edited).
//
//   node scripts/generate-adapters.mjs          regenerate adapters in place
//   node scripts/generate-adapters.mjs --check  exit 1 if committed adapters
//                                               differ from what the sources
//                                               would generate (CI drift gate)
//
// Skill sources:  skills/*/SKILL.md and skills/community/*/SKILL.md
// Adapter targets (Claude Code reads SKILL.md natively — no adapter):
//   Cursor      .cursor/rules/<name>.mdc
//   Copilot     .github/instructions/<name>.instructions.md
//   Windsurf    .windsurf/rules/<name>.md
//   Codex       AGENTS.md              (index of skills, one section per skill)
//   JetBrains   .junie/guidelines.md   (same index shape as AGENTS.md)

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GENERATED_NOTE = (source) =>
  `<!-- GENERATED FILE - DO NOT EDIT. Source of truth: ${source}. Regenerate with: node scripts/generate-adapters.mjs -->`;

function findSkills() {
  const skills = [];
  const scan = (dir, namespace) => {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) return;
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (dir === 'skills' && (entry.name === 'community' || entry.name === 'templates')) continue;
      const skillPath = join(abs, entry.name, 'SKILL.md');
      if (!existsSync(skillPath)) continue;
      skills.push({ name: entry.name, namespace, source: relative(ROOT, skillPath), raw: readFileSync(skillPath, 'utf8') });
    }
  };
  scan('skills', 'official');
  scan('skills/community', 'community');
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

function parseFrontmatter(raw, source) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error(`${source}: missing YAML frontmatter`);
  const [, fm, body] = m;
  // Minimal parser: top-level `key: value` and `key: >-` folded blocks.
  const meta = {};
  const lines = fm.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*#/.test(line) || !line.trim()) continue;
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (!kv) continue;
    let [, key, value] = kv;
    if (value === '>-' || value === '>' || value === '|' || value === '|-') {
      const folded = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) folded.push(lines[++i].trim());
      value = folded.join(' ');
    }
    meta[key] = value;
  }
  if (!meta.name) throw new Error(`${source}: frontmatter missing "name"`);
  if (!meta.description) throw new Error(`${source}: frontmatter missing "description"`);
  return { meta, body: body.trimStart() };
}

function generate(skills) {
  const files = new Map(); // relative path -> content

  for (const skill of skills) {
    const { meta, body } = parseFrontmatter(skill.raw, skill.source);
    const note = GENERATED_NOTE(skill.source);

    // Cursor: .mdc rule, agent-requested via description.
    files.set(
      `.cursor/rules/${meta.name}.mdc`,
      `---\ndescription: ${JSON.stringify(meta.description)}\nalwaysApply: false\n---\n\n${note}\n\n${body}`,
    );

    // Copilot: instructions file, applied on demand.
    files.set(
      `.github/instructions/${meta.name}.instructions.md`,
      `---\napplyTo: "**"\ndescription: ${JSON.stringify(meta.description)}\n---\n\n${note}\n\n${body}`,
    );

    // Windsurf: plain markdown rule.
    files.set(`.windsurf/rules/${meta.name}.md`, `${note}\n\n${body}`);
  }

  // Codex (AGENTS.md) and JetBrains (.junie/guidelines.md): one index file
  // embedding every skill, sections in stable (sorted) order.
  const index = (title) => {
    const parts = [
      GENERATED_NOTE('skills/*/SKILL.md'),
      `# ${title}`,
      '',
      'Skills for building on the Emporix commerce platform. Each section below is one skill; apply a section when its "Use when" description matches the task.',
    ];
    for (const skill of skills) {
      const { meta, body } = parseFrontmatter(skill.raw, skill.source);
      parts.push('', '---', '', `## Skill: ${meta.name}`, '', `**Use when:** ${meta.description}`, '', body.trimEnd());
    }
    return parts.join('\n') + '\n';
  };
  files.set('AGENTS.md', index('Emporix AI Skills — agent skills'));
  files.set('.junie/guidelines.md', index('Emporix AI Skills — agent guidelines'));

  return files;
}

const check = process.argv.includes('--check');
const skills = findSkills();
if (skills.length === 0) {
  console.error('No skills found under skills/ — refusing to generate an empty adapter set.');
  process.exit(1);
}
const files = generate(skills);

let drift = 0;
for (const [rel, content] of files) {
  const abs = join(ROOT, rel);
  const current = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
  if (current === content) continue;
  if (check) {
    console.error(`DRIFT: ${rel} ${current === null ? '(missing)' : '(stale)'}`);
    drift++;
  } else {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    console.log(`wrote ${rel}`);
  }
}

// Remove orphaned adapters for deleted/renamed skills.
for (const dir of ['.cursor/rules', '.github/instructions', '.windsurf/rules']) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) continue;
  for (const entry of readdirSync(abs)) {
    const rel = `${dir}/${entry}`;
    if (files.has(rel)) continue;
    const content = readFileSync(join(abs, entry), 'utf8');
    if (!content.includes('GENERATED FILE - DO NOT EDIT')) continue; // hand-authored, leave alone
    if (check) {
      console.error(`DRIFT: ${rel} (orphaned)`);
      drift++;
    } else {
      rmSync(join(abs, entry));
      console.log(`removed ${rel}`);
    }
  }
}

if (check) {
  if (drift) {
    console.error(`\n${drift} adapter file(s) out of sync. Run: node scripts/generate-adapters.mjs`);
    process.exit(1);
  }
  console.log(`adapters in sync (${skills.length} skill(s), ${files.size} adapter file(s))`);
}
