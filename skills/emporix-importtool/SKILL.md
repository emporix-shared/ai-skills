---
name: emporix-importtool
description: >-
  Operate data imports with the Emporix Import Tool through its MCP server —
  queue CSV or XML files on a file-based stream, trigger FULL, DELTA, or dry
  runs, follow a run through the shared queue, reconcile its counters, read
  run errors and diagnostics, retry failed records, schedule recurring runs,
  and search what was imported. Use when an AI agent or MCP client loads an
  ERP, PIM, Celonis, CSV, or XML export into Emporix through an existing
  import job, or diagnoses an import that ended PARTIAL, FAILED, or ABORTED,
  a run stuck in QUEUED, a 409 on trigger or upload, counters that do not
  add up, NO_KEY or REJECTED_BY_SOURCE errors, or a file that was not picked
  up. Not for writing products, prices, or stock directly with the commerce
  APIs (emporix-product-data), designing custom entity types or mixins
  (emporix-extensibility), or token and scope problems in general
  (emporix-auth).
license: CC-BY-4.0
metadata:
  validated: 2026-11-24 claude-code clean-context MCP-only run on tenant rcottonstage (stage), Verify 8/8 (Opus + Haiku), beats previous version on evals 4 and 6, triggers 21/21, author-stamped, PR #35
  guidelines: https://developer.emporix.io/import-tool/mcp-and-ai-agents https://developer.emporix.io/agentic-commerce-intelligence/ai/mcp
  sources:
    - utilities/import-service/api-reference/api.yml
---

# Operating imports with the Import Tool MCP server

The Import Tool moves external master data into Emporix. An **import job**
groups **streams**; each stream reads one source dataset — a Celonis record,
an HTTP endpoint, or a file (CSV or XML) — maps it onto one Emporix target
type and upserts it idempotently. Jobs, connections, streams, and mappings
are *configured* in the Management Dashboard's Import Tool. This skill
*operates* them with the Import Tool MCP server: give a file stream its
files, start runs, follow them, read what went wrong, retry, and schedule.
The traps are mostly about state, not syntax: a run is asynchronous and
queued, a job never runs twice at once, a file is identified by its bytes,
and a run can be refused before it reads anything because of the job's own
configuration.

Every step below is an MCP tool call. Tool names are the server's own; your
client may prefix them (for example `mcp__emporix-importtool__trigger-import-run`).
A tool's arguments are ids, never names — resolve names once, then pass ids.

## Tenant prerequisites

- The **Import Tool MCP server** connected:
  `https://api.emporix.io/mcp/importtool/{tenant}/{mcp_token}/mcp`
  (streamable HTTP). The MCP token is the Base64 of `clientId:secret` of a
  custom API key carrying the MCP scope plus `importtool.import_trigger`
  (creating one is the `emporix-auth` skill's job). The server lists only
  the tools the key's scopes allow, and matches scopes literally:
  `importtool.import_manage` does **not** include `import_trigger`. If
  `list-import-jobs` or `trigger-import-run` is missing from your tool list,
  the key lacks `importtool.import_trigger`. Give the key
  `importtool.import_trigger` only: `import_manage` adds configuration tools
  (`update-import-stream`, mapping and connection tools) that operating an
  import never needs. Treat the URL as a credential.
- An **enabled import job** with at least one stream whose mappings have
  been **published** (a run executes the published mappings), set up in the
  Management Dashboard.
- For files: a **file-based stream** (`fileMode` set, on a File connection
  whose format is CSV or XML).
- For Verify: a `SNAPSHOT` file stream on a **CSV** File connection (Verify
  queues a CSV; an XML connection would parse it as XML and fail) that writes
  to a **dedicated test custom entity type**, and the columns that stream
  reads.

## Operate, don't reconfigure

`get-import-job` does not show a stream's source settings (charset,
delimiter, key field, records path, record cap), so a stream can look
unconfigured when it is not. Never "fix" a stream with
`update-import-stream`: its `source_dataset` **replaces** every stored
setting, so guessing it wipes the ones you could not see. If a file seems to
need different reading settings, queue it unchanged, run it, and let the
run's errors say what is wrong; report a settings change to the job owner,
who makes it in the Management Dashboard.

## Finding the ids

`list-import-jobs` lists the jobs (`id`, `name`, `enabled`).
`get-import-job` returns one job with its streams: `id`, `name`,
`targetType`, `mode`, `deltaField`, and `fileMode` on a file-based stream.
The order a run executes streams in comes from `get-stream-run-order`: a
stream always runs after the streams it depends on (`runsAfter`), and among
independent streams the job's stream order (`seq`) decides.

## Which run do I need?

| Goal | `trigger-import-run` arguments |
|---|---|
| Normal load: only what changed since the last run | `mode: DELTA` (the default) |
| Re-read everything, e.g. after the source was repaired | `mode: FULL` |
| Re-write records whose source did *not* change (fix target values) | `mode: FULL`, `force: true` — bypasses skip-if-unchanged for the records the run reads (for a file stream, see which files that is below) |
| Check mappings without writing anything | `dry_run: true`; `dry_run_mappings: draft` tries unpublished edits, `sample_size` (1–100) sizes the preview |
| Run only some streams | `stream_ids: [<id>, …]` — ids, never names; an empty list is refused |
| Re-run only what failed last time | `retry-failed-records` with the run id (not a new trigger) |

Always pass `origin` (up to 40 characters, e.g. `nightly-erp-agent`) so the
run history says who started the run. `DELTA` filters by each stream's
delta field from the last watermark; a stream without a delta field reads
everything either way. Unchanged records are skipped by content hash in
both modes, so a `FULL` run on clean data is mostly `skipped` — that is
success, not a problem.

## Run lifecycle — what each status means

`QUEUED → RUNNING → SUCCEEDED | PARTIAL | FAILED | CANCELLED | ABORTED`, with
`RESUMABLE` as a non-final detour.

- `trigger-import-run` returns the run **`QUEUED`**, not finished. Poll
  `get-import-run` (run plus one row per stream) every few seconds until
  the status is terminal. A queued run has no stream rows yet;
  `queueWaitingFor` says why it waits: `WORKER` (see `queuePosition`),
  `PREVIOUS_RUN` (this job's current run), or `TENANT_LIMIT` (the tenant's
  concurrent-import limit, from `get-import-limits`). Waiting for
  `TENANT_LIMIT` is normal, not a failure.
- **One job, one run at a time.** While the job has a run `QUEUED`,
  `RUNNING`, or `RESUMABLE`, another trigger is refused with **`409`**
  naming the run in the way. Treat it as "already running": follow that run
  instead of retrying in a loop. A scheduled firing is never refused; it
  waits behind the current run.
- `RESUMABLE` means the service restarted mid-run; it resumes on its own.
  Do not trigger again.
- `ABORTED` on the **run** means the service refused to start it because of
  the job's configuration (for example every stream it would run has no
  published mappings): nothing was read or written, and the trigger itself
  still succeeded, so only polling shows it. `ABORTED` on a **stream row**
  means only that stream was refused; the run ends `PARTIAL`. Read the
  `message` and fix the job in the Management Dashboard.
- `startedAt` is when the run was **requested**; `executionStartedAt` is
  when it began executing (empty while queued). Measure durations from the
  latter.
- `cancel-import-run` stops a queued run at once and an executing run after
  its current batch. `force: true` marks it cancelled immediately — use it
  only for a run that does not stop on its own (a `RESUMABLE` run included).
- The only `429` is a used-up monthly entity quota (`get-import-limits`);
  a dry run is still allowed then.

## Feeding a file-based stream

A file stream imports what is in **its queue**; nothing is read until a run
starts. Checklist:

```
- [ ] get-import-job        → the stream's id and fileMode (SNAPSHOT or INCREMENTAL)
- [ ] queue-stream-file     → file_name + content_text (UTF-8 CSV/XML text) or content_base64 (the file's raw bytes: .gz, .zip, any non-UTF-8 export — never re-encode it; the stream's charset decodes it)
- [ ] INCREMENTAL only: reorder-stream-files with every pending id, first-to-load first
- [ ] trigger-import-run    → poll get-import-run to a terminal status
- [ ] list-stream-files     → the file is in history as PROCESSED
```

- **A file is identified by its content (SHA-256), not its name.** Queuing
  bytes the stream already imported, or that are already waiting, is
  refused; a renamed copy is the same file. A file whose import ended
  `FAILED` goes back with `requeue-stream-file` once the cause is fixed (its
  id is in `list-stream-files` history; nothing is sent again). A corrected
  source file is new bytes and queues normally. A `PROCESSED` file is never
  queued again. On a `SNAPSHOT` stream a failed file also cannot be requeued
  once a newer file has arrived, since the older snapshot would overwrite
  newer data — queue a corrected current file instead.
- **`SNAPSHOT` vs `INCREMENTAL` decides what a run reads.** `SNAPSHOT`: each
  file is the whole picture, so a run reads only the most recently queued
  file and reports older pending ones as superseded; with nothing pending it
  re-reads its last imported file. `INCREMENTAL`: every pending file is read
  in queue order and a later file's values win on a shared key, so set the
  order when files arrive out of sequence. `reorder-stream-files` needs
  **every** pending id exactly once and is refused while a run is in flight.
  Neither mode deletes a record because it is missing from a file; that
  needs a delete marker or tombstone configured on the stream.
- **Re-applying data already imported** depends on `fileMode`. `force`
  changes what a run *writes*, not which files it *reads*. A `SNAPSHOT`
  stream with nothing pending re-reads its last file, so `mode: FULL,
  force: true` re-applies it. An `INCREMENTAL` stream reads each file once:
  with an empty queue it reads nothing, and a manual trigger whose file
  streams all have nothing to read is refused with `Nothing to import`.
  There, re-applying means queuing the data again as new bytes.
- **Queue changes wait for the run.** `remove-stream-file` (pending files
  only; it deletes the stored copy) and `requeue-stream-file` are refused
  while the job has a run queued or in flight. Queuing a file the stream has
  not seen is accepted any time and waits for the next run.
- **Too big?** `queue-stream-file` takes at most 9 MiB per request, so the
  file must be slightly smaller. A larger file belongs at an HTTPS URL set as
  the File connection's file URL in the Management Dashboard — do not split
  it.
- **XML goes through the same queue.** The connection's format decides how a
  file is read. An XML stream reads one record per element at its records
  path, so a file whose records sit under another element reads **zero
  records** — or fails with a `CONFIGURATION` message naming the path that
  would match. A file that is not well-formed XML ends `FAILED` with a
  message naming the line and column; queue a corrected file (new bytes)
  rather than requeueing the same bytes.
- `history` in `list-stream-files` holds `PROCESSED`, `FAILED`, and
  `IN_PROGRESS` files, newest first; `pending` is returned whole. Record-level
  failures do not mark a file `FAILED`; a `FAILED` file means the file
  itself could not be read or the run failed around it.

## Reading the result

The run's `counters` (from `get-import-run`) reconcile **exactly**:

`recordsRead = created + updated + skipped + unresolvedParents + deleted + failed + collapsed + embedded`

Sum all eight terms — a check that adds only created/updated/skipped/failed
reports missing records that are not missing. Each row under `streams`
carries only that stream's `status`, `recordsRead`, `failed`, `message`, and
any non-zero warning counters; for one stream's created/updated/skipped
split, run that stream on its own (`stream_ids`).

- `skipped`: unchanged since the last write (the normal case on a re-run),
  or read but not written because the licensed records-per-entity limit was
  reached (the stream is then `PARTIAL` and its `message` says so).
- `collapsed`: rows repeating a key already in the same batch; merged before
  the write, last row wins. `duplicateKeys` (outside the sum) counts repeats
  across the run: the feed is not unique on its key.
- `unresolvedParents` / `embedded`: composite child streams — lines whose
  parent was not found, and lines written inside their parent's record.
- A row with an empty key column fails with `NO_KEY` — the service never
  invents a key.

**Which run?** `list-import-runs` lists a job's runs, newest first; `origin`,
`status`, and `startedAt` tell them apart.

**Errors** — `get-import-run-errors` returns `naturalKey`, `streamId`,
`stage`, `errorCode`, `message`, a page at a time (`page` from 0, `limit` up
to 50). Read pages until `hasMore` is false before reporting what failed —
the first page is not the whole list. Act on `errorCode`:

| errorCode | Meaning | Next step |
|---|---|---|
| `VALIDATION` | Mapped record failed validation before any write | Fix source data or the mapping |
| `NO_KEY` | Key column empty | Fix the source rows, then load them as new input — not a retry |
| `REJECTED_BY_SOURCE` | The source refused this one row (a list longer than the stream allows, or an XML record over its column limit); the rest imported | Fix that row (`message` names column, count, and limit), then load it as new input — not a retry |
| `UPSERT` | The Emporix target rejected the write | Read `message` (often a schema type mismatch) |
| `CONFIGURATION` | Something to change in the job itself | `message` says what; fix in the Management Dashboard |
| `EXTERNAL_SYSTEM` | The source system answered with an error (e.g. 5xx) | Retry later; not an import bug |
| `STREAM_ERROR` | The stream failed as a whole | `message` has the detail |

**Diagnostics** — when a stream row shows `duplicateKeys`,
`unresolvedParents`, or `deltaRegressions`, `get-import-run-diagnostics`
lists the rows behind them: which keys repeated, which parents were missing
(with `waitingLines`), which rows' delta value went backwards. Narrow with
`stream_id` and `kind` (`REPEATED_KEY`, `UNRESOLVED_PARENT`,
`DELTA_REGRESSION`); `limit` defaults to 100 (max 500). The service keeps a
sample per stream and kind — `sampleTruncated` says when there were more.

**Retry** — `retry-failed-records` queues a run that re-reads only the
failed records' keys from the **same input** (for a file stream: the exact
bytes the failed run read). So it fixes failures whose input was fine: a
write the target rejected (`UPSERT`) once the target type or mapping is
fixed, or a transient `EXTERNAL_SYSTEM` error. A **source-row** error
(`NO_KEY`, `REJECTED_BY_SOURCE`, or `VALIDATION` caused by the data) fails
again on retry — and a `NO_KEY` row has no key to retry by. Load corrected
rows as new input instead: for a file stream, queue the corrected file (new
bytes, so it is accepted) and trigger a run — unchanged rows are skipped by
hash, so only the fixed ones are written. Retry is refused when the job is
busy, the run has nothing retryable, the stream's source cannot fetch
records by key (an HTTP source), or a file it read has been removed or
replaced; use a new trigger then.

**What was imported** — `search-imported-data` with `stream_id` (or
`target_type` across streams; one of the two is required), optional
`outcome` (`UPSERTED`, `DELETED`, …) and `page`. Records carry `naturalKey`
(`<keyName>:<value>`, e.g. `sku:A-100`), `outcome`, `targetId`, and
`importedAt`. `search` matches the **beginning** of the natural key — with
its key name (`sku:A-1`) or as the value alone (`A-1`) — case-sensitively:
search `A-1`, not `-100` or `a-1`. It also matches the beginning of the
lower-case Emporix id. It is not a full-text search.

## Scheduling

`set-import-schedule` with `cron: "0 0 2 * * *"`, `timezone: "Europe/Berlin"`
— six-field (Spring) cron, seconds first, so hourly is `0 0 * * * *`.
Scheduled runs are `DELTA`. `enabled: false` pauses it and keeps the
expression; `delete-import-schedule` removes it; `get-import-schedule` shows
the next firing. Prefer the schedule over an agent triggering on a timer: a
scheduled firing queues behind a running run instead of being refused.

## Verify

Run against the test file stream, with `origin: skill-verify`. Use a CSV
with the stream's columns, three rows whose key values are `VERIFY-1`,
`VERIFY-2`, `VERIFY-3`, and one extra column `verifyRun` holding the actual
current time to the second (read the clock; do not make one up) — unmapped, so it never changes the records, but it makes each
Verify file new bytes. Report PASS / FAIL / BLOCKED per check with the raw
tool output.

1. **Server and stream.** `list-import-jobs` lists the test job;
   `get-import-job` shows the test stream with `fileMode: SNAPSHOT`
   (`INCREMENTAL` → BLOCKED: check 5 relies on a snapshot re-reading its
   last file). Missing tools mean the key lacks `importtool.import_trigger`;
   an unauthorized error means the MCP token or tenant is wrong.
2. **File queued.** `queue-stream-file` with the CSV as `content_text` →
   the file `PENDING`; `list-stream-files` shows it as the only `pending`
   entry.
3. **Same bytes refused (negative).** `queue-stream-file` with the identical
   content again → refused as already waiting; `pending` still has one entry.
4. **Run completes.** `trigger-import-run` with `mode: FULL`,
   `stream_ids: [<test stream>]`, `origin: skill-verify` → `QUEUED`;
   `get-import-run` reaches `SUCCEEDED` with `origin: skill-verify`; the run's
   eight counter terms sum to `recordsRead: 3` with `failed: 0` and
   `created + updated + skipped = 3` (`created: 3` the first time Verify runs
   on the tenant; afterwards `updated` or `skipped`, depending on whether the
   other columns changed), and the stream row shows `recordsRead: 3`,
   `failed: 0`.
5. **Imported bytes refused, snapshot re-read (negative).** After check 4's
   run, `queue-stream-file` with the same content → refused as already
   imported; `list-stream-files` shows `pending` empty. Then
   `trigger-import-run` (same arguments) → `QUEUED` → `SUCCEEDED`: with
   nothing pending, the snapshot re-reads its last file, so the run's
   counters show `recordsRead: 3`, `skipped: 3`.
6. **File consumed, no errors.** `list-stream-files` shows the file in
   `history` as `PROCESSED` and `pending` empty; `get-import-run-errors` on
   check 4's run → `totalElements: 0`; `get-import-run-diagnostics` on it →
   no rows.
7. **Records searchable by prefix.** `search-imported-data` with the test
   `stream_id`: `search: VERIFY-` → 3 records, `outcome: UPSERTED`;
   `VERIFY-2` → 1; `ERIFY` → 0.
8. **Tenant left as found.** `list-stream-files` has nothing pending (remove
   any leftover with `remove-stream-file`). The three `VERIFY-` instances
   stay in the dedicated test type by design: every Verify run writes the
   same three keys, so a re-run changes nothing — `search-imported-data`
   still returns exactly 3 for `VERIFY-`.
