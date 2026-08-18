# my-pi

A desktop app that manages multiple parallel pi-based agent sessions across
workspaces. Built on **ElectroBun** (shell), **Vue 3** (frontend) and **Bun**
(backend), with **sqlite** as the source of truth for workspaces, sessions,
messages and token usage, and a plugin system built on pi's extension mechanism.

The UI talks to the core backend over **JSON-RPC 2.0 over WebSocket**. The app
package is a thin shell — all business logic lives in `packages/core`.

## Prerequisites

- [Bun](https://bun.sh) (recent 1.x)
- A way to open an ElectroBun window is bundled; package tooling ships via
  `bun install` (no global install required).

## Getting started

```bash
bun install
bun run dev        # packaged-mode dev (ElectroBun window + vite build)
bun run dev:hmr    # hot-module-reload dev (vite on :5173 + electrobun)
```

Then:

- **Create a workspace** pointing at a directory on disk — each workspace is just
  a directory, and agents run with that directory as their working directory.
- **Add a session** and pick a model. Enter an API key for your provider when
  prompted (see Credentials below).
- **Chat** in the session; text/thinking/tool deltas stream live. Abort stops the
  current turn. Sessions can be resumed after a restart and forked at any message.

> `agent-smoke` (an E2E script) skips when no model credentials are configured —
> configure a provider in the app first if you want live model runs.

## Architecture

Bun workspaces in `packages/`:

```
shared/   Protocol types/helpers + DTOs shared by the core server and the UI client.
          Zero runtime dependencies.
agent/    Thin wrapper around the pi SDK. One PiAgent = one pi AgentSession
          (in-memory SessionManager; sqlite is the source of truth). Converts pi
          events → app events and assembles config (resource loader, settings,
          credentials). All pi imports are confined here.
core/     All backend logic: sqlite data layer (WAL, migrations), workspace/session
          services, the agent pool, event bus, persistence writer, plugin registry,
          model/auth service, settings, and the WebSocket JSON-RPC server (CoreApp).
app/      Thin ElectroBun shell + all UI code (Vue 3 + Vue Router + element-plus).
          Backend here only boots CoreApp and opens the window. NO business logic.
```

Dependency direction: `app → core → agent → @earendil-works/pi-coding-agent`.

```
Vue view ──JSON-RPC 2.0 over WebSocket (subprotocol token)──▶ core (CoreApp)
     ▲                                        │   CoreApp
     └──JSON-RPC notifications (events)───────┤    ├─ JsonRpcServer (Bun.serve ws)
                                              │    ├─ WorkspaceService
                                              │    ├─ SessionService (create/fork/resume/delete)
                                              │    ├─ AgentPool        (running PiAgents)
                                              │    ├─ PersistenceWriter (sqlite)
                                              │    ├─ PluginService
                                              │    ├─ ModelService
                                              │    └─ SettingsService
                                              └── AgentPool ──▶ N × PiAgent ──▶ pi SDK
```

- **RPC surface** (`@my-pi/shared`): ~25 methods (workspaces / sessions / chat /
  models / plugins / settings) plus 8 server→client event notifications.
  The server binds `127.0.0.1:<port>` at `/ws`; auth is via the WebSocket
  subprotocol token (or `?token=` in dev), with a random per-launch secret.
- **Data**: sqlite at `~/.my-pi/my-pi.db` (override with `MY_PI_DB_PATH`), WAL
  mode, `user_version` migrations (v2). `messages` store full opaque pi message
  blobs (`data_json`, images stay base64); `token_usage` is the audit ledger, with
  denormalized rollups on `sessions` for cheap list views.

## Plugins

Plugins are **pi extensions**. You can:

- Enable/disable built-in example plugins per workspace from the **Plugins**
  settings panel, and
- Add plugins **by path** (a directory containing a pi extension `SKILL.md` or
  `plugin.ts`) — the path is stored in sqlite and loaded through the agent's
  resource loader.

> A plugin's loader config is fixed when an agent loads, so toggling a plugin only
> affects sessions that are (re)started afterwards — the UI shows a reminder to
> restart the session.

## Credentials

Provider credentials live in the sqlite `credentials` table (migration #2), not in
pi's `~/.pi/agent/auth.json`. `~/.pi/agent/auth.json` is never read or written by
the app. When you first add a provider, enter your **API key in the app** (or use
the built-in token login); OAuth refresh continues to be handled by pi
automatically.

## Scripts

- `bun run check` — type-check all four packages (app uses `vue-tsc`).
- `bun run test` — run all package test suites (shared/agent/core via bun:test,
  app via vitest).

## Development notes

- The packaged `views://` URL scheme rejects query strings and hash fragments, so
  the shell delivers the WebSocket config by injecting
  `window.__MY_PI_WS_CONFIG__` via `executeJavascript`; the view polls for it up to
  8s. In dev, the URL carries `?ws=<port>&token=<secret>` instead.
- Sqlite keeps WAL and `PRAGMA foreign_keys` **off**; referential integrity and
  cascading deletes are handled in application code.
