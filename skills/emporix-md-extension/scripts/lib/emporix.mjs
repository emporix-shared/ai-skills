// @ts-check
// SPDX-License-Identifier: MIT
//
// Emporix credentials and API access: tenant profiles file, Session (private
// token), read-only apiGet, Hosting preflight and the HostingGate that is the
// only route to a Hosting write. Decision owner for credentials, what counts
// as Hosting access, and which calls write.

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { inspect } from 'node:util';
import { EXIT, ScriptError } from './cli.mjs';
import { openFile, writePrivateFile } from './platform.mjs';

/** @typedef {{kind:'clientCredentials', clientId:string, clientSecret:string, scopes:string|null}
 *          | {kind:'staticToken', token:string}} AuthSource  client credentials win when both (= emporix-setup) */

/** @typedef {{readonly href:string, readonly safeHref:string}} SecretUrl  only safeHref is ever printed */

/** @typedef {{siteId:string, defaultUrl:string|null}} HostingSummary  lenient parse of the list; shape confirmed on a live tenant */

/** @typedef {{kind:'available', gate:HostingGate, hostings:HostingSummary[]|null}
 *          | {kind:'unavailable', status:401|403|404}
 *          | {kind:'failed', status:number|null, reason:string}} PreflightResult */

/** @typedef {{type:'extension'} | {type:'perspective', urlPath:`/${string}`, allowedGroups:string[]|null}} Registration */

const DEFAULT_API_URL = 'https://api.emporix.io';
const REQUEST_TIMEOUT_MS = 60_000;
const UPLOAD_TIMEOUT_MS = 300_000;

/** Profiles file path: EMPORIX_TENANTS_FILE, else ~/.emporix/tenants.json (HOME/USERPROFILE). */
export const PROFILES_FILE = process.env.EMPORIX_TENANTS_FILE
  || join(process.env.HOME || process.env.USERPROFILE || homedir(), '.emporix', 'tenants.json');

const PROFILES_TEMPLATE = {
  $comment: [
    'Emporix tenant profiles used by the emporix-* agent skills. Keep this file private (owner-only permissions).',
    "Each key under 'profiles' is an alias you will use in conversation (e.g. 'acme').",
    'tenant       : Emporix tenant name (required).',
    'apiUrl       : optional, defaults to https://api.emporix.io.',
    'clientId / clientSecret : API client credentials (preferred). A service token is minted per run.',
    'scopes       : optional space-separated scopes to request; leave empty to receive all scopes of the API client.',
    'token        : optional static Bearer token (e.g. Management Dashboard employee token) for profiles without an API client; expires quickly.',
    'description  : free text shown in listings.',
    'default      : alias used when no tenant is named.',
  ],
  default: 'my-tenant',
  profiles: {
    'my-tenant': { tenant: 'my-tenant', apiUrl: 'https://api.emporix.io', clientId: '', clientSecret: '', scopes: '', description: '' },
  },
};

/**
 * Create the profiles file from a template if missing.
 * @returns {string} the file path
 */
export function ensureProfilesFile() {
  if (!existsSync(PROFILES_FILE)) {
    mkdirSync(dirname(PROFILES_FILE), { recursive: true });
    writePrivateFile(PROFILES_FILE, `${JSON.stringify(PROFILES_TEMPLATE, null, 2)}\n`);
  }
  return PROFILES_FILE;
}

/** Secret values the cli scrubber replaces in any output (see cli.mjs). */
const SECRETS_KEY = Symbol.for('emporix-md-extension.secrets');

/** @param {string} value */
function registerSecret(value) {
  const g = /** @type {any} */ (globalThis);
  (g[SECRETS_KEY] ??= new Set()).add(value);
}

/** @param {string} url @returns {string} */
const trimSlash = (url) => url.replace(/\/+$/, '');

/** @param {string} text @returns {any} parsed JSON or null */
function parseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

/**
 * One HTTP call against a tenant API. Never throws on an HTTP status; network
 * errors name tenant and API URL only.
 * @param {Session} session
 * @param {string} method
 * @param {string} path
 * @param {{headers?: Record<string,string>, body?: string|FormData, timeoutMs?: number}} [init]
 * @returns {Promise<{status:number, body:any, text:string}>}
 */
async function request(session, method, path, init = {}) {
  let res;
  try {
    res = await fetch(`${session.apiUrl}${path}`, {
      method,
      headers: { Accept: '*/*', ...session.authHeaders(), ...init.headers },
      body: init.body,
      signal: AbortSignal.timeout(init.timeoutMs ?? REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const e = /** @type {any} */ (err);
    throw new ScriptError(EXIT.FAILED, `Could not reach ${session.apiUrl} for tenant ${session.tenant} (${e?.cause?.code ?? e?.name ?? 'network error'}).`);
  }
  const text = await res.text();
  return { status: res.status, body: parseJson(text), text };
}

/** @param {number} status */
const isOk = (status) => status >= 200 && status < 300;

/** @param {any} body @param {string[]} keys @returns {string|null} first non-empty string field */
function firstString(body, keys) {
  if (!body || typeof body !== 'object') return null;
  for (const k of keys) if (typeof body[k] === 'string' && body[k]) return body[k];
  return null;
}

/** @param {string|null} defaultUrl @returns {string|null} */
const remoteEntryOf = (defaultUrl) => (defaultUrl ? `${trimSlash(defaultUrl)}/assets/remoteEntry.js` : null);

/**
 * Module-private guard: only hostingPreflight can construct a HostingGate.
 */
const GATE_KEY = Symbol('HostingGate');

/**
 * An authenticated, preflight-passed capability to write to Hosting.
 */
export class HostingGate {
  /** @type {Session} */ #session;

  /**
   * @param {symbol} key must be the module-private GATE_KEY
   * @param {Session} session
   */
  constructor(key, session) {
    if (key !== GATE_KEY) throw new Error('HostingGate can only be obtained from hostingPreflight');
    this.#session = session;
  }

  /**
   * POST create a hosting site and register it.
   * @param {{id:string, name:string, nameDe:string|null, registration:Registration}} spec
   * @returns {Promise<{siteId:string, defaultUrl:string|null, remoteEntryUrl:string|null}>}
   */
  async createHosting(spec) {
    const names = { en: spec.name, ...(spec.nameDe ? { de: spec.nameDe } : {}) };
    const reg = spec.registration;
    let extensionRegistration;
    switch (reg.type) {
      case 'extension':
        extensionRegistration = { type: reg.type, names };
        break;
      case 'perspective':
        if (!reg.urlPath.startsWith('/')) throw new ScriptError(EXIT.USAGE, 'A perspective needs a urlPath starting with /');
        extensionRegistration = { type: reg.type, names, urlPath: reg.urlPath, allowedGroups: reg.allowedGroups };
        break;
    }
    const s = this.#session;
    const res = await request(s, 'POST', `/automation/${encodeURIComponent(s.tenant)}/projects/hostings`, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: spec.id, extensionRegistration }),
    });
    if (!isOk(res.status)) throw new ScriptError(EXIT.FAILED, `Creating hosting '${spec.id}' failed for tenant ${s.tenant}: HTTP ${res.status}.`);
    const name = firstString(res.body, ['name']);
    if (!name) throw new ScriptError(EXIT.FAILED, `The Hosting API response for tenant ${s.tenant} did not contain a hosting name.`);
    const defaultUrl = firstString(res.body, ['defaultUrl']);
    return { siteId: /** @type {string} */ (name.split('/').pop()), defaultUrl, remoteEntryUrl: remoteEntryOf(defaultUrl) };
  }

  /**
   * Upload a zip to the media service.
   * @param {Uint8Array} bytes
   * @param {string} filename
   * @returns {Promise<{mediaId:string}>}
   */
  async uploadMedia(bytes, filename) {
    const meta = { type: 'BLOB', access: 'PRIVATE', details: { filename, mimeType: 'application/zip' } };
    const form = new FormData();
    form.set('file', new Blob([bytes], { type: 'application/zip' }), filename);
    form.set('body', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
    const s = this.#session;
    const res = await request(s, 'POST', `/media/${encodeURIComponent(s.tenant)}/assets`, { body: form, timeoutMs: UPLOAD_TIMEOUT_MS });
    if (!isOk(res.status)) throw new ScriptError(EXIT.FAILED, `Uploading ${filename} to the media service failed for tenant ${s.tenant}: HTTP ${res.status}.`);
    const mediaId = firstString(res.body, ['id', 'mediaId']);
    if (!mediaId) throw new ScriptError(EXIT.FAILED, `The media upload response for tenant ${s.tenant} had no id.`);
    return { mediaId };
  }

  /**
   * Trigger a deployment (build + release).
   * @param {string} siteId
   * @param {string} mediaId
   * @returns {Promise<{buildId:string}>}
   */
  async triggerDeploy(siteId, mediaId) {
    const s = this.#session;
    const res = await request(s, 'POST', `/automation/${encodeURIComponent(s.tenant)}/projects/hostings/${encodeURIComponent(siteId)}/deploy/media`, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaId }),
    });
    if (!isOk(res.status)) throw new ScriptError(EXIT.FAILED, `Triggering the deployment on hosting ${siteId} failed for tenant ${s.tenant}: HTTP ${res.status}.`);
    const buildId = firstString(res.body, ['buildId', 'deploymentId', 'id']);
    if (!buildId) throw new ScriptError(EXIT.FAILED, `The deploy response for hosting ${siteId} had no buildId.`);
    return { buildId };
  }
}

/**
 * Authenticated tenant session. The token is private and never serialised.
 */
export class Session {
  /** @type {string} */ #token;

  /**
   * @param {{tenant:string, apiUrl:string, language:string|null, origin:{kind:'profile', alias:string}|{kind:'env'}, token:string}} init
   */
  constructor(init) {
    this.#token = init.token;
    registerSecret(init.token);
    /** @readonly @type {string} */ this.tenant = init.tenant;
    /** @readonly @type {string} */ this.apiUrl = init.apiUrl;
    /** @readonly @type {string|null} */ this.language = init.language;
    /** @readonly @type {{kind:'profile', alias:string}|{kind:'env'}} */ this.origin = init.origin;
  }

  /** @returns {Record<string, any>} tenant/apiUrl/language/origin with token '[redacted]' */
  toJSON() {
    return { tenant: this.tenant, apiUrl: this.apiUrl, language: this.language, origin: this.origin, token: '[redacted]' };
  }

  /** util.inspect.custom hook: same redaction as toJSON. @returns {string} */
  [Symbol.for('nodejs.util.inspect.custom')]() {
    return inspect(this.toJSON());
  }

  /** lib-internal: Authorization header set. @returns {Record<string,string>} */
  authHeaders() {
    return { Authorization: `Bearer ${this.#token}` };
  }

  /**
   * Build a URL carrying the token (for dev-open). Only safeHref may be printed.
   * @param {string} base
   * @param {Record<string,string>} [params]
   * @returns {SecretUrl}
   */
  urlWithToken(base, params = {}) {
    const build = (/** @type {string} */ token) => {
      const u = new URL(`${trimSlash(base)}/`);
      u.searchParams.set('tenant', this.tenant);
      u.searchParams.set('token', token);
      const language = params.language ?? this.language;
      if (language) u.searchParams.set('language', language);
      for (const [k, v] of Object.entries(params)) if (k !== 'language') u.searchParams.set(k, v);
      return u.toString();
    };
    const href = build(this.#token);
    const safeHref = build('REDACTED-PLACEHOLDER').replace('REDACTED-PLACEHOLDER', '[redacted]');
    const url = { safeHref };
    // href is non-enumerable and every string/inspect/JSON form is the safe one.
    Object.defineProperty(url, 'href', { value: href, enumerable: false });
    Object.defineProperty(url, 'toString', { value: () => safeHref, enumerable: false });
    Object.defineProperty(url, 'toJSON', { value: () => ({ safeHref }), enumerable: false });
    return /** @type {SecretUrl} */ (url);
  }
}

/** @param {string} file @returns {Record<string, any>|null} null when the file does not exist */
function readProfilesFile(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return null;
    throw new ScriptError(EXIT.FAILED, `Cannot read ${file}: ${/** @type {Error} */ (err).message}`);
  }
  let cfg;
  try {
    cfg = JSON.parse(text);
  } catch (err) {
    throw new ScriptError(EXIT.FAILED, `Invalid JSON in ${file}: ${/** @type {Error} */ (err).message}`);
  }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new ScriptError(EXIT.FAILED, `Invalid ${file}: expected a JSON object with a "profiles" map.`);
  return cfg;
}

/** @param {unknown} v @returns {string} */
const str = (v) => (typeof v === 'string' ? v : '');

/**
 * Exchange client credentials for a service token.
 * @param {string} tenant
 * @param {string} apiUrl
 * @param {Extract<AuthSource, {kind:'clientCredentials'}>} auth
 * @returns {Promise<string>}
 */
async function mintToken(tenant, apiUrl, auth) {
  registerSecret(auth.clientSecret);
  const form = new URLSearchParams({ grant_type: 'client_credentials', client_id: auth.clientId, client_secret: auth.clientSecret });
  if (auth.scopes) form.set('scope', auth.scopes);
  const where = `${apiUrl}/oauth/token for tenant ${tenant}`;
  let res;
  try {
    res = await fetch(`${apiUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const e = /** @type {any} */ (err);
    throw new ScriptError(EXIT.FAILED, `Could not reach ${where} (${e?.cause?.code ?? e?.name ?? 'network error'}).`);
  }
  const body = parseJson(await res.text());
  const token = isOk(res.status) ? firstString(body, ['access_token']) : null;
  if (!token) throw new ScriptError(EXIT.FAILED, `Could not obtain a service token from ${where} (HTTP ${res.status}); check clientId/clientSecret.`);
  return token;
}

/** @param {AuthSource} auth @param {string} tenant @param {string} apiUrl @returns {Promise<string>} */
async function tokenFor(auth, tenant, apiUrl) {
  switch (auth.kind) {
    case 'clientCredentials':
      return mintToken(tenant, apiUrl, auth);
    case 'staticToken':
      return auth.token;
  }
  throw new Error('Unhandled auth source');
}

/**
 * Requirement 9 (amended 2026-11-25): profile forms other Emporix tools accept but this skill does not —
 * a macOS Keychain reference (`keychain:<service>`) as a credential value, or `auth: "employee-token"`.
 * Reading the Keychain would need a macOS-only binary (ADR-0003), so these stop before any network call.
 * @param {string} alias
 * @param {Record<string, any>} p
 * @returns {void}
 */
function rejectUnsupportedProfile(alias, p) {
  if (str(p.auth) === 'employee-token') {
    throw new ScriptError(EXIT.USAGE, `Profile "${alias}" uses auth "employee-token", which this skill does not support. Use an API client (clientId + clientSecret) or a static "token" in ${PROFILES_FILE}. Nothing was sent.`);
  }
  for (const field of ['clientId', 'clientSecret', 'token']) {
    if (str(p[field]).startsWith('keychain:')) {
      throw new ScriptError(EXIT.USAGE, `Profile "${alias}": ${field} is a Keychain reference, which this skill does not read. Store the value itself in ${PROFILES_FILE} (keep the file private). Nothing was sent.`);
    }
  }
}

/**
 * Resolve tenant credentials into a Session.
 * @param {{alias: string|null}} opts
 * @returns {Promise<Session>}
 */
export async function resolveSession({ alias }) {
  const env = process.env;
  if (alias === null && env.EMPORIX_TENANT) {
    /** @type {AuthSource|null} */
    let auth = null;
    if (env.EMPORIX_CLIENT_ID && env.EMPORIX_CLIENT_SECRET) {
      auth = { kind: 'clientCredentials', clientId: env.EMPORIX_CLIENT_ID, clientSecret: env.EMPORIX_CLIENT_SECRET, scopes: env.EMPORIX_SCOPES || null };
    } else if (env.EMPORIX_TOKEN) {
      auth = { kind: 'staticToken', token: env.EMPORIX_TOKEN };
    }
    if (auth) {
      process.stderr.write(`Using Emporix credentials from the environment (EMPORIX_TENANT=${env.EMPORIX_TENANT}).\n`);
      const apiUrl = trimSlash(env.EMPORIX_API_URL || DEFAULT_API_URL);
      const token = await tokenFor(auth, env.EMPORIX_TENANT, apiUrl);
      return new Session({ tenant: env.EMPORIX_TENANT, apiUrl, language: null, origin: { kind: 'env' }, token });
    }
  }

  const cfg = readProfilesFile(PROFILES_FILE);
  if (cfg === null) {
    const file = ensureProfilesFile();
    try { await openFile(file); } catch { /* the message below names the file */ }
    throw new ScriptError(EXIT.FAILED, `No Emporix credentials found. Created a tenant profiles template at ${file} and opened it: fill in tenant, apiUrl and clientId/clientSecret (or token), save, then re-run.`);
  }
  const profiles = cfg.profiles && typeof cfg.profiles === 'object' ? cfg.profiles : {};
  const aliases = Object.keys(profiles);
  const has = (/** @type {string} */ a) => Object.hasOwn(profiles, a);
  const chosen = alias || env.EMPORIX_PROFILE
    || (typeof cfg.default === 'string' && has(cfg.default) ? cfg.default : '')
    || (aliases.length === 1 ? aliases[0] : '');
  if (!chosen) {
    throw aliases.length
      ? new ScriptError(EXIT.USAGE, `Several profiles and no default: pass --tenant <alias>. Available: ${aliases.join(', ')}`)
      : new ScriptError(EXIT.FAILED, `No profiles defined in ${PROFILES_FILE}.`);
  }
  if (!has(chosen)) throw new ScriptError(EXIT.USAGE, `Unknown profile "${chosen}". Available: ${aliases.join(', ') || '(none)'}`);
  const p = profiles[chosen] ?? {};
  const tenant = str(p.tenant);
  if (!tenant) throw new ScriptError(EXIT.FAILED, `Profile "${chosen}" has no tenant.`);
  rejectUnsupportedProfile(chosen, p);
  /** @type {AuthSource} */
  let auth;
  if (str(p.clientId) && str(p.clientSecret)) auth = { kind: 'clientCredentials', clientId: p.clientId, clientSecret: p.clientSecret, scopes: str(p.scopes) || null };
  else if (str(p.token)) auth = { kind: 'staticToken', token: p.token };
  else throw new ScriptError(EXIT.FAILED, `Profile "${chosen}" is incomplete: set clientId + clientSecret (or token) in ${PROFILES_FILE}.`);
  const apiUrl = trimSlash(str(p.apiUrl) || DEFAULT_API_URL);
  const token = await tokenFor(auth, tenant, apiUrl);
  return new Session({ tenant, apiUrl, language: str(p.language) || null, origin: { kind: 'profile', alias: chosen }, token });
}

/**
 * Read-only GET against the tenant API. No generic write helper exists.
 * @param {Session} session
 * @param {string} path
 * @returns {Promise<{status:number, body:any, text:string}>}
 */
export async function apiGet(session, path) {
  return request(session, 'GET', path);
}

/**
 * Lenient parse of the hosting list; null when the shape is not recognised.
 * @param {any} body
 * @returns {HostingSummary[]|null}
 */
function parseHostings(body) {
  const list = Array.isArray(body) ? body : [body?.hostings, body?.items, body?.sites].find(Array.isArray);
  if (!Array.isArray(list)) return null;
  /** @type {HostingSummary[]} */
  const out = [];
  for (const item of list) {
    const raw = typeof item === 'string' ? item : firstString(item, ['siteId', 'name', 'id']);
    const siteId = raw?.split('/').pop();
    if (!siteId) return null;
    out.push({ siteId, defaultUrl: firstString(item, ['defaultUrl']) });
  }
  return out;
}

/**
 * Read-only Hosting access probe; the sole producer of a HostingGate.
 * @param {Session} session
 * @returns {Promise<PreflightResult>}
 */
export async function hostingPreflight(session) {
  let res;
  try {
    res = await apiGet(session, `/automation/${encodeURIComponent(session.tenant)}/projects/hostings`);
  } catch (err) {
    return { kind: 'failed', status: null, reason: err instanceof Error ? err.message : 'Hosting preflight failed.' };
  }
  if (isOk(res.status)) {
    return { kind: 'available', gate: new HostingGate(GATE_KEY, session), hostings: parseHostings(res.body) };
  }
  if (res.status === 401 || res.status === 403 || res.status === 404) return { kind: 'unavailable', status: res.status };
  return { kind: 'failed', status: res.status, reason: `The Hosting preflight for tenant ${session.tenant} at ${session.apiUrl} returned HTTP ${res.status}.` };
}

/**
 * Text explaining the manual route when Hosting is unavailable to the tenant.
 * @param {string|undefined} project
 * @returns {string}
 */
export function manualRouteText(project) {
  const dir = project ?? '.';
  return [
    'Hosting is a separately enabled Emporix feature (or the API client lacks the hosting scopes): ask Emporix to enable it, or use the manual route:',
    `  1. Build in prod mode: cd ${dir} && npm run build   (.env.prod must point at https://api.emporix.io)`,
    '  2. Host the dist/ folder on any HTTPS host that allows CORS from https://admin.emporix.io.',
    '  3. Management Dashboard: Administration -> Extensions -> Add extension, module URL https://<your-host>/assets/remoteEntry.js',
    '     (perspective: Administration -> Perspectives, module name "extension").',
  ].join('\n');
}

/**
 * The error a script throws when the preflight did not grant Hosting access.
 * Owned here, next to the manual-route text, so lib/cli.mjs stays a leaf.
 * @param {Exclude<PreflightResult, {kind:'available'}>} pre
 * @param {string|undefined} project project dir, used in the manual-route text
 * @returns {ScriptError}
 */
export function preflightFailure(pre, project) {
  switch (pre.kind) {
    case 'unavailable':
      return new ScriptError(
        EXIT.HOSTING_UNAVAILABLE,
        `Hosting is not available for this tenant (the Hosting API answered HTTP ${pre.status}). Nothing was created or uploaded.\n`
          + (pre.status === 401 ? 'If this profile uses a static "token", a 401 usually means the token expired: replace it and re-run before asking Emporix.\n' : '')
          + manualRouteText(project),
      );
    case 'failed':
      return new ScriptError(EXIT.FAILED, `${pre.reason} Nothing was written.`);
  }
  throw new Error(`Unhandled preflight result: ${/** @type {any} */ (pre).kind}`);
}

/**
 * @typedef {{alias:string, tenant:string|null, apiUrl:string, auth:'client-credentials'|'token'|'incomplete',
 *   isDefault:boolean, description:string}} ProfileSummary   no secret fields by construction
 */

/**
 * Secret-free view of every profile in the profiles file — the single reader shared with resolveSession.
 * @returns {ProfileSummary[]}
 * @throws {ScriptError} FAILED when the file is missing or invalid
 */
export function listProfiles() {
  const cfg = readProfilesFile(PROFILES_FILE);
  if (cfg === null) throw new ScriptError(EXIT.FAILED, `No profiles file at ${PROFILES_FILE}. Run: node tenants.mjs init`);
  const profiles = cfg.profiles && typeof cfg.profiles === 'object' ? cfg.profiles : {};
  return Object.keys(profiles).map((alias) => {
    const p = profiles[alias] ?? {};
    return {
      alias,
      tenant: str(p.tenant) || null,
      apiUrl: trimSlash(str(p.apiUrl) || DEFAULT_API_URL),
      auth: str(p.clientId) && str(p.clientSecret) ? 'client-credentials' : str(p.token) ? 'token' : 'incomplete',
      isDefault: cfg.default === alias,
      description: str(p.description),
    };
  });
}
