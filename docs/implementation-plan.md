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

## 2. Current state (verified 2025-08, HEAD `2458271`)

- Monorepo: Bun workspaces `packages/{shared,agent,core,app}`. **`shared`, `agent`,
  `core` are complete and green** — `bun run check` (tsc --noEmit) passes in all
  three; `bun run test` passes **80 tests, 0 fail** (shared 14 / agent 13 / core 53).
- `packages/app` is still the **ElectroBun + Vue 3 demo counter**: `src/bun/index.ts`
  only opens a BrowserWindow (no `CoreApp`), `src/mainview/App.vue` is the demo UI.
  `packages/app/package.json` does **not** depend on `@my-pi/core`/`@my-pi/shared` yet.
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

**What remains:** app shell wiring (§4 Step 6), the entire Vue UI (§4 Step 7), a
pool-level concurrency test (§4 Step 8), hardening + README (§4 Step 9).

## 3. Architecture

### 3.1 Package layout

```
packages/
  shared/  NEW (done). Protocol types/helpers + DTOs shared by core (server) and
           app (client). No runtime deps.
  app/     Thin ElectroBun shell (exists) + **all UI code** (Vue frontend in
           src/mainview, incl. the JSON-RPC client wrapper). Backend here only boots
           `CoreApp` (from core) and opens the BrowserWindow. NO business logic.
  core/    DONE. All backend application code: sqlite data layer, workspace/session
           services, agent pool, event bus, persistence, plugin registry, model/auth
           service, settings, WebSocket JSON-RPC server.
  agent/   DONE. Thin wrapper around pi SDK: one PiAgent = one pi AgentSession.
           Converts pi events → app events; owns config assembly (loader, settings).
```

Dependency direction: `app → core → agent → @earendil-works/pi-coding-agent`.
Shared DTOs + JSON-RPC protocol **types** live in `shared`; the JSON-RPC **client
implementation** is UI-side code and lives in `app` (Step 7).

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

The app shell only starts `CoreApp` (which boots the WS server), appends the WS
URL (`ws://127.0.0.1:<port>`) + token to the view URL, and opens the window. The
view connects with its own JSON-RPC client (in `app`, built on `@my-pi/shared`).
```

Event flow for one prompt: `chat.send(sessionId, text)` → SessionService → AgentPool →
PiAgent.prompt(); pi events → app events → EventBus → PersistenceWriter (settle-point
suffix-diff + rollups) and the JSON-RPC broadcaster (notifications to the view).

## 4. Remaining steps (ordered, each independently verifiable)

Effort: S ≤0.5d, M ≤1d, L ≤2d. (Steps 0–5 of the original plan — shared protocol,
sqlite layer, core services, agent wrapper, pool/persistence, plugin service + RPC
server, CoreApp — are **done**, see §8.)

### Step 6 — App shell wiring  (S)
- `packages/app/package.json` — add deps `"@my-pi/core": "workspace:*"`,
  `"@my-pi/shared": "workspace:*"`; `bun install`.
- `packages/app/src/bun/index.ts` — replace body:
  - `const app = await CoreApp.create({ wsPort: 0 })` (db defaults to `~/.my-pi/my-pi.db`).
  - Append `?ws=<app.wsPort>&token=<encodeURIComponent(app.wsToken)>` to the view URL
    in **both** branches of `getMainViewUrl()` (dev-server URL and `views://` URL).
    (Keep the `?ws`/`?token` as query params; the subprotocol remains the primary auth
    transport — the query token is a fallback the server already supports. Keep the
    URL itself free of the secret where possible.)
  - Window: keep title/size; pass the modified URL to `BrowserWindow`.
  - Process lifecycle: on SIGINT/SIGTERM `await app.dispose(); process.exit(0)`.
- **Verify early (de-risks everything downstream):** `bun run dev` boots the window;
  in the view, `new URLSearchParams(location.search)` yields `ws` + `token`;
  `new WebSocket(wsUrl, token)` connects and a `workspaces.list` call round-trips
  (temporary console.log / tiny test hook in the view). This proves query-param
  survival on `views://` (dev uses `http://localhost:5173/...`, which definitely
  works) and subprotocol auth inside the CEF webview.

### Step 7 — Vue frontend  (L)
All under `packages/app/src/mainview/`, importing types from `@my-pi/shared` only.

- `rpc/client.ts` — `RpcClient`: `call<T>(method, params)` (pending map keyed by
  incrementing id; rejects on JSON-RPC error), `on(event, cb)` notification registry,
  auto-reconnect with backoff (0.5s → 5s), `refreshAll()` callback invoked on
  (re)connect so the store re-syncs, `close()`.
- `store.ts` — reactive store + actions:
  - State: `workspaces`, `activeWorkspaceId`, `sessions` (per workspace), `activeSessionId`,
    `messages` (per session), per-session `streaming` (`{status, error, textBuf,
    thinkingBuf, activeTool}`), last-run `usage`, `providers`, `models` (per provider),
    `auth` (per provider), `plugins`, `settings`.
  - Actions wrap the RPC methods above; after mutating calls that emit no event
    (`sessions.create/delete/fork`, `plugins.*`, `settings.*`), refetch the affected
    list (the server only pushes `workspace.updated`, `session.status/delta/tool_*/
    message_end/run_end`).
  - Notification handlers: `session.status` → status/error; `session.delta` → append
    to text/thinking buffer (batch renders with `nextTick`); `session.tool_start/
    update/end` → active tool state; `session.message_end` → append `StoredMessage`;
    `session.run_end` → reconcile transcript (dedupe by `StoredMessage.id`
    `m-<sid>-<seq>` — makes `message_end` + `run_end` idempotent), set usage, clear
    streaming; `workspace.updated` → refetch workspaces.
- Views (simple `ref`-based panel switching in `App.vue`; no vue-router for v1):
  - `WorkspaceSidebar.vue` — create (name + dir path; surface validation errors),
    list, open (set active + load sessions), remove (confirm; handles running sessions).
  - `SessionList.vue` — sessions of the active workspace: status dot, title, token/cost
    totals; create (title + model + thinking level); open; fork at message N; delete.
  - `ChatView.vue` — message list (user / assistant text; collapsible thinking; tool
    calls with name/args/result/error state; base64 images as data URIs); streaming
    buffers appended live; input (send; steer/followUp wired to RPC, exposed as
    secondary actions); abort button while running; footer with last-run usage.
  - `ModelPicker.vue` — providers with auth status; pick provider → `models.available`;
    choose model; API-key entry (`models.login`) + logout; used by session creation and
    default-model setting.
  - `PluginsPanel.vue` — `plugins.list(workspaceId)` + global; enable/disable; add by
    path. Note in UI: enabling/disabling applies to sessions loaded **after** the
    toggle (loader is built at agent load).
  - `SettingsPanel.vue` — default model, default thinking level (`settings.get/set`).
- `packages/app/package.json` — change `check` to `vue-tsc --noEmit` (tsc can't
  type-check SFC bodies; vue-tsc is already a devDep).
- Verify: `bun run --cwd packages/app check` and `vite build` pass; full manual
  scenario checklist (§6) in dev mode.

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

## 5. Risks & tricky parts (remaining work)

1. **WS config reaching the view.** Query params on `views://` URLs are unverified —
   **de-risk in Step 6** before building UI. Fallbacks if dropped: dev server URL
   (works), or a fixed port + token file read by the view. Subprotocol auth
   (`new WebSocket(url, token)`) must be confirmed inside the CEF webview; the
   server already supports `?token=` as fallback.
2. **Streaming render performance.** Deltas are coalesced ~50ms server-side; ChatView
   should append to string buffers and flush with `nextTick` rather than re-rendering
   full arrays per delta; transcripts can be long.
3. **Store sync after mutations.** `sessions.create/delete/fork` and `plugins.*` /
   `settings.*` return results but push no events (except `workspace.updated`) — the
   UI must refetch after each mutation. `session.run_end` is the transcript reconcile
   point; dedupe by message id.
4. **Reconnect semantics.** On WS drop: backoff reconnect, `refreshAll()` on open,
   surface "reconnecting" state; an in-flight `chat.send` must surface an error to the
   user rather than silently dropping.
5. **`tsc` can't check SFC bodies** — switch the app `check` script to `vue-tsc
   --noEmit` (already a devDep); keep the `*.vue` shim for editor tooling.
6. **Plugin toggles only affect newly loaded sessions** — loader config is fixed at
   agent load in `AgentPool.load`; the PluginsPanel must say so (toggle = restart the
   session) to avoid "why isn't my tool available" confusion.
7. **Large messages / images in sqlite.** `data_json` stores base64 as-is; ChatView
   renders them as data URIs. Acceptable for v1; externalize blobs later.
8. **Plaintext localhost WS.** Mitigated in core (127.0.0.1 bind, origin check,
   random per-launch token, single-connection). Keep the token out of URLs where
   possible (subprotocol preferred; `?token=` only as fallback).
9. **Process lifecycle.** Ensure `app.dispose()` (stop agents, close WS, close db)
   runs on window/app exit to avoid sqlite lock residue and orphan agent processes.

## 6. Verification checklist (definition of done — remaining)

- [ ] `bun run check` passes in all four packages (app via vue-tsc); `bun run test`
      green (shared/agent/core).
- [ ] App boots (`bun run dev` and `bun run dev:hmr`); view connects over WS with the
      subprotocol token; a `workspaces.list` round-trip succeeds (workspaces render).
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
- [ ] README works on a fresh clone (`bun install` → boot); smoke scripts still run.

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

Total: **80 tests, 0 fail**; `tsc --noEmit` clean in shared/agent/core. E2E smokes
`scripts/{smoke,agent-smoke,creds-smoke}.ts` run. Key bug caught by E2E: `CoreApp`
field-initialized a second `EventBus` that shadowed the wired one (broadcaster/listeners
would have missed all events) — fixed via dependency injection.

**Credentials (§9 of the old plan — DONE):** pi credentials live in the sqlite
`credentials` table (migration #2, v1→v2 upgrade tested) via `SqliteCredentialStore`
implementing pi-ai's `CredentialStore`; pi never touches `~/.pi/agent/auth.json`
(mtime-verified). No RPC surface change; `models.login/logout/setApiKey` flow through
`ModelService` unchanged. Semantics: per-provider async serialization (OAuth refresh
safe), `modify` returning `undefined` leaves entry unchanged, runtime-only keys never
persisted, corrupt blob degrades to "no credential".

**Not started (this plan's remaining steps):** app shell wiring (Step 6), Vue UI
(Step 7), pool-level concurrency test + manual dual-chat (Step 8), hardening + README
(Step 9).
