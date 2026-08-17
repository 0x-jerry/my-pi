# Implementation Plan — my-pi (Agent Session Manager Desktop App)

## 1. Goal

A desktop app (ElectroBun shell, Vue 3 frontend, Bun backend) that manages multiple
parallel pi-based agent sessions across workspaces, with sqlite as the source of
truth for workspaces, sessions, messages, and token usage, and a plugin system
built on pi's extension mechanism. The view talks to core over **JSON-RPC 2.0 over
WebSocket**; the app package is a thin shell with no business logic.

**Confirmed decisions (implemented; kept as design reference):**
1. **sqlite is the source of truth** — messages/token usage in sqlite; pi JSONL
   `SessionManager` files bypassed (`SessionManager.inMemory()`). Resume/fork on sqlite.
2. **Workspace = a directory on disk** — agents run with `cwd` = workspace dir.
3. **Plugins = pi extensions** — loaded via `DefaultResourceLoader` with an app-level
   registry (enable/disable per workspace) stored in sqlite.
4. **v1 scope = "Fuller app"** — sessions, resume/fork, history listing, in-app model
   picker, API-key entry, per-session settings UI.
5. **App = thin shell + UI; JSON-RPC over WebSocket** — all backend logic in
   `packages/core`; **all UI code (Vue views, store, JSON-RPC client wrapper) lives in
   `packages/app`**, importing only core's protocol types (from `@my-pi/shared`).
   ElectroBun's built-in RPC is **not** used.
6. **Credentials in sqlite** — pi's provider credentials live in the `credentials`
   table (see §8), never in `~/.pi/agent/auth.json` (which is left untouched; no
   migration of existing keys — users re-enter them in the app).

## 2. Current state (verified 2025-08, HEAD `b3b7bc4`)

- Monorepo: Bun workspaces `packages/{shared,agent,core,app}`. **All four packages are
  complete and green** — `bun run check` passes (shared/agent/core via `tsc --noEmit`,
  app via `vue-tsc --noEmit`); `bun run test` passes **123 tests, 0 fail**
  (shared 14 / agent 13 / core 53 / app 43).
- `packages/app` is the **complete shell + Vue UI**: `src/bun/index.ts` boots
  `CoreApp` and delivers the WS config to the view (query params on the dev URL,
  `executeJavascript` injection of `window.__MY_PI_WS_CONFIG__` for `views://`);
  `src/mainview/` holds the full frontend (see §3.1). `check` = `vue-tsc --noEmit`,
  `test` = `vitest run` (jsdom + @vue/test-utils). Depends on `@my-pi/core`/`@my-pi/shared`.
- Core's public surface (`packages/core/src/index.ts`): `CoreApp.create(options)` with
  `{ dbPath, wsHost, wsPort, wsToken, wsAllowedOrigin }`; exposes `wsPort`, `wsToken`.
  DB default `~/.my-pi/my-pi.db` (env `MY_PI_DB_PATH`), WAL, `user_version` migrations
  at v2 (credentials table), chmod 0600.
- RPC surface (`@my-pi/shared`): `RpcMethod` (25 methods: workspaces/sessions/chat/
  models/plugins/settings), `RpcEvent` (8 server→client notifications). Server binds
  `127.0.0.1:<port>` at path `/ws`; auth via **WebSocket subprotocol** (`new WebSocket(url, token)`,
  preferred) or `?token=` query param; single view connection; deltas coalesced ~50ms.
- pi pinned at **0.84.1**; all pi imports confined to `packages/agent`.
- E2E smoke scripts exist: `scripts/smoke.ts` (RPC round-trip), `scripts/agent-smoke.ts`
  (real model run), `scripts/creds-smoke.ts` (login→persist→restart→logout).

**What remains:** pool-level concurrency test + manual dual-chat (§4 Step 8),
hardening + README + final gate (§4 Step 9).

## 3. Architecture

### 3.1 Package layout

```
packages/
  shared/  NEW (done). Protocol types/helpers + DTOs shared by core (server) and
           app (client). No runtime deps.
  app/     DONE. Thin ElectroBun shell + **all UI code** (Vue frontend in
           src/mainview: views/ + components/ + rpc/ + store.ts + utils/ + shims/,
           incl. the JSON-RPC client wrapper). Backend here only boots `CoreApp`
           (from core) and opens the BrowserWindow. NO business logic.
           Tests: vitest + jsdom + @vue/test-utils in packages/app/test/.
  core/    DONE. All backend application code: sqlite data layer, workspace/session
           services, agent pool, event bus, persistence, plugin registry, model/auth
           service, settings, WebSocket JSON-RPC server.
  agent/   DONE. Thin wrapper around pi SDK: one PiAgent = one pi AgentSession.
           Converts pi events → app events; owns config assembly (loader, settings).
```

Dependency direction: `app → core → agent → @earendil-works/pi-coding-agent`.
Shared DTOs + JSON-RPC protocol **types** live in `shared`; the JSON-RPC **client
implementation** is UI-side code and lives in `app` (done).

### 3.2 Data model (sqlite, WAL mode, `PRAGMA user_version` migrations, v2)

Foreign keys are **not enforced** (`PRAGMA foreign_keys` stays OFF); referential
integrity and cascading deletes are handled in application code.

```
workspaces(id TEXT PK, name, path TEXT UNIQUE, created_at, updated_at)

sessions(
  id TEXT PK, workspace_id, title,
  status TEXT,              -- idle | running | stopped | error
  model_provider, model_id, thinking_level, system_prompt,
  forked_from_session_id, forked_from_message_seq,
  message_count,                                      -- denormalized
  total_input_tokens, total_output_tokens, total_cache_read,
  total_cache_write, total_cost,                      -- denormalized rollups
  created_at, updated_at, last_activity_at)

messages(
  id TEXT PK,               -- app-assigned stable id: "m-<sessionId>-<seq>"
  session_id, seq INTEGER UNIQUE(session_id, seq),
  role, model, provider,
  usage_json,               -- parsed Usage (nullable)
  data_json,                -- full AgentMessage (JSON blob; images stay base64)
  created_at)

token_usage(               -- detailed ledger, one row per assistant/tool message
  id INTEGER PK AUTOINCREMENT, session_id, message_id,
  kind,                     -- assistant | tool
  input, output, cache_read, cache_write, reasoning, cost, created_at)

credentials(               -- migration #2; pi provider credentials live here
  provider_id TEXT PK, type TEXT,      -- 'api_key' | 'oauth' (denormalized for list())
  credential_json TEXT, updated_at)

plugins(
  id TEXT PK, name, description, source_type,   -- path | builtin
  source, scope,            -- global | workspace
  workspace_id, enabled INTEGER, installed_at, updated_at, config_json)

settings(key TEXT PK, value_json)
```

Rollups on `sessions` keep list views cheap; `token_usage` is the audit detail.
Message content is stored as `data_json` (opaque to the app) so pi message type
evolution doesn't break the schema.

### 3.3 Runtime wiring

```
Vue view ──JSON-RPC 2.0 over WebSocket (subprotocol token)──▶ core (CoreApp)
     ▲                                        │  CoreApp (started by app shell)
     └──JSON-RPC notifications (events)───────┤    ├─ JsonRpcServer (Bun.serve ws; requests + broadcast)
                                              │    ├─ WorkspaceService
                                              │    ├─ SessionService (create/fork/resume/delete)
                                              │    ├─ AgentPool        (running PiAgents by sessionId)
                                              │    ├─ PersistenceWriter (sqlite: messages, usage, status)
                                              │    ├─ PluginService    (registry + loader filter)
                                              │    ├─ ModelService     (ModelRuntime + SqliteCredentialStore)
                                              │    └─ SettingsService
                                              └── AgentPool ──▶ N × PiAgent (agent pkg) ──▶ pi SDK

The app shell only starts `CoreApp` (which boots the WS server), delivers the WS
endpoint + auth token to the view, and opens the window. Delivery: the dev-server
URL (`http://localhost:5173`) gets `?ws=<port>&token=<secret>` (query params survive
over HTTP); the packaged `views://` scheme resolves files by exact path and rejects
**both** query strings and hash fragments, so the shell injects
`window.__MY_PI_WS_CONFIG__` via `executeJavascript` (immediately and on
`dom-ready`); the view polls for it for up to 8s. The view connects with its own
JSON-RPC client (in `app`, built on `@my-pi/shared`).
```

Event flow for one prompt: `chat.send(sessionId, text)` → SessionService → AgentPool →
PiAgent.prompt(); pi events → app events → EventBus → PersistenceWriter (settle-point
suffix-diff + rollups) and the JSON-RPC broadcaster (notifications to the view).

## 4. Remaining steps (ordered, each independently verifiable)

Effort: S ≤0.5d, M ≤1d, L ≤2d. (Steps 0–7 of the original plan — shared protocol,
sqlite layer, core services, agent wrapper, pool/persistence, plugin service + RPC
server, CoreApp, app shell wiring (Step 6), Vue UI (Step 7) — are **done**, see §8.)

### Step 6 — App shell wiring  (S) — DONE
Implemented (see §8). **Deviations from the plan text:** `views://` rejects **both**
query params and hash fragments (verified empirically — the scheme handler resolves
exact file paths), so the config is delivered via `executeJavascript`
(`window.__MY_PI_WS_CONFIG__` on dom-ready + immediate inject + 8s view-side poll);
the dev-server URL keeps `?ws=&token=` (verified working). Additional fixes that
landed here: `vite.config.ts base: "./"` (relative assets so the packaged view
resolves them under `views://`) and a `declare module "three"` shim (electrobun's
`bun` API imports the untyped `three` package — pre-existing app `check` failure).

### Step 7 — Vue frontend  (L) — DONE
Implemented as designed, with these notes:
- Structure: `views/` (5 panels) + `components/ModelPicker.vue` + `rpc/client.ts` +
  `store.ts` (mainview root) + `utils/{render,format}.ts` + `shims/` (d.ts files).
- Tests: **vitest + jsdom + @vue/test-utils** (`packages/app/test/`, `vitest.config.ts`,
  `"test": "vitest run"`); `check` is `vue-tsc --noEmit` (works with the tsgo fork).
- Streaming: buffers accumulate per run; completed segments are frozen into
  `StreamingState.parts` at tool boundaries so multi-assistant turns render
  separately during streaming (reconciled by id at `run_end`).
- Post-review hardening: `refreshAll()` re-syncs the active workspace sessions +
  active session transcript on reconnect; notification handlers guard refetch
  rejections into the error banner; `RpcClient` ignores late events on stale/
  closed sockets; `deleteSession` evicts per-session state; session-list refetches
  are debounced per-microtask; zero-usage re-settle can't clobber last-run usage.

### Step 8 — Parallel agents  (S)
- `packages/core/src/agents/agent-pool.ts` — add optional `agentFactory` to
  `AgentPoolDeps` (defaults to the current `PiAgent.create` path) so tests can inject
  fake agents without module mocking.
- New `packages/core/test/agent-pool.test.ts` — with fake agents: start N sessions,
  concurrent `send()` reaches distinct agents; `stop()` on one emits
  `session.status: stopped` and disposes only that agent; abort affects only its own
  session; status transitions running→idle/stopped are emitted.
- Manual: two sessions in the same workspace (different models/plugins if available)
  stream independently; aborting one leaves the other running; both persist with
  correct rollups (sqlite check).
- Verify: `bun run test` (core) + manual dual-chat scenario.

### Step 9 — Hardening, README, final gate  (M)
- UI: per-session error banner (from `session.status {error}`), abort idempotency
  (button state from `streaming.status`), token-usage footer + SessionList totals
  (data already in `SessionInfo` rollups), loading/empty states, "reconnecting…"
  indicator while the client is between connections.
- `README.md` (currently 1 line) — rewrite: prerequisites, `bun install`,
  `bun run dev` / `bun run dev:hmr`, architecture summary (packages + RPC + events),
  how to add a plugin, credentials note (keys live in sqlite; `~/.pi/agent/auth.json`
  is no longer read).
- Root `package.json` — extend `check` to include the app (`vue-tsc --noEmit`).
- Verify: fresh-clone boot per README; full `bun install && bun run check && bun run test`.

## 5. Risks & tricky parts (status as of HEAD `b3b7bc4`; items 1–6 are resolved)

1. **WS config reaching the view — DONE.** De-risked empirically in Step 6: the
   packaged `views://` scheme handler resolves files by exact path and rejects
   **both** query params and hash fragments (empty response). Solved via
   `executeJavascript` injection of `window.__MY_PI_WS_CONFIG__` (immediate +
   dom-ready) with an 8s view-side poll; the dev-server URL keeps `?ws=&token=`
   (verified). Subprotocol auth (`new WebSocket(url, token)`) is unchanged; the
   in-webview round-trip still needs the interactive pass (see §6).
2. **Streaming render performance — DONE.** Deltas are coalesced ~50ms server-side;
   ChatView appends to string buffers (`textBuf`/`thinkingBuf`) and Vue batches
   renders per tick. Completed segments are frozen into `StreamingState.parts` at
   tool boundaries so multi-assistant turns render separately.
3. **Store sync after mutations — DONE.** Refetch-after-mutation rules implemented
   (workspaces.create included — it pushes no event); `run_end` reconciles the
   transcript by stable `m-<sid>-<seq>` id (idempotent vs `message_end`).
4. **Reconnect semantics — DONE.** Backoff reconnect (0.5s→5s) + `refreshAll()` on
   open — which now also re-syncs the active workspace's sessions and the active
   session's transcript (runs finishing while disconnected are recovered).
   "reconnecting…" indicator in App.vue; in-flight `chat.send` fails fast with an
   error banner.
5. **`tsc` can't check SFC bodies — DONE.** App `check` is `vue-tsc --noEmit`
   (works with the `typescript-native-bridge` tsgo fork). Added a `declare module
   "three"` shim for electrobun's untyped `three` import (pre-existing failure).
6. **Plugin toggles only affect newly loaded sessions — DONE.** PluginsPanel shows
   the "restart the session" note (loader config fixed at agent load).
7. **Large messages / images in sqlite.** `data_json` stores base64 as-is; ChatView
   renders them as data URIs. Acceptable for v1; externalize blobs later. (Open.)
8. **Plaintext localhost WS.** Mitigated in core (127.0.0.1 bind, origin check,
   random per-launch token, single-connection). The dev URL carries `?token=` as a
   documented fallback (fresh per-launch secret on a localhost socket); packaged
   builds never put the token in the URL — they use the injection path. (Open.)
9. **Process lifecycle — DONE (dev).** `app.dispose()` runs on SIGINT/SIGTERM
   (agents stopped, WS closed, db closed). Window-close exits the process via
   electrobun's `exitOnLastWindowClosed` without dispose — sqlite WAL recovers on
   next open; agents are in-process (no orphans). Accepted for v1.

## 6. Verification checklist (definition of done)

Automated items marked [x] are verified by CI-style runs; the unmarked items are
manual GUI scenarios that still need the interactive pass in dev mode.

- [x] `bun run check` passes in all four packages (app via vue-tsc); `bun run test`
      green — **123 tests, 0 fail** (shared 14 / agent 13 / core 53 / app 43).
- [x] `vite build` passes; smoke scripts (`smoke`, `creds-smoke`) still run
      (`agent-smoke` skips without model auth).
- [ ] App boots (`bun run dev` / `dev:hmr`); view connects over WS with the
      subprotocol token; a `workspaces.list` round-trip succeeds inside the webview
      (shell boot + URL construction verified headlessly; in-webview round-trip pending).
- [ ] Workspace create/open/remove from UI; non-directory paths rejected with an
      error surfaced in the UI.
- [ ] Session create → ModelPicker shows providers + available models + auth status;
      entering an API key makes models available; logout works.
- [ ] Chat: send prompt → text/thinking/tool-call deltas stream live; abort stops the
      turn; usage shows in the ChatView footer and SessionList totals; `token_usage`
      rows exist in sqlite.
- [ ] Resume: restart app → session lists; open → full transcript restored; follow-up
      uses restored history.
- [ ] Fork at message N → new session with exactly messages ≤ N; both sessions
      independently promptable.
- [ ] Two sessions stream concurrently; aborting one leaves the other running.
- [ ] Plugins: enable builtin example plugin → tool callable in a prompt; disable →
      gone; add by path works; per-workspace scoping holds.
- [ ] Settings (default model, thinking level) persist across restart.
- [ ] No unhandled errors / clear UI state on: deleting a workspace with running
      sessions, plugin toggle while sessions run, WS drop mid-stream (reconnect +
      refetch).
- [ ] README works on a fresh clone (`bun install` → boot).

## 7. Explicitly out of scope (v1)

- pi JSONL session files / `SessionManager` file resume; tree branching UI
  (`navigateTree`, branch summaries); compaction with summaries.
- Worker-thread / subprocess agent isolation (single process for v1).
- Full OAuth login flows in-app (token entry via sqlite-backed login works; OAuth
  refresh is handled by pi automatically); multi-user sync; telemetry.
- App signing/packaging beyond existing electrobun build scripts.
- Editing message history / manual transcript edits.
- Credential migration from `~/.pi/agent/auth.json`; encryption at rest / OS keychain.

## 8. Implementation status

**Done (verified 2025-08):**

| Package | Contents | Verified |
|---|---|---|
| `packages/shared` (`@my-pi/shared`) | JSON-RPC 2.0 protocol (`parseRpcMessage`, error codes, `RpcMethod`/`RpcEvent`, builders), DTOs (Workspace, SessionInfo, StoredMessage, TokenUsageRow, PluginInfo, Model/ProviderInfo…), PiAgentEvent/CoreEvent/InternalEvent unions | 14 tests |
| `packages/agent` (`@my-pi/agent`) | `PiAgent` (createAgentSession wrapper: in-memory SessionManager, compaction off, message restore), `ModelService` (ModelRuntime wrapper + sqlite CredentialStore wiring), `buildResourceLoader` (noExtensions + app-managed plugin paths), pure event mapper + serializer, pi type re-exports (pi pinned 0.84.1) | 13 tests |
| `packages/core` (`@my-pi/core`) | sqlite layer (WAL, v1→v2 migrations, no FK enforcement, chmod 0600; repos for workspaces/sessions/messages/token_usage/plugins/settings/credentials), `SqliteCredentialStore` (per-provider serialized async semantics), services (workspace/session incl. fork+resume/settings/plugin registry w/ builtin example), AgentPool (lazy load, resume, status transitions), PersistenceWriter (idempotent suffix-diff, token ledger, rollups), TranscriptReader, JsonRpcServer (Bun.serve ws, subprotocol/query token, origin check, -32601/-32700 errors), `registerRpcMethods`, `CoreApp` (create/dispose, broadcaster w/ 50ms delta coalescing, orchestration: removeWorkspace/deleteSession/fork/sendMessage) | 53 tests |
| `packages/app` (`@my-pi/app`) | Step 6 shell: `CoreApp.create({wsPort: 0})`, WS config delivery (query params on dev URL; `executeJavascript` injection of `__MY_PI_WS_CONFIG__` on dom-ready for `views://`, which rejects query/hash), SIGINT/SIGTERM dispose, `base: "./"` + `three` shim. Step 7 UI (all in `src/mainview/`): `rpc/client.ts` (JSON-RPC over WS, pending map, notification registry, reconnect w/ backoff, injectable socket factory), `store.ts` (reactive store + actions; 8 notification handlers; refetch-after-mutation rules; idempotent `run_end` reconcile; reconnect re-sync in `refreshAll`; debounced session refetches; per-session state eviction), `utils/render.ts` (duck-typed renderer for opaque pi `data`: text/thinking/image/toolCall/toolResult) + `utils/format.ts`, views `WorkspaceSidebar`/`SessionList`/`ChatView` (streaming buffers + tool-boundary parts, steer/followUp/abort, usage footer, fork-at-message-N)/`PluginsPanel`/`SettingsPanel`, `components/ModelPicker`, `main.ts` (config resolution + poll). Tests: vitest + jsdom + @vue/test-utils (`test/rpc-client`, `test/store`, `test/chat-view`) | 43 tests; vue-tsc + vite build green |

Total: **123 tests, 0 fail**; `check` clean in all four packages. E2E smokes
`scripts/{smoke,agent-smoke,creds-smoke}.ts` run (agent-smoke skips without model
auth). Key bug caught by E2E: `CoreApp`
field-initialized a second `EventBus` that shadowed the wired one (broadcaster/listeners
would have missed all events) — fixed via dependency injection.

**Credentials (§9 of the old plan — DONE):** pi credentials live in the sqlite
`credentials` table (migration #2, v1→v2 upgrade tested) via `SqliteCredentialStore`
implementing pi-ai's `CredentialStore`; pi never touches `~/.pi/agent/auth.json`
(mtime-verified). No RPC surface change; `models.login/logout/setApiKey` flow through
`ModelService` unchanged. Semantics: per-provider async serialization (OAuth refresh
safe), `modify` returning `undefined` leaves entry unchanged, runtime-only keys never
persisted, corrupt blob degrades to "no credential".

**Not started (this plan's remaining steps):** pool-level concurrency test + manual
dual-chat (Step 8), hardening + README + final gate (Step 9). Manual GUI
verification items in §6 are also still pending (steps 6–7 passed all automated
checks but the interactive webview pass is outstanding).
