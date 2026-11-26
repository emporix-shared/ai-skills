// @ts-check
// SPDX-License-Identifier: MIT
//
// On-disk contract for <project>/.ai/md-extension/{hosting,last-deploy}.json:
// parse and atomic (tmp + rename) write. Records never hold tokens.

import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT, ScriptError } from './cli.mjs';

/** @typedef {{tenant:string, profile:string|null, hostingId:string, siteId:string, defaultUrl:string|null,
 *   remoteEntryUrl:string|null, type:'extension'|'perspective', urlPath:string|null, createdAt:string}} HostingRecord  field names as in bash */

/** @typedef {{phase:'uploaded', tenant:string, profile:string|null, siteId:string, mediaId:string, zipSha256:string, at:string}
 *          | {phase:'triggered', tenant:string, profile:string|null, siteId:string, mediaId:string, buildId:string, zipSha256:string, at:string}} DeployRecord */

/** @param {string|undefined} project @param {string} name */
const recordFile = (project, name) => join(project ?? '.', '.ai', 'md-extension', `${name}.json`);

/**
 * @param {string} file
 * @returns {Record<string, any>|null} null when the file does not exist
 */
function readJsonRecord(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return null;
    throw new ScriptError(EXIT.FAILED, `Cannot read ${file}: ${/** @type {Error} */ (err).message}`);
  }
  try {
    const data = JSON.parse(text);
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  } catch { /* reported below */ }
  throw new ScriptError(EXIT.FAILED, `${file} is not a valid record (expected a JSON object). Fix or delete it.`);
}

/** @param {string} file @param {object} record */
function writeJsonRecord(file, record) {
  mkdirSync(join(file, '..'), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`);
    renameSync(tmp, file);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* tmp may not exist */ }
    throw err;
  }
}

/** @param {Record<string, any>} d @param {string} key @param {string} file @returns {string} */
function requireString(d, key, file) {
  if (typeof d[key] !== 'string' || !d[key]) throw new ScriptError(EXIT.FAILED, `${file} is missing "${key}". Fix or delete it.`);
  return d[key];
}

/** @param {unknown} v @returns {string|null} */
const optString = (v) => (typeof v === 'string' && v ? v : null);

/**
 * @param {string|undefined} project project dir (default cwd)
 * @returns {HostingRecord|null} null when absent
 */
export function readHostingRecord(project) {
  const file = recordFile(project, 'hosting');
  const d = readJsonRecord(file);
  if (d === null) return null;
  return {
    tenant: requireString(d, 'tenant', file),
    profile: optString(d.profile),
    hostingId: requireString(d, 'hostingId', file),
    siteId: requireString(d, 'siteId', file),
    defaultUrl: optString(d.defaultUrl),
    remoteEntryUrl: optString(d.remoteEntryUrl),
    type: d.type === 'perspective' ? 'perspective' : 'extension',
    urlPath: optString(d.urlPath),
    createdAt: optString(d.createdAt) ?? '',
  };
}

/**
 * @param {string|undefined} project
 * @param {HostingRecord} record
 * @returns {void}
 */
export function writeHostingRecord(project, record) {
  writeJsonRecord(recordFile(project, 'hosting'), record);
}

/**
 * @param {string|undefined} project
 * @returns {DeployRecord|null}
 */
export function readDeployRecord(project) {
  const file = recordFile(project, 'last-deploy');
  const d = readJsonRecord(file);
  if (d === null) return null;
  if (d.phase === undefined) {
    // written by an older (bash) version of this skill: nothing here can be reused safely
    process.stderr.write(`Ignoring ${file}: it was written by an older version of this skill.\n`);
    return null;
  }
  const base = {
    tenant: requireString(d, 'tenant', file),
    profile: optString(d.profile) ?? null,
    siteId: requireString(d, 'siteId', file),
    mediaId: requireString(d, 'mediaId', file),
    zipSha256: requireString(d, 'zipSha256', file),
    at: optString(d.at) ?? '',
  };
  switch (d.phase) {
    case 'uploaded':
      return { phase: 'uploaded', ...base };
    case 'triggered':
      return { phase: 'triggered', ...base, buildId: requireString(d, 'buildId', file) };
    default:
      throw new ScriptError(EXIT.FAILED, `${file} has an unknown phase. Fix or delete it.`);
  }
}

/**
 * @param {string|undefined} project
 * @param {DeployRecord} record
 * @returns {void}
 */
export function writeDeployRecord(project, record) {
  writeJsonRecord(recordFile(project, 'last-deploy'), record);
}
