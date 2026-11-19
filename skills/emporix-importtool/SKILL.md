---
name: emporix-importtool
description: >-
  Operate data imports with the Emporix Import Service (the Import Tool) over
  its API — feed CSV files to a file-based stream, trigger FULL, DELTA, or dry
  runs, follow a run through the shared queue, reconcile its counters, read
  run errors and diagnostics, retry failed records, schedule recurring runs,
  and search what was imported. Use when loading an ERP, PIM, Celonis, or CSV
  export into Emporix through an existing import job, automating an import
  from a pipeline or Celonis Action Flow, or diagnosing an import that ended
  PARTIAL, FAILED, or ABORTED, a run stuck in QUEUED, a 409 on trigger or
  upload, counters that do not add up, NO_KEY or REJECTED_BY_SOURCE errors,
  or a file that was not picked up. Not for writing products, prices, or
  stock directly with the commerce APIs (emporix-product-data), designing
  custom entity types or mixins (emporix-extensibility), or token and scope
  problems in general (emporix-auth).
license: CC-BY-4.0
metadata:
  validated: 2026-11-19 claude-code clean-context run on tenant rcottondev (develop), Verify 8/8 (Opus + Haiku), evals 4/4 with skill, author-stamped, PR #30
  sources:
    - utilities/import-service/api-reference/api.yml
---

# Operating imports with the Emporix Import Service

The Import Service moves external master data into Emporix. An **import job**
(the API calls it a *configuration*, `configId`) groups **streams**; each
stream reads one source dataset — a Celonis record, an HTTP endpoint, or a
delimited file — maps it onto one Emporix target type and upserts it
idempotently. You *configure* jobs, connections, streams, and mappings in the
Management Dashboard's Import Tool (scope `importtool.import_manage`); you
*operate* them over the API with `importtool.import_trigger`: give a file
stream its files, start runs, watch them, read what went wrong, retry, and
schedule. This skill is the operating side. The traps are mostly about state,
not syntax: a run is asynchronous and queued, a job never runs twice at once,
a file is identified by its bytes, and a run can be refused before it reads
anything because of the job's own configuration.

Base URL: `https://api.emporix.io/importtool/{tenant}/…` — the path segment is
`importtool`, not `import-service`, and the tenant is lowercase. Every call is
`Authorization: Bearer {token}`. Every operation in this skill needs
`importtool.import_trigger`; the spec's `security` block on each operation is
the authority for scopes — never guess one.

## Finding the ids

Every call below takes ids, never names. `GET /configs` lists the import jobs
(`id`, `name`, `enabled`); `GET /configs/{configId}/streams` lists a job's
streams by `seq` (`id`, `name`, `targetType`, and `fileMode` on a file-based
stream). Resolve the job and stream by name once, then use the ids. `seq` is
not the order a run executes them in — dependencies decide that; read it from
`GET /configs/{configId}/stream-order` when it matters.

## Tenant prerequisites

- A service token carrying `importtool.import_trigger` (obtaining one is the
  `emporix-auth` skill's job).
- An **enabled import job** with at least one stream, set up in the
  Management Dashboard (Import Tool), whose mappings have been **published**
  — a run executes the published mappings. A stream whose mappings were never
  published is not run (that stream's row is `ABORTED`, the run `PARTIAL`);
  the whole run is `ABORTED` only when every enabled stream, or a stream named
  in `streamIds`, is in that state.
- For the file workflow: a **file-based stream** (`fileMode` set,
  delimited/CSV connection). For Verify, that stream must be `SNAPSHOT` and
  write to a **test custom entity type** you are
  free to fill and empty, with `schema.custominstance_manage` to delete its
  instances afterwards and `schema.custominstance_read` to confirm they are
  gone — manage does not include read: a manage-only token gets `403` on the
  read-back (`emporix-extensibility` covers that API).
- Runtime: outbound HTTPS and `curl` (or any HTTP client that can send
  `multipart/form-data`).

## Which run do I need?

| Goal | Request body for `POST /configs/{configId}/runs` |
|---|---|
| Normal scheduled-style load: only what changed since the last run | `{"mode":"DELTA"}` (the default) |
| Re-read everything, e.g. after the source was repaired | `{"mode":"FULL"}` |
| Re-write records whose source did *not* change (fix target values) | `{"mode":"FULL","force":true}` — bypasses skip-if-unchanged for the records the run reads (a file stream: see below for which files that is) |
| Check mappings without writing anything | `{"dryRun":true}`; add `"mappings":"draft"` to try unpublished edits, `"sampleSize":1..100` for the preview |
| Run only some streams | `"streamIds":["<id>",…]` — ids, never names; `[]` is refused |
| Re-run only what failed last time | `POST /runs/{runId}/retry` (not a new trigger) |

`DELTA` filters by each stream's delta field from the last watermark; a
stream without a delta field reads everything either way. Unchanged records
are skipped by content hash in both modes, so a `FULL` run on clean data is
mostly `skipped` — that is success, not a problem. Pass `"origin":"<your
integration>"` so the run history says who started it.

## Run lifecycle — what each status means

`QUEUED → RUNNING → SUCCEEDED | PARTIAL | FAILED | CANCELLED | ABORTED`, with
`RESUMABLE` as a non-final detour.

- The trigger returns **200 with `status: QUEUED`**, not a finished run. Poll
  `GET /runs/{runId}` (it returns `{run, streams}`) until the status is
  terminal. A queued run has no per-stream rows yet; `run.queueWaitingFor`
  says why it waits: `WORKER` (see `queuePosition`), `PREVIOUS_RUN` (this job's
  current run), or `TENANT_LIMIT` (the tenant's `maxConcurrentImports`, read
  from `GET /license`). Waiting for `TENANT_LIMIT` is normal; it is not a
  failure and no `429` is returned.
- **One job, one run at a time.** While the job has a run `QUEUED`, `RUNNING`,
  or `RESUMABLE`, another trigger returns **`409`**, whose `details` name the
  run in the way (`field: activeRunId`) — treat it as "already running", not
  as an error: follow that run instead of retrying in a tight loop. A scheduled
  firing is never refused: it waits behind the current run, and folds into a
  queued run only when that run is a real run of the whole job
  (`supersededRequests` counts the folds). Behind a queued dry run,
  selected-streams run, or retry it waits until that run starts and is then
  queued behind it.
- `RESUMABLE` means the service restarted mid-run; it resumes from its
  checkpoint on its own. Do not trigger again.
- `ABORTED` on the **run** means the service refused to start it because of
  the job's configuration (for example every enabled stream, or a stream named
  in `streamIds`, has no published mappings): nothing was read or written. The
  trigger still answered `200`, so only the polled run shows this; its
  `message` names the streams. `ABORTED` on a **stream row** means only that
  stream was refused, and the run, if others ran, ends `PARTIAL` — read the
  row's `message`. Either way, fix the job in the Management Dashboard.
- `startedAt` is when the run was **requested**; `executionStartedAt` is when
  it began executing (`null` while queued). Measure durations from the latter.
- Cancel with `POST /runs/{runId}/cancel`: a queued run is cancelled at once;
  an executing run stops after its current batch; `?force=true` stops it
  immediately and is the only way to stop a `RESUMABLE` run (without it:
  `409`). The answer is `202` with `accepted: true|false`.
- For live progress use `GET /runs/{runId}/events` (SSE: `snapshot`, one
  `stream` event per batch, a final `run` event). Polling every few seconds is
  enough for automation.

## Feeding a file-based stream

A file stream imports what is in **its queue**; nothing is read until a run
starts. Checklist:

```
- [ ] GET /streams/{streamId}            → note fileMode (SNAPSHOT or INCREMENTAL)
- [ ] GET /streams/{streamId}/files/limits → uploadSupported, maxUploadBytes
- [ ] POST /streams/{streamId}/files     (multipart, part name "file") → save file id
- [ ] INCREMENTAL only: PUT /streams/{streamId}/files/order with every pending id, in load order
- [ ] POST /configs/{configId}/runs      → poll GET /runs/{runId} to a terminal status
- [ ] GET /streams/{streamId}/files       → the file is in history as PROCESSED
```

```bash
curl -s -X POST "https://api.emporix.io/importtool/$TENANT/streams/$STREAM_ID/files" \
  -H "Authorization: Bearer $TOKEN" -F "file=@./vendors-2026-11-03.csv"
```

- **A file is identified by its content (SHA-256), not its name.** Re-sending
  bytes the stream already imported, or that are already queued, returns
  `409`; a renamed copy is still the same file. A file whose import ended
  `FAILED` can be put back once the cause is fixed with
  `POST /streams/{streamId}/files/{fileId}/requeue` (no re-upload; a corrected
  source file is new bytes and uploads normally). A `PROCESSED` file is never
  queued again. On a `SNAPSHOT` stream a failed file also cannot be requeued
  once a newer file has arrived (imported, waiting, or being read) — `409`,
  since the older snapshot would overwrite newer data; upload a corrected
  current file instead.
- **Re-applying data that was already imported** (after a mapping change, or
  to overwrite target values) depends on `fileMode`. `force` changes what a run
  *writes*, not which files it *reads*. A `SNAPSHOT` stream with nothing
  pending re-reads its last imported file, so `{"mode":"FULL","force":true}`
  re-applies it. An `INCREMENTAL` stream reads each file once: with an empty
  queue it reads nothing, and a manual trigger whose file streams all have
  nothing to read is refused with a message starting `Nothing to import`. For
  an incremental stream, re-applying means uploading the data again as new
  bytes (for example only the rows to rewrite).
- **`SNAPSHOT` vs `INCREMENTAL` decides what a run reads.** `SNAPSHOT`: each
  file is the whole picture, so a run reads only the most recently queued file
  and reports older pending ones as superseded. `INCREMENTAL`: every pending
  file is read in queue order and a later file's values win on a shared key —
  so set the order explicitly when files arrive out of sequence. The order
  `PUT` must list **exactly** the pending ids (not a subset), and is refused
  while a run is in flight or while the listing says `pendingTruncated: true`.
  Neither mode deletes a record because it is missing from a file; deletion
  needs a delete marker column or tombstone configured on the stream.
- **Queue changes wait for the run.** Removing a pending file
  (`DELETE /streams/{streamId}/files/{fileId}`) or replacing stored bytes is
  refused with `409` while the job has a run in flight; uploading a file the
  stream has not seen is accepted at any time and waits for the next run.
- **Too big?** `413` means the file exceeds `maxUploadBytes` (behind the
  gateway this is the gateway's limit). The way around it is a connection that
  fetches the file from an HTTPS URL, configured in the Management Dashboard —
  not splitting the file.
- `uploadSupported: false` (or `503` on upload) means file storage is not
  configured in that environment; uploading cannot work there.
- `history` holds `PROCESSED`, `FAILED`, and `IN_PROGRESS` files, newest first
  (`historyLimit` sizes it; `pending` is always returned whole). Record-level
  failures do not mark a file `FAILED`; a `FAILED` file means the file itself
  could not be read or the run failed around it.

## Reading the result

The counters on the run and on each stream row reconcile **exactly**:

`recordsRead = created + updated + skipped + unresolvedParents + deleted + failed + collapsed + embedded`

Sum all eight terms — a check that adds only created/updated/skipped/failed
will report missing records that are not missing.

- `skipped`: unchanged since the last write (the normal case on a re-run), or
  read but not written because the licensed `maxRecordsPerEntity` was reached
  (then the stream row has `capSkipped: true` and the stream is `PARTIAL`).
- `collapsed`: rows repeating a key already in the same batch; merged before
  the write, last row wins. `duplicateKeys` (outside the sum) counts repeats
  across the run — the feed is not unique on its key, and the last row won.
- `unresolvedParents` / `embedded`: composite child streams — lines whose
  parent was not found, and lines written inside their parent's record.
- A stream row with `sweep: true` is a repair pass of the same stream; do not
  count it as an extra stream.
- `keylessSeen: true` means rows with an empty key column; each fails with
  `NO_KEY` — the service never invents a key.

**Which run?** A run id you did not keep from the trigger comes from the
job's history: `GET /configs/{configId}/runs?page=0&size=20` lists its runs,
most recent first (`origin`, `status`, `startedAt` tell them apart).

**Errors** — `GET /runs/{runId}/errors?page=0&size=50` gives `naturalKey`,
`streamId`, `stage`, `errorCode`, `message`. It is paginated: read every page
(up to `totalPages`) before reporting what failed — the first page is not the
whole list. Act on `errorCode`:

| errorCode | Meaning | Next step |
|---|---|---|
| `VALIDATION` | Mapped record failed validation before any write | Fix source data or the mapping |
| `NO_KEY` | Key column empty | Fix the source rows, then load them as new input — not a retry |
| `REJECTED_BY_SOURCE` | The source refused this one row (e.g. a CSV list longer than the stream allows); the rest imported | Fix that row (`message` names column, count, and limit), then load it as new input — not a retry |
| `UPSERT` | The Emporix target rejected the write | Read `message` (often a schema type mismatch) |
| `CONFIGURATION` | Something to change in the job itself | `message` says what; fix in the Management Dashboard |
| `EXTERNAL_SYSTEM` | The source system answered with an error (e.g. 5xx) | Retry later; not an import bug |
| `STREAM_ERROR` | The stream failed as a whole | `message` has the detail |

`GET /runs/{runId}/diagnostics` (and `/diagnostics/csv`) lists the rows behind
`duplicateKeys` and `unresolvedParents` — which keys repeated, which parents
were missing.

**Retry** — `POST /runs/{runId}/retry` queues a run that re-reads only the
failed records' keys from the **same input** (for a file stream: the exact
bytes the failed run read, not whatever has since been queued). So it fixes
failures whose input was fine: a write the target rejected (`UPSERT`) once the
target type or mapping is fixed, or a transient `EXTERNAL_SYSTEM` error. A
**source-row** error (`NO_KEY`, `REJECTED_BY_SOURCE`, or `VALIDATION` caused by
the data) fails again on retry — and a `NO_KEY` row has no key to retry by.
Load corrected rows as new input instead: for a file stream, upload the
corrected file (new bytes, so it is accepted) and trigger a run — unchanged
rows are skipped by hash, so only the fixed ones are written; for any other
source, fix the source and trigger a run. Retry returns `409` when the job is
busy, the run has nothing a retry can re-read, a failed stream's source cannot
fetch records by key (an HTTP source), or a file it read has been removed or
replaced; use a new trigger then.

**What was imported** — `GET /data/streams/{streamId}/records?search=&outcome=&page=0&size=20`
(or `GET /data/records?type={targetType}` across streams). Records carry
`naturalKey` (`<keyName>:<value>`, e.g. `sku:A-100`), `outcome` (`UPSERTED`,
`DELETED`, …), and `importedAt`. `search` matches the beginning of the natural
key — with its key name (`sku:A-1`) or as the value alone (`A-1`) —
case-sensitively: search `A-1`, not `-100` or `a-1`. It also matches the
beginning of the Emporix id, which is lower case, so the text is lower-cased
for that comparison (`3FA85F64` finds `3fa85f64-…`). It is not the Emporix
query language.

## Scheduling

`PUT /configs/{configId}/schedule` with `{"cron":"0 0 2 * * *","timezone":"Europe/Berlin","enabled":true}`
— six-field (Spring) cron, seconds first. `GET` answers `204` when no
schedule exists; `DELETE` removes it. Prefer the schedule over an external
cron calling trigger: a scheduled firing queues behind a running run instead
of being refused with `409`. When an external system must trigger (for
example after its own data load finishes), treat `409` as "a run is already
in progress — skip".

## Verify

Run on a tenant meeting the prerequisites, against the test file stream.
Use a file whose keys start with `VERIFY-` and a run `origin` of
`skill-verify`. Report PASS / FAIL / BLOCKED per check with the raw evidence.

1. **Stream is a snapshot file stream.** `GET /importtool/{tenant}/streams/{streamId}`
   → `200`, `fileMode` is `SNAPSHOT` (`INCREMENTAL` → BLOCKED: check 5 relies
   on a snapshot re-reading its last file). A `401` means the token
   or tenant is wrong; `403` means the token lacks `importtool.import_trigger`.
2. **Upload queues the file.** `POST /streams/{streamId}/files` with a CSV of
   three rows `VERIFY-1..3` → `200`, `status: PENDING`; `GET …/files` lists it
   under `pending`.
3. **Same bytes are refused (negative).** Uploading the identical file again
   → `409`, and `pending` still holds one entry for it.
4. **Run completes.** `POST /configs/{configId}/runs` with
   `{"mode":"FULL","origin":"skill-verify"}` → `200` with `status: QUEUED`;
   polling `GET /runs/{runId}` reaches `SUCCEEDED`, and the stream row for
   `streamId` satisfies the eight-term equation with `recordsRead: 3` and
   `failed: 0`.
5. **Second trigger while busy is refused (negative).** Once check 4's run is
   terminal, trigger a new `{"mode":"FULL","origin":"skill-verify"}` run twice
   in immediate succession: the first returns `200` `QUEUED`, the second `409`
   with a `details` entry whose `field` is `activeRunId`, and creates no run.
   Follow the first to `SUCCEEDED`: with nothing pending, the snapshot stream
   re-reads its last file, so its stream row shows `recordsRead: 3` and
   `skipped: 3` because the data is unchanged.
6. **File consumed.** `GET …/files` shows the file in `history` with
   `PROCESSED` and `pending` empty.
7. **Records searchable by prefix.** `GET /data/streams/{streamId}/records?search=VERIFY-`
   (the value alone, so it works whatever the stream's key is called) → `3`
   records, `outcome: UPSERTED`; the search `VERIFY-2` returns one; the search
   `ERIFY` returns none.
8. **Cleanup.** Delete the three test instances with
   `DELETE /schema/{tenant}/custom-entities/{type}/instances/{id}`
   (`schema.custominstance_manage`; `{type}` is the stream's `targetType`).
   Their ids are the records' `targetId` from check 7, derived from the key
   (for example `sku-verify-1`) — not `VERIFY-1`, so matching instance ids
   against `VERIFY-` proves nothing. Read back (`schema.custominstance_read`
   — without it the `GET`s answer `403`, not `404`): a `GET` of each id returns
   `404`, and `GET /schema/{tenant}/custom-entities/{type}/instances` holds no
   instance whose key value starts with `VERIFY-`. Remove any file still pending with
   `DELETE /streams/{streamId}/files/{fileId}`; the import's own record of the
   keys stays in its history, which does not affect the tenant's data.
