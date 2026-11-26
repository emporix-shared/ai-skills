#!/usr/bin/env node
// @ts-check
// SPDX-License-Identifier: MIT
//
// Query the Emporix documentation MCP server over plain HTTP (fallback when the emporixdocs MCP server is not configured).
// Entry script: HELP + runMain over the shared libs in ./lib (node: imports only).

import { EXIT, ScriptError, runMain } from './lib/cli.mjs';

const HELP = `Usage:
  node docs-query.mjs ask    "<question>" ["<goal>"]   synthesized answer + sources
  node docs-query.mjs search "<query>"                 ranked documentation hits
  node docs-query.mjs page   "<url-or-path>"           full markdown of one page

EMPORIX_DOCS_MCP_URL overrides the endpoint (default https://developer.emporix.io/~gitbook/mcp).
`;

const options = { help: { type: 'boolean', short: 'h' } };

const DEFAULT_URL = 'https://developer.emporix.io/~gitbook/mcp';
const DEFAULT_GOAL = 'Build an Emporix Management Dashboard extension';

/** @param {string} text @returns {any[]} JSON-RPC messages from a JSON or SSE body */
function messages(text) {
  try { return [JSON.parse(text)]; } catch { /* maybe SSE */ }
  return text.split(/\r?\n/).map((l) => l.replace(/^data:\s*/, '').trim()).filter((l) => l.startsWith('{'))
    .flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}

runMain({ help: HELP, options }, async ({ positionals }) => {
  const [mode, text, goal] = positionals;
  /** @type {{name:string, args:Record<string,string>}} */
  let call;
  switch (mode) {
    case 'ask':
      if (!text) throw new ScriptError(EXIT.USAGE, 'ask needs a question');
      call = { name: 'askQuestion', args: { question: text, goal: goal || DEFAULT_GOAL } };
      break;
    case 'search':
      if (!text) throw new ScriptError(EXIT.USAGE, 'search needs a query');
      call = { name: 'searchDocumentation', args: { query: text } };
      break;
    case 'page':
      if (!text) throw new ScriptError(EXIT.USAGE, 'page needs a url');
      call = { name: 'getPage', args: { url: text } };
      break;
    default:
      throw new ScriptError(EXIT.USAGE, `Expected ask, search or page${mode ? ` (got "${mode}")` : ''}\n\n${HELP}`);
  }
  const url = process.env.EMPORIX_DOCS_MCP_URL || DEFAULT_URL;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: call.name, arguments: call.args } }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    const e = /** @type {any} */ (err);
    throw new ScriptError(EXIT.FAILED, `Could not reach the docs MCP endpoint ${url} (${e?.cause?.code ?? e?.name ?? 'network error'}).`);
  }
  const body = await res.text();
  if (!res.ok) throw new ScriptError(EXIT.FAILED, `The docs MCP endpoint ${url} answered HTTP ${res.status}.`);
  const out = [];
  for (const msg of messages(body)) {
    if (msg?.error) throw new ScriptError(EXIT.FAILED, `MCP error: ${msg.error.message || JSON.stringify(msg.error)}`);
    for (const c of msg?.result?.content ?? []) if (c?.type === 'text' && typeof c.text === 'string') out.push(c.text);
  }
  if (!out.length) throw new ScriptError(EXIT.FAILED, `No content in the MCP response:\n${body.slice(0, 500)}`);
  for (const t of out) console.log(t);
});
