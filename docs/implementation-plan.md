# Implementation Plan — my-pi (Agent Session Manager Desktop App)

## 1. Goal

A desktop app (ElectroBun shell, Vue 3 frontend, Bun backend) that manages multiple
parallel pi-based agent sessions across workspaces, with sqlite as the source of
truth for workspaces, sessions, messages, and token usage, and a plugin system
built on pi's extension mechanism. The view talks to core over **JSON-RPC 2.0 over
WebSocket**; the app package is a thin shell with no business logic.

**Confirmed decisions (from user Q&A):**
1. **sqlite is the source of truth for everything** — messages and token usage are
   stored in sqlite; pi's JSONL `SessionManager` files are bypassed (use
   `SessionManager.inMemory()`). Resume/fork are implemented on top of sqlite.
2. **Workspace = a directory on disk** — agents run with `cwd` = workspace dir.
3. **Plugins = pi extensions** — loaded via `DefaultResourceLoader`, with an
   app-level registry (enable/disable per workspace) stored in sqlite.
4. **v1 scope = "Fuller app"** — minimal slice + session resume/fork + session
   history listing + in-app model picker, API-key entry, per-session settings UI.
5. **App = thin shell + UI; JSON-RPC over WebSocket** — backend logic (services,
   persistence, WebSocket/JSON-RPC server) lives in `packages/core`; **all UI code
   (Vue views, store, and the JSON-RPC client wrapper) lives in `packages/app`**,
   importing only core's protocol types. ElectroBun's built-in RPC is **not** used.

## 2. Current state & constraints (verified)

- Monorepo: Bun workspaces (`packages/*`). Only `packages/app` exists (ElectroBun +
  Vue 3 + Vite, demo counter app). No `core`/`agent` packages, no DB, no tests.
- `packages/app/src/bun/index.ts` is the Bun backend entry (creates BrowserWindow).
  ElectroBun's built-in RPC (`defineElectrobunRPC` / `createRPC`) is **not** used.
  Instead, core exposes a **JSON-RPC 2.0 server over WebSocket** via Bun's built-in
  `Bun.serve({ websocket })`; the Vue view is a plain WebSocket JSON-RPC client.
- pi SDK (`@earendil-works/pi-coding-agent`, global install) facts the design relies on:
  - `createAgentSession({ cwd, agentDir, model, thinkingLevel, modelRuntime,
    sessionManager: SessionManager.inMemory(cwd), settingsManager, resourceLoader })`
  - `session.agent.state.messages = [...]` restores conversation history.
  - In-memory `AgentMessage`s have **no stable id** → assign ids when persisting.
  - `DefaultResourceLoader` options: `noExtensions`, `additionalExtensionPaths`,
    `extensionFactories`, `extensionsOverride(base => filtered)`, `systemPromptOverride`.
  - `ModelRuntime.create()` → `getProviders/getModels/getAvailable/checkAuth/
    setRuntimeApiKey/login/logout/refresh`. Default auth file `~/.pi/agent/auth.json`.
  - Events: `message_update` (text_delta/thinking_delta), `tool_execution_start/
    update/end`, `message_start/end`, `agent_start/end` (end carries new messages),
    `turn_end` (carries assistant message + tool results w/ usage), compaction/retry events.
  - `AssistantMessage.usage` → `{ input, output, cacheRead, cacheWrite, reasoning,
    totalTokens, cost{...} }`.
- `bun:sqlite` is built into Bun — no native dependency needed.

## 3. Architecture

### 3.1 Package layout

```
packages/
  app/     Thin ElectroBun shell (exists) + **all UI code** (Vue frontend in
           src/mainview, incl. the JSON-RPC client wrapper). Backend here only
           boots `CoreApp` (from core) and opens the BrowserWindow. NO business
           logic here.
  core/    NEW. All backend application code: sqlite data layer, workspace/session
           services, agent pool, event bus, persistence, plugin registry, model/
           auth service, settings, and the WebSocket JSON-RPC server + shared
           protocol types.
  agent/   NEW. Thin wrapper around pi SDK: one PiAgent = one pi AgentSession.
           Converts pi events → app events; owns config assembly (loader, settings).
```

Dependency direction: `app → core → agent → @earendil-works/pi-coding-agent`.
Shared DTOs + JSON-RPC protocol **types** live in `core` (imported by `app`). The
JSON-RPC **client implementation** is UI-side code and lives in `app` (Step 7).

### 3.2 Data model (sqlite, WAL mode, `PRAGMA user_version` migrations)

Foreign keys are **not enforced** — `PRAGMA foreign_keys` stays OFF (sqlite default).
All `*_id` columns are plain, indexed columns; referential integrity and cascading
deletes are handled in application code (see WorkspaceService/SessionService remove flows).

```
workspaces(id TEXT PK, name, path TEXT UNIQUE, created_at, updated_at)

sessions(
  id TEXT PK, workspace_id, title,        -- workspace_id → workspaces (not enforced)
  status TEXT,              -- idle | running | stopped | error
  model_provider, model_id, thinking_level,
  system_prompt,
  forked_from_session_id, forked_from_message_seq,   -- fork provenance
  message_count,                                      -- denormalized
  total_input_tokens, total_output_tokens, total_cache_read,
  total_cache_write, total_cost,                      -- denormalized rollups
  created_at, updated_at, last_activity_at)

messages(
  id TEXT PK,               -- app-assigned stable id: "m-<sessionId>-<seq>"
  session_id, seq INTEGER UNIQUE(session_id, seq),  -- session_id → sessions (not enforced)
  role,                     -- user | assistant | toolResult
  model, provider,          -- from AssistantMessage
  usage_json,               -- parsed Usage (nullable)
  data_json,                -- full AgentMessage (JSON blob; images stay base64)
  created_at)

token_usage(               -- detailed ledger, one row per assistant/tool message
  id INTEGER PK AUTOINCREMENT, session_id, message_id,   -- → sessions/messages (not enforced)
  kind,                     -- assistant | tool
  input, output, cache_read, cache_write, reasoning, cost,
  created_at)

plugins(
  id TEXT PK, name, description, source_type,   -- path | inline | bundled
  source, scope,            -- global | workspace
  workspace_id, enabled INTEGER,        -- workspace_id → workspaces (not enforced)
  installed_at, updated_at, config_json)

settings(key TEXT PK, value_json)               -- app defaults, e.g. default model
```

Rollups on `sessions` keep list views cheap; the `token_usage` ledger is the audit
detail. Message content is stored as `data_json` (opaque to the app) so pi message
type evolution doesn't break the schema.

### 3.3 Runtime wiring

```
Vue view ──JSON-RPC 2.0 over WebSocket──▶ core (CoreApp)
     ▲                                        │  CoreApp (in core, started by app shell)
     └──JSON-RPC notifications (events)───────┤    ├─ JsonRpcServer (Bun.serve ws; requests + broadcast)
                                              │    ├─ WorkspaceService
                                              │    ├─ SessionService (create/fork/resume/delete)
                                              │    ├─ AgentPool        (running PiAgents by sessionId)
                                              │    ├─ PersistenceWriter (sqlite: messages, usage, status)
                                              │    ├─ PluginService    (registry + loader filter)
                                              │    ├─ ModelService     (ModelRuntime wrapper)
                                              │    └─ SettingsService
                                              └── AgentPool ──▶ N × PiAgent (agent pkg) ──▶ pi SDK

The app shell only starts `CoreApp` (which boots the WS server), passes the WS URL
(`ws://127.0.0.1:<port>`, as a URL query param) to the view, and opens the window.
The view connects with its own JSON-RPC client (in `app`, built on core's protocol
types).

Event flow for one prompt:
1. View → `chat.send(sessionId, text)` → `SessionService` → `AgentPool` →
   `PiAgent.prompt()`.
2. pi emits events → PiAgent maps them to app events → `EventBus` fan-out to:
   - `PersistenceWriter`: on `agent_end`/abort/error (settle points), suffix-diff
     `agent.state.messages` against `messages` table and insert new rows; update
     session rollups from `AssistantMessage.usage` (+`token_usage` ledger rows).
   - JSON-RPC notification broadcaster: forwards deltas to the view as server→
     client notifications (coalesced ~50ms for text deltas).

Plugins: `PluginService` resolves enabled plugin paths (global + workspace) →
`DefaultResourceLoader({ noExtensions: true, additionalExtensionPaths: enabledPaths,
extensionFactories: [bundled plugins] })` per workspace. `noExtensions: true` means
pi never auto-discovers `.pi/extensions` and never triggers its project-trust prompt;
the app is the sole gatekeeper of what loads.

## 4. Steps (ordered, each independently verifiable)

Effort: S ≤0.5d, M ≤1d, L ≤2d.

### Step 0 — Monorepo scaffolding  (M)
- Add `packages/core/package.json` + `tsconfig.json`, `packages/agent/package.json` +
  `tsconfig.json`. Deps: `agent` → `@earendil-works/pi-coding-agent` (pin exact
  version from global install), `core` → `agent` (+ pi types), `app` → `core`.
- Root `package.json`: add `dev`, `check` (tsc --noEmit per package), `test` (bun test)
  scripts. Ensure `packages/*` workspaces pick up new packages (`bun install`).
- Verify: `bun install` clean; `bun run check` passes in every package (empty packages compile).

### Step 1 — sqlite data layer in core  (M)
- `packages/core/src/db/connection.ts` — open sqlite (default `~/.my-pi/my-pi.db`,
  overridable via env), WAL, `PRAGMA foreign_keys = OFF` (explicit; no FK
  enforcement — see §3.2).
- `packages/core/src/db/schema.ts` + `migrations.ts` — `PRAGMA user_version` runner
  with migration #1 creating all tables in §3.2.
- Repositories in `packages/core/src/db/repos/`: `workspaces.ts`, `sessions.ts`,
  `messages.ts`, `token-usage.ts`, `plugins.ts`, `settings.ts` (typed CRUD, no business logic).
- Verify: `bun test` — tmp-db tests: migration idempotency, CRUD round-trips,
  unique constraints, message seq ordering, rollup update helpers.

### Step 2 — core domain services  (M)
- `packages/core/src/workspaces/workspace-service.ts` — create/list/get/remove;
  validate path exists & is a dir; remove stops agents (delegates to pool) then deletes rows.
- `packages/core/src/sessions/session-service.ts` — create (resolve default model from
  settings), list (with rollups), get, delete, `forkSession(id, uptoSeq)` (new session
  row + copy messages ≤ seq), `resumeSession(id)` (returns config for agent pkg:
  messages JSON, model, thinking level).
- `packages/core/src/settings/settings-service.ts` — key/value CRUD, typed defaults.
- Verify: unit tests (tmp db): fork copies correct prefix & provenance, delete cascades
  in app code (FKs not enforced),
  workspace path validation, resume payload shape.

### Step 3 — agent package: PiAgent wrapper  (M)
- `packages/agent/src/resource-loader.ts` — `buildResourceLoader({ cwd, agentDir,
  enabledPluginPaths, bundledFactories, systemPrompt })` using `noExtensions: true`
  + `additionalExtensionPaths` + `extensionFactories` (+ optional `extensionsOverride`
  for future filtering needs).
- `packages/agent/src/pi-agent.ts` — class `PiAgent`:
  - `static create(cfg)` → `createAgentSession({ cwd, agentDir: getAgentDir(),
    model, thinkingLevel, modelRuntime, sessionManager: SessionManager.inMemory(cwd),
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
    resourceLoader })`; restores `agent.state.messages` from cfg when resuming.
  - API: `prompt(text, opts)`, `steer(text)`, `followUp(text)`, `abort()`, `dispose()`,
    `setModel`, `setThinkingLevel`, `getMessages()`, typed `on(event, cb)`.
  - Event mapping: pi events → app events (`message_delta`, `message_end`,
    `tool_execution_*`, `agent_start/end` with new messages, `turn_end` with usage,
    `error` from `agent.state.errorMessage` / failed messages).
  - Lifecycle guard: one in-flight prompt per PiAgent (throw/queue otherwise).
- `packages/agent/src/model-service.ts` — thin wrapper over `ModelRuntime.create()`:
  `listProviders/getAvailable/checkAuth/setApiKey/login/logout/refresh`.
- Verify: `bun test` for config assembly + event mapping with recorded pi event
  fixtures; manual smoke script `scripts/smoke-agent.ts` (needs a configured key):
  create session, prompt, print streamed deltas + final usage.

### Step 4 — AgentPool, EventBus, PersistenceWriter, TokenLedger  (L)
- `packages/core/src/events/event-bus.ts` — typed pub/sub with `on/emit/off`.
- `packages/core/src/agents/agent-pool.ts` — map sessionId → running PiAgent;
  `start(sessionId, agentCfg)`, `send/steer/followUp/abort/stop`, `disposeAll()`;
  status transitions (`running`→`idle|stopped|error`) pushed to bus.
- `packages/core/src/persistence/writer.ts` — subscribes to bus; on settle points
  (agent_end, abort, error, stop) suffix-diffs `agent.state.messages` vs
  `messages.message_count`; inserts new rows with stable ids `m-<sid>-<seq>`;
  writes `token_usage` ledger rows per assistant/tool message; updates `sessions`
  rollups + `last_activity_at`; dedupes by seq (idempotent on repeat settle events).
- `packages/core/src/persistence/reader.ts` — `getMessages(sessionId)` ordered,
  `getTranscript(sessionId)` for resume.
- Verify: unit tests with recorded event fixtures: diff-adds only new messages,
  idempotency (double settle), ledger math (usage → rollups), abort path persists
  partial turn; manual smoke: real model run ends with correct counts in sqlite.

### Step 5 — PluginService + JSON-RPC protocol & server (core)  (L)
- `packages/core/src/plugins/plugin-service.ts` — registry CRUD (add/remove/enable/
  disable, global vs workspace scope); `resolveEnabledPaths(workspaceId)` used by the
  loader in Step 3; example bundled plugin(s) (`examples/plugin-stats.ts` registers a
  tool via `pi.registerTool`).
- `packages/core/src/rpc/jsonrpc.ts` — JSON-RPC 2.0 types: `Request`, `Response`,
  `Notification`, `Error` (codes: parse -32700, invalid request -32600, method not
  found -32601, internal -32603), strict parse/serialize, `id` correlation.
- `packages/core/src/rpc/types.ts` — DTOs + method/notification name contracts
  covering: workspaces.*, sessions.*, chat.send/steer/followUp/abort, models.*,
  plugins.*, settings.*, events.* (server→client notifications).
- `packages/core/src/rpc/server.ts` — `JsonRpcServer`: starts `Bun.serve`
  WebSocket endpoint bound to `127.0.0.1` (default port, overridable via env, free
  port fallback); method registry `register(method, handler)`; `notify(name,
  payload)` broadcast (coalesced ~50ms for text deltas); origin check on upgrade;
  single active view connection, reconnect-tolerant; unknown method → -32601.
- `packages/core/src/rpc/methods.ts` — binds all core services to the registry.
  (The JSON-RPC **client** is deliberately not part of core — it is UI-side code
  and lives in `app`, Step 7.)
- Verify: unit tests — JSON-RPC framing (parse/serialize, error codes, batch
  rejection), method routing, notification broadcast; integration test with a real
  `Bun.serve` ws (round-trip request + push); plugin enable/disable scoping tests.

### Step 6 — CoreApp (core) + thin app shell  (M)
- `packages/core/src/app.ts` — `CoreApp.create({ dbPath, wsPort })`: opens DB,
  builds services, starts `JsonRpcServer`, wires EventBus → persistence writer +
  notification broadcaster; `dispose()` (stop agents, close ws, close db). The app
  shell only ever calls `create`/`dispose`.
- `packages/app/src/bun/index.ts` — replace current body with: `CoreApp.create(...)`
  (db at app data dir, e.g. `~/.my-pi/my-pi.db`), create BrowserWindow with the WS
  URL/port appended as a query param; nothing else.
- Verify: `bun run dev` boots window without errors; view connects over WS and a
  `workspaces.list` round-trip succeeds (log response or minimal UI check);
  CoreApp lifecycle test (create/dispose, ws closes, no leaks).

### Step 7 — app frontend (Vue)  (L)
- `packages/app/src/mainview/` restructure:
  - `rpc/client.ts` — the JSON-RPC client implementation (WebSocket, built on
    core's protocol types): `call(method, params)`, `on(name, cb)` notifications,
    auto-reconnect; connects to the WS URL from the view's URL query param and
    feeds the store.
  - `store.ts` — reactive store (workspaces, sessions, active session, streaming
    transcript, models, plugins, settings) fed by RPC events.
  - Views: `WorkspaceSidebar` (create/open/remove), `SessionList` (history, fork,
    resume, delete), `ChatView` (message list w/ thinking/tool-call rendering,
    streaming deltas, abort button, usage footer), `ModelPicker` (provider →
    available models, auth status, API-key entry), `PluginsPanel` (enable/disable,
    add by path), `SettingsPanel` (default model, thinking level, compaction toggle
    stub). Route via simple view switching in `App.vue` (no router dependency needed
    for v1).
- Verify: manual scenario checklist (§6) in dev mode.

### Step 8 — Parallel agents  (M)
- Exercise 2+ sessions concurrently (same workspace, different models/plugins) —
  both stream independently, both persist correctly, aborting one doesn't affect
  the other. Fix any shared-state issues (single shared ModelRuntime is fine;
  per-session loader/agent state must not leak).
- Add concurrency unit test at pool level (fake PiAgent): start N, stop one, verify
  lifecycle events.
- Verify: `bun test` + manual dual-chat scenario.

### Step 9 — Hardening & polish  (M)
- Error surfacing: per-session error banner (from agent.errorMessage), retry
  indicators pass-through, abort idempotency.
- Token usage display in ChatView footer + per-session totals in SessionList.
- README: run instructions (`bun run dev:hmr`), architecture summary, how to add a
  plugin. Root scripts wired: `bun run check`, `bun run test`.

## 5. Risks & tricky parts

1. **Message persistence correctness** (retries/abort/compaction). Mitigation:
   persist only at settle points via seq suffix-diff (idempotent); compaction disabled
   by default (`SettingsManager.inMemory` override) — re-enabling later needs a
   compaction-event handler that rewrites the transcript. Test double-settle.
2. **pi SDK churn / version pinning.** Pin exact version in `agent/package.json`;
   all pi imports confined to `packages/agent` so upgrades touch one package.
3. **Hot-path sqlite writes.** Writes happen at settle points, not per delta — low
   volume. Use one connection, WAL, and prepared statements.
4. **Parallel sessions in one process.** pi supports concurrent sessions; shared
   `ModelRuntime` is safe. Guard: per-PiAgent single-flight. Process isolation
   (workers) is future work.
5. **Plugin trust/loading.** `noExtensions: true` + app-managed paths avoids pi's
   project-trust prompt and gives deterministic enable/disable. Plugin toggles
   require recreating the workspace's loader + restarting its sessions.
6. **Model auth UX.** v1: API-key entry via `login()` (check `AuthInteraction` shape
   during Step 3) or `setRuntimeApiKey` (session-only); existing `~/.pi/agent/auth.json`
   credentials work out of the box. Full OAuth flows deferred.
7. **Large messages / images in sqlite.** `data_json` stores base64 images as-is;
   acceptable for v1. Note for future: externalize blobs > N KB.
8. **JSON-RPC notification flooding.** Coalesce text deltas (~50ms) before pushing
    to the view.
9. **Workspace removal with running agents.** Stop all sessions (await abort/dispose)
   before deleting rows.
10. **Resume correctness.** Restored `agent.state.messages` must include tool
    results in order — restore exactly the serialized transcript from sqlite (no
    re-construction).
11. **Plaintext localhost WebSocket.** ElectroBun's built-in RPC is encrypted; our
    JSON-RPC WS is plaintext. Mitigate: bind `127.0.0.1` only, origin check on
    upgrade, optional random token passed to the view via URL, single-connection
    policy.
12. **WS port management.** Default port may conflict — pick a free port at boot
    and pass the actual port to the view. Verify WebSocket works inside the
    webview early (Step 6) before building UI on it.

## 6. Verification checklist (definition of done)

- [ ] `bun install`, `bun run check` (tsc --noEmit, all packages), `bun run test` all pass.
- [ ] sqlite file created at app data dir; migrations idempotent; tables per §3.2.
- [ ] View connects over WebSocket JSON-RPC (single connection, auto-reconnect);
      requests get responses, events arrive as notifications; unknown methods
      rejected with JSON-RPC error -32601.
- [ ] Workspace CRUD works from UI; path validation rejects non-directories.
- [ ] Create session → pick model (from available list) → send prompt → text/thinking/
      tool-call deltas stream live in ChatView.
- [ ] Token usage appears in ChatView footer and SessionList totals; `token_usage`
      rows exist in sqlite.
- [ ] Abort mid-stream stops the turn and persists the partial transcript.
- [ ] Resume: close app, reopen, session lists, open session → full transcript
      restored; sending a follow-up uses the restored history (verifiable by model
      referencing earlier context).
- [ ] Fork: forking session at message N creates a new session containing exactly
      messages ≤ N; both sessions independently promptable.
- [ ] Two sessions run concurrently and stream independently; aborting one leaves
      the other running.
- [ ] Plugin: enable bundled example plugin (registers a tool) → agent can call it
      in a prompt; disable → tool no longer offered; scoping works per workspace.
- [ ] Model picker shows providers + available models + auth status; entering an
      API key makes a provider's models available (runtime or persisted per choice).
- [ ] Settings (default model, thinking level) persist across restarts.
- [ ] No unhandled errors on: deleting a workspace with running sessions, plugin
      toggle while sessions run, network failure mid-stream.
- [ ] `bun run dev:hmr` workflow documented in README; app boots on a fresh clone
      (after `bun install`) with an existing `~/.pi/agent/auth.json`.

## 7. Explicitly out of scope (v1)

- pi JSONL session files / `SessionManager` file resume; tree branching UI
  (`navigateTree`, branch summaries); compaction with summaries.
- Worker-thread / subprocess agent isolation (single process for v1).
- Full OAuth login flows in-app; multi-user sync; telemetry.
- App signing/packaging beyond existing electrobun build scripts.
- Editing message history / manual transcript edits.
