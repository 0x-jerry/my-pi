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

## 8. Implementation status

**Done (agent + core + shared):**

| Package | Contents | Verified |
|---|---|---|
| `packages/shared` (`@my-pi/shared`) | JSON-RPC 2.0 protocol types/helpers (`parseRpcMessage`, error codes, builders, `RpcMethod`/`RpcEvent`), DTOs (Workspace, SessionInfo, StoredMessage, MessageRecord, TokenUsageRow, PluginInfo, Model/ProviderInfo…), PiAgentEvent/CoreEvent/InternalEvent unions | 12 unit tests |
| `packages/agent` (`@my-pi/agent`) | `PiAgent` (createAgentSession wrapper: in-memory SessionManager, compaction off, message restore), `ModelService` (ModelRuntime wrapper: providers/available/auth/api-key login), `buildResourceLoader` (noExtensions + app-managed plugin paths), pure event mapper + serializer (testable without a model), re-exports pi types | 13 unit tests incl. real plugin-file load through pi's loader |
| `packages/core` (`@my-pi/core`) | sqlite layer (WAL, user_version migrations, no FK enforcement; repos for workspaces/sessions/messages/token_usage/plugins/settings), services (workspace/session incl. fork+resume/settings/plugin registry w/ builtin example), AgentPool (lazy load, resume, status transitions), PersistenceWriter (idempotent suffix-diff, token ledger, rollups, run_end/message_end events), TranscriptReader, JsonRpcServer (`Bun.serve` ws, origin/token check, notifications, -32601/-32700 errors), `registerRpcMethods`, `CoreApp` (create/dispose, broadcaster w/ 50ms delta coalescing, orchestration: removeWorkspace/deleteSession/fork/sendMessage) | 31 unit tests; E2E smoke scripts `scripts/smoke.ts` (RPC round-trip) + `scripts/agent-smoke.ts` (real model run: prompt→events→persistence→ledger) |

Key bug caught by the E2E smoke: `CoreApp` field-initialized a second `EventBus` that shadowed the one wired to services — the broadcaster/listeners would have silently missed all events. Fixed (bus now injected via deps).

**Done: pi credentials in sqlite (§9).** `SqliteCredentialStore` (`packages/core/src/db/credential-store.ts`) implements pi-ai's `CredentialStore` over a new `credentials` table (migration #2, v1→v2 upgrade tested); per-provider async serialization for `modify`/`delete` (OAuth refresh-safe), `list()` serves metadata only; `ModelService.create({ credentialStore })` passes it to `ModelRuntime.create` (re-exports credential types from `packages/agent`); `CoreApp` wires it — pi never touches `~/.pi/agent/auth.json` (verified by mtime). `openDatabase` now chmods the db + WAL sidecars to 0600 (db holds secrets). | 15 new tests (store semantics incl. concurrency, repo, migration upgrade, ModelService wiring: login persists via pi's login flow, restart sees configured, runtime-only key not persisted, logout deletes) + E2E `scripts/creds-smoke.ts` (login→row→restart→logout, 0600 mode) |

**Next steps (not started):** app shell wiring (`packages/app/src/bun/index.ts` → `CoreApp.create` + WS URL query param), Vue UI (Step 7), parallel-agent scenario, hardening/README.


## 9. Follow-up task: pi credentials stored in sqlite

**Goal.** pi's provider credentials (API keys + OAuth tokens) live in the my-pi
sqlite database instead of `~/.pi/agent/auth.json`.

**Approach (verified against pi 0.84.1 sources).** pi exposes a first-class
extension point: `ModelRuntime.create({ credentials?: CredentialStore })` where
`CredentialStore` (from `@earendil-works/pi-ai`) has exactly four methods —
`read`, `list`, `modify`, `delete`. `ModelRuntime.login()` and OAuth refresh
persist via `credentials.modify(...)`; `logout` via `delete`; runtime-only keys
via an internal `RuntimeCredentials` overlay (in-memory, never persisted).
Today `ModelService.create()` passes no options, so pi falls back to the default
file `join(getAgentDir(), "auth.json")` = `~/.pi/agent/auth.json` (chmod 0600).
The task is therefore: implement a sqlite-backed `CredentialStore` and hand it
to `ModelRuntime.create` — pi keeps all auth orchestration; only the storage
backend is replaced. No RPC surface changes needed (`models.login` /
`models.logout` / `modelsSetApiKey` already flow through `ModelService`).

**Confirmed decisions (user Q&A):**
1. **No migration** of existing `~/.pi/agent/auth.json` — fresh start; users
   re-enter keys in the app. pi will never read that file again (supersedes
   §5 risk 6 and the §6 checklist line "existing `~/.pi/agent/auth.json`
   credentials work out of the box").
2. **auth.json left untouched** — not deleted, not renamed, never written.
3. **At-rest protection: parity with auth.json** — plaintext, db file chmod
   0600. No encryption / OS keychain.

### 9.1 Data model (migration #2 — `user_version` 1 → 2)

```sql
CREATE TABLE IF NOT EXISTS credentials (
  provider_id    TEXT PRIMARY KEY,      -- one credential per provider (pi invariant)
  type           TEXT NOT NULL,         -- 'api_key' | 'oauth' (denormalized for list())
  credential_json TEXT NOT NULL,        -- full Credential blob (ApiKeyCredential | OAuthCredential)
  updated_at     INTEGER NOT NULL
)
```

FKs stay OFF (app-managed, per §3.2). Storing the whole `Credential` JSON blob
covers both API keys (incl. per-provider `env`, e.g. Cloudflare account/gateway
ids) and OAuth tokens (refresh/access/expiry) without type-specific columns;
the `type` column exists only so `list()` can return `CredentialInfo` metadata
without touching secret material.

### 9.2 Files involved

| File | Change |
|---|---|
| `packages/core/src/db/schema.ts` | Append migration #2 (`credentials` table above). Existing DBs are at version 1 → upgrade in place. |
| `packages/core/src/db/connection.ts` | After open: `chmodSync(dbPath, 0o600)` (db now holds secrets; WAL sidecars inherit mode). |
| `packages/core/src/db/repos/credentials.ts` (new) | `CredentialsRepo`: `get/upsert/delete/list` (typed CRUD, no business logic); export from `repos/index.ts`. |
| `packages/core/src/db/credential-store.ts` (new) | `SqliteCredentialStore implements CredentialStore` (semantics below). |
| `packages/agent/src/model-service.ts` | `ModelServiceOptions` gains `credentialStore?: CredentialStore`; build `ModelRuntime.create` options explicitly (`{ credentials, authPath, modelsPath, allowModelNetwork }`) instead of spreading options. |
| `packages/agent/src/index.ts` | Re-export `CredentialStore`, `Credential`, `CredentialInfo`, `ApiKeyCredential`, `OAuthCredential`, `AuthOperationOptions` from pi-ai (core never imports pi packages directly). |
| `packages/core/src/app.ts` | `CoreApp.create()`: build `CredentialsRepo` + `SqliteCredentialStore`, pass to `ModelService.create({ credentialStore })`. |
| Tests | `db.test.ts` (table in migration list, idempotency), new `credential-store.test.ts` (store semantics), ModelService wiring test. |

### 9.3 Steps (ordered, each independently verifiable)

1. **Migration + repo (S).** Migration #2 in `schema.ts`; chmod 0600 in
   `connection.ts`; `CredentialsRepo` (`get/upsert/delete/list`) + export.
   Verify: `db.test.ts` extended — `credentials` in expected tables, migration
   from a v1 db upgrades to v2 without data loss, repo round-trip, upsert
   overwrite, delete idempotent, `list()` returns type but no secrets.
2. **`SqliteCredentialStore` (M).** Serialization is the only hard part: pi's
   contract requires mutual exclusion per provider, and OAuth refresh runs
   *inside* `modify` (network I/O) — so use one in-process async queue per
   provider (`Map<string, Promise<void>>` chain, mirroring pi's
   `InMemoryAuthStorageBackend.asyncChain`); do NOT wrap the async `fn` in a
   sqlite transaction. Semantics: `read` → parse blob, missing/corrupt →
   `undefined` (best-effort, no throw); `list` → type tags only; `modify` →
   serialized, fn sees current credential, `undefined` return leaves entry
   unchanged, fn rejections propagate without writing; `delete` → serialized
   against `modify`, idempotent. Single-process only (one my-pi process; note
   cross-process locking as future work).
   Verify: `credential-store.test.ts` — read missing → undefined; modify
   creates; fn sees current; `undefined` return = no change; concurrent
   `modify` for the same provider serialize (deferred-based order test);
   different providers don't block each other; delete idempotent; `list()`
   exposes no key material; corrupt blob → `undefined` without throwing.
3. **Agent wiring (S).** Re-export credential types; `ModelServiceOptions`
   gains `credentialStore`; explicit `ModelRuntime.create` options object.
   Verify: `bun run check` in agent + core; wiring test — `ModelService.create`
   with the store succeeds, `listCredentials()` empty on fresh store,
   `setRuntimeApiKey` → `hasConfiguredAuth` true but `store.read` still
   `undefined` (runtime overlay is not persisted).
4. **CoreApp wiring (S).** Build repo + store in `create()`, pass to
   `ModelService.create({ credentialStore })`. No RPC changes.
   Verify: `bun run check` + `bun test` green; `scripts/smoke.ts` still runs.
5. **Manual E2E (S).** `MY_PI_DB_PATH=/tmp/creds-test.db bun run dev`:
   login → row in `credentials`; restart → `authConfigured` true; auth.json
   never created/modified (hash before/after); `setRuntimeApiKey` not
   persisted across restart; logout → row deleted; db file mode `0600`
   (incl. `-wal` sidecar mode).

### 9.4 Risks & tricky parts

1. **`modify` serialization** — per-provider async queue; never hold a sqlite
   write across the network-bound `fn`. Concurrency test mandatory.
2. **Secrets now colocated with app data** — same posture as auth.json
   (plaintext, 0600) but in the main db → chmod 0600 in `connection.ts`;
   verify `-wal`/`-shm` sidecar modes.
3. **pi contract edge cases** — `modify` returning `undefined` = leave
   unchanged (login-during-refresh depends on it); fn throw → propagate, no
   write; corrupt stored JSON → degrade to "no credential", never crash boot
   availability checks.
4. **No key migration (declined)** — users with existing auth.json keys see
   `authConfigured: false` until they re-enter keys; README/UI note.
5. **OAuth works automatically** — whole blob stored; refresh rotation goes
   through `modify` under our lock; no extra work beyond the slow-`fn` test.
6. **Pinned pi API** — `CredentialStore` shape stable at 0.84.1; all pi
   imports stay confined to `packages/agent`.

### 9.5 Out of scope

- Migrating/importing `~/.pi/agent/auth.json` (declined) — file stops being
  read; left untouched.
- `models.json` catalog cache (`modelsPath`) — still file-based.
- Encryption at rest / OS keychain (declined — parity with auth.json).
- Cross-process credential locking, multi-user/keyring, credential rotation
  UI, `models.listCredentials` RPC (no consumer yet).

### 9.6 Verification checklist (definition of done)

- [ ] `bun install` clean; `bun run check` passes in `shared`, `agent`, `core`.
- [ ] `bun run test` passes — updated `db.test.ts` (credentials table,
      idempotency, v1→v2 upgrade), new `credential-store.test.ts` (full
      semantics incl. concurrency), ModelService wiring test (runtime keys not
      persisted).
- [ ] Manual (§9.3 step 5): login persists across restart via sqlite;
      `~/.pi/agent/auth.json` untouched/never written; runtime-only key not
      persisted; logout deletes the row; db file mode `0600`.
- [ ] No regressions in `scripts/smoke.ts` / `scripts/agent-smoke.ts` and the
      existing unit suite.

Effort: ~0.5d total; Step 9.3.2 (store semantics + tests) is the only
non-trivial piece.
