import { randomBytes } from "node:crypto";
import type { Database } from "bun:sqlite";
import type {
	CoreEvent,
	CreateSessionInput,
	CreateWorkspaceInput,
	SessionInfo,
	StoredMessage,
	TokenUsageRow,
	Workspace,
} from "@my-pi/shared";
import { ModelService } from "@my-pi/agent";
import { openDatabase } from "./db/connection";
import { migrate } from "./db/migrations";
import { SqliteCredentialStore } from "./db/credential-store";
import {
	CredentialsRepo,
	MessagesRepo,
	PluginsRepo,
	SessionsRepo,
	SettingsRepo,
	TokenUsageRepo,
	WorkspacesRepo,
} from "./db/repos";
import { EventBus } from "./events/event-bus";
import { SettingsService } from "./settings/settings-service";
import { WorkspaceService } from "./workspaces/workspace-service";
import { SessionService } from "./sessions/session-service";
import { TitleService } from "./sessions/title-service";
import { PluginService } from "./plugins/plugin-service";
import { builtinPlugins } from "./plugins/builtin";
import { AgentPool } from "./agents/agent-pool";
import { PersistenceWriter } from "./persistence/writer";
import { TranscriptReader } from "./persistence/reader";
import { JsonRpcServer } from "./rpc/server";
import { registerRpcMethods } from "./rpc/methods";

export interface CoreAppOptions {
	dbPath?: string;
	wsHost?: string;
	wsPort?: number;
	/**
	 * Token clients must present to connect to the RPC server. When omitted, a
	 * random per-launch token is generated and exposed as `app.wsToken`; pass
	 * an empty string to explicitly disable auth on the local socket.
	 */
	wsToken?: string;
	/** If set, only this Origin header may connect to the RPC server. */
	wsAllowedOrigin?: string;
	/**
	 * Native "pick a folder" dialog, provided by the shell. Returns the
	 * selected absolute path or null when the user cancels. When omitted,
	 * `dialogs.pickFolder` resolves to null (no dialog available).
	 */
	pickFolder?: () => Promise<string | null>;
}

/** Server→client notification methods (CoreEvent types). */
const PUBLIC_EVENTS: CoreEvent["type"][] = [
	"session.status",
	"session.delta",
	"session.tool_start",
	"session.tool_update",
	"session.tool_end",
	"session.message_end",
	"session.title_updated",
	"session.run_end",
	"workspace.updated",
];

const DELTA_COALESCE_MS = 50;

/**
 * Broadcasts core events to the connected view. Text deltas are coalesced per
 * (sessionId, kind); everything else is forwarded immediately.
 */
class Broadcaster {
	private buffers = new Map<
		string,
		{
			sessionId: string;
			kind: "text" | "thinking";
			delta: string;
			timer?: Timer;
		}
	>();

	constructor(
		private rpc: JsonRpcServer,
		private bus: EventBus,
	) {}

	start(): void {
		for (const type of PUBLIC_EVENTS) {
			this.bus.on(type, (event) => this.forward(event as CoreEvent));
		}
	}

	private forward(event: CoreEvent): void {
		if (event.type === "session.delta") {
			this.bufferDelta(event);
			return;
		}
		this.rpc.notify(event.type, event);
	}

	private bufferDelta(
		event: Extract<CoreEvent, { type: "session.delta" }>,
	): void {
		const key = `${event.sessionId}:${event.kind}`;
		let buffer = this.buffers.get(key);
		if (!buffer) {
			buffer = { sessionId: event.sessionId, kind: event.kind, delta: "" };
			buffer.timer = setTimeout(() => this.flush(key), DELTA_COALESCE_MS);
			buffer.timer.unref?.();
			this.buffers.set(key, buffer);
		}
		buffer.delta += event.delta;
	}

	private flush(key: string): void {
		const buffer = this.buffers.get(key);
		if (!buffer) return;
		this.buffers.delete(key);
		if (buffer.delta) {
			this.rpc.notify("session.delta", {
				sessionId: buffer.sessionId,
				kind: buffer.kind,
				delta: buffer.delta,
			});
		}
	}
}

/**
 * Top-level application object for the shell: owns the db, services, agent
 * pool, persistence, and the JSON-RPC server. The app shell only calls
 * create()/dispose() and reads wsPort/wsToken.
 */
export class CoreApp {
	readonly db: Database;
	readonly bus: EventBus;
	readonly settings: SettingsService;
	readonly workspaces: WorkspaceService;
	readonly sessions: SessionService;
	readonly plugins: PluginService;
	readonly modelService: ModelService;
	readonly pool: AgentPool;
	readonly reader: TranscriptReader;
	readonly titleService: TitleService;
	readonly rpc: JsonRpcServer;
	readonly wsToken: string;
	/** Native folder-picker hook supplied by the shell (see CoreAppOptions). */
	readonly pickFolder: (() => Promise<string | null>) | null;
	wsPort = 0;

	private broadcaster: Broadcaster;

	private constructor(deps: {
		db: Database;
		bus: EventBus;
		settings: SettingsService;
		workspaces: WorkspaceService;
		sessions: SessionService;
		plugins: PluginService;
		modelService: ModelService;
		pool: AgentPool;
		reader: TranscriptReader;
		titleService: TitleService;
		rpc: JsonRpcServer;
		writer: PersistenceWriter;
		wsToken: string;
		pickFolder: (() => Promise<string | null>) | null;
	}) {
		this.db = deps.db;
		this.bus = deps.bus;
		this.settings = deps.settings;
		this.workspaces = deps.workspaces;
		this.sessions = deps.sessions;
		this.plugins = deps.plugins;
		this.modelService = deps.modelService;
		this.pool = deps.pool;
		this.reader = deps.reader;
		this.titleService = deps.titleService;
		this.rpc = deps.rpc;
		this.wsToken = deps.wsToken;
		this.pickFolder = deps.pickFolder;
		this.broadcaster = new Broadcaster(deps.rpc, this.bus);
	}

	static async create(options: CoreAppOptions = {}): Promise<CoreApp> {
		const db = openDatabase(options.dbPath);
		migrate(db);
		// Default to a fresh per-launch secret so the RPC socket is never open
		// without auth; the shell passes app.wsToken to the renderer.
		const wsToken = options.wsToken ?? randomBytes(32).toString("hex");

		const bus = new EventBus();
		const settings = new SettingsService(new SettingsRepo(db));
		const plugins = new PluginService(new PluginsRepo(db), builtinPlugins());
		// pi provider credentials live in sqlite (credentials table); pi never
		// touches ~/.pi/agent/auth.json while a store is supplied.
		const modelService = await ModelService.create({
			credentialStore: new SqliteCredentialStore(new CredentialsRepo(db)),
		});
		const workspaces = new WorkspaceService(new WorkspacesRepo(db));

		const sessionsRepo = new SessionsRepo(db);
		const messagesRepo = new MessagesRepo(db);
		const usageRepo = new TokenUsageRepo(db);
		const sessions = new SessionService(
			sessionsRepo,
			messagesRepo,
			usageRepo,
			settings,
			new WorkspacesRepo(db),
		);
		const reader = new TranscriptReader(messagesRepo, usageRepo);
		const pool = new AgentPool({
			bus,
			modelService,
			pluginService: plugins,
			sessions,
			workspaces,
		});
		const writer = new PersistenceWriter({
			bus,
			messages: messagesRepo,
			usage: usageRepo,
			sessions: sessionsRepo,
		});
		const titleService = new TitleService(bus, sessions, modelService);
		const rpc = new JsonRpcServer({
			host: options.wsHost,
			port: options.wsPort,
			token: wsToken,
			allowedOrigin: options.wsAllowedOrigin,
		});

		const app = new CoreApp({
			db,
			bus,
			settings,
			workspaces,
			sessions,
			plugins,
			modelService,
			pool,
			reader,
			titleService,
			rpc,
			writer,
			wsToken,
			pickFolder: options.pickFolder ?? null,
		});

		registerRpcMethods(rpc, app);
		app.wsPort = await rpc.start();
		writer.start();
		app.titleService.start();
		app.broadcaster.start();
		return app;
	}

	// ---- orchestration (services + agent lifecycle) ----

	createWorkspace(input: CreateWorkspaceInput): Workspace {
		return this.workspaces.create(input);
	}

	async removeWorkspace(id: string): Promise<void> {
		const sessions = this.sessions.list(id);
		for (const s of sessions) await this.pool.stop(s.id);
		for (const s of sessions) this.sessions.remove(s.id);
		// Drop workspace-scoped plugin registrations too, or they'd survive as
		// orphans (and show up in plugins.list) after the workspace is gone.
		this.plugins.removeForWorkspace(id);
		this.workspaces.remove(id);
		this.bus.emit({ type: "workspace.updated", workspaceId: id });
	}

	createSession(input: CreateSessionInput): SessionInfo {
		return this.sessions.create(input);
	}

	async deleteSession(id: string): Promise<void> {
		await this.pool.stop(id);
		this.sessions.remove(id);
	}

	forkSession(id: string, uptoSeq?: number): SessionInfo {
		return this.sessions.fork(id, uptoSeq);
	}

	async sendMessage(sessionId: string, text: string): Promise<void> {
		await this.pool.send(sessionId, text);
	}

	getMessages(sessionId: string): StoredMessage[] {
		return this.reader.getMessages(sessionId);
	}

	getTokenUsage(sessionId: string): TokenUsageRow[] {
		return this.reader.getTokenUsage(sessionId);
	}

	async dispose(): Promise<void> {
		await this.pool.disposeAll();
		await this.rpc.stop();
		this.db.close();
	}
}
