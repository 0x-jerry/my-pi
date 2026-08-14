import {
	createAgentSession,
	getAgentDir,
	SessionManager,
	SettingsManager,
	type AgentSession,
	type AgentSessionEvent,
	type InlineExtension,
} from "@earendil-works/pi-coding-agent";
import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { PiAgentEvent } from "@my-pi/shared";
import { buildResourceLoader } from "./resource-loader";
import { mapAgentSessionEvent } from "./mapper";
import { ModelService } from "./model-service";

export interface PiAgentConfig {
	/** Working directory the agent operates in (the workspace dir). */
	cwd: string;
	/** Global pi config dir (default: ~/.pi/agent). */
	agentDir?: string;
	modelService: ModelService;
	/** Model to use, resolved from provider/id. */
	model?: { provider: string; id: string };
	thinkingLevel?: ThinkingLevel;
	systemPrompt?: string;
	/** Plugin extension files to load (absolute paths). */
	enabledPluginPaths?: string[];
	/** Bundled plugin factories to load. */
	bundledPlugins?: InlineExtension[];
	tools?: string[];
	/** Restored transcript for session resume. */
	messages?: AgentMessage[];
}

/**
 * One PiAgent = one pi AgentSession.
 * Runs with an in-memory SessionManager (sqlite is the app's source of truth),
 * compaction disabled, and app-controlled plugin loading.
 */
export class PiAgent {
	readonly session: AgentSession;
	private readonly _listeners = new Set<(event: PiAgentEvent) => void>();
	private _aborted = false;
	private _disposed = false;

	private constructor(session: AgentSession) {
		this.session = session;
	}

	static async create(config: PiAgentConfig): Promise<PiAgent> {
		const agentDir = config.agentDir ?? getAgentDir();
		const loader = buildResourceLoader({
			cwd: config.cwd,
			agentDir,
			enabledPluginPaths: config.enabledPluginPaths,
			bundledPlugins: config.bundledPlugins,
			systemPrompt: config.systemPrompt,
		});
		await loader.reload();

		const model = config.model
			? (config.modelService.getModel(config.model.provider, config.model.id) ??
				undefined)
			: undefined;

		const { session } = await createAgentSession({
			cwd: config.cwd,
			agentDir,
			model,
			thinkingLevel: config.thinkingLevel,
			modelRuntime: config.modelService.runtime,
			sessionManager: SessionManager.inMemory(config.cwd),
			settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
			resourceLoader: loader,
			tools: config.tools,
		});

		if (config.messages && config.messages.length > 0) {
			session.agent.state.messages = config.messages;
		}

		const agent = new PiAgent(session);
		session.subscribe((event) => agent._handleEvent(event));
		return agent;
	}

	private _handleEvent(event: AgentSessionEvent): void {
		if (this._disposed) return;
		const mapped = mapAgentSessionEvent(event, {
			aborted: () => this._aborted,
			getMessages: () => this.session.agent.state.messages,
		});
		for (const e of mapped) this._emit(e);
	}

	on(listener: (event: PiAgentEvent) => void): () => void {
		this._listeners.add(listener);
		return () => {
			this._listeners.delete(listener);
		};
	}

	private _emit(event: PiAgentEvent): void {
		for (const listener of [...this._listeners]) listener(event);
	}

	get messages(): AgentMessage[] {
		return this.session.agent.state.messages;
	}

	get isStreaming(): boolean {
		return this.session.isStreaming;
	}

	get isIdle(): boolean {
		return this.session.isIdle;
	}

	/** Send a prompt; throws if the agent is currently streaming. */
	async prompt(text: string): Promise<void> {
		if (this._disposed) throw new Error("Agent is disposed");
		if (this.session.isStreaming) {
			throw new Error("Agent is busy; use steer() or followUp()");
		}
		this._aborted = false;
		await this.session.prompt(text);
	}

	async steer(text: string): Promise<void> {
		await this.session.steer(text);
	}

	async followUp(text: string): Promise<void> {
		await this.session.followUp(text);
	}

	async abort(): Promise<void> {
		this._aborted = true;
		await this.session.abort();
	}

	setThinkingLevel(level: ThinkingLevel): void {
		this.session.setThinkingLevel(level);
	}

	async dispose(): Promise<void> {
		if (this._disposed) return;
		this._disposed = true;
		this._listeners.clear();
		this.session.dispose();
	}
}
