import { PiAgent, type AgentMessage } from "@my-pi/agent";
import type { PiAgentEvent } from "@my-pi/shared";
import { EventBus } from "../events/event-bus";
import { ModelService } from "@my-pi/agent";
import { SessionService } from "../sessions/session-service";
import { PluginService } from "../plugins/plugin-service";
import { WorkspaceService } from "../workspaces/workspace-service";

interface PoolEntry {
	piAgent: PiAgent;
	workspaceId: string;
	unsubscribe: () => void;
}

export interface AgentPoolDeps {
	bus: EventBus;
	modelService: ModelService;
	pluginService: PluginService;
	sessions: SessionService;
	workspaces: WorkspaceService;
}

/**
 * Holds one PiAgent per loaded session. Sessions load lazily on first send
 * (restoring the sqlite transcript) and stay loaded until stop/delete.
 */
export class AgentPool {
	private agents = new Map<string, PoolEntry>();
	/** In-flight loads keyed by sessionId; dedupes concurrent ensureRunning calls. */
	private loading = new Map<string, Promise<void>>();

	constructor(private deps: AgentPoolDeps) {}

	isLoaded(sessionId: string): boolean {
		return this.agents.has(sessionId);
	}

	/** Load the agent for a session if it isn't already running. */
	async ensureRunning(sessionId: string): Promise<void> {
		if (this.agents.has(sessionId)) return;
		const inflight = this.loading.get(sessionId);
		if (inflight) return inflight;
		const load = this.load(sessionId);
		this.loading.set(sessionId, load);
		try {
			await load;
		} finally {
			this.loading.delete(sessionId);
		}
	}

	private async load(sessionId: string): Promise<void> {
		const session = this.deps.sessions.get(sessionId);
		const workspace = this.deps.workspaces.get(session.workspaceId);
		const resume = this.deps.sessions.resumePayload(sessionId);
		const plugins = this.deps.pluginService.resolveForWorkspace(workspace.id);

		const piAgent = await PiAgent.create({
			cwd: workspace.path,
			modelService: this.deps.modelService,
			model:
				resume.modelProvider && resume.modelId
					? { provider: resume.modelProvider, id: resume.modelId }
					: undefined,
			thinkingLevel: resume.thinkingLevel,
			systemPrompt: session.systemPrompt,
			enabledPluginPaths: plugins.paths,
			bundledPlugins: plugins.factories,
			messages: resume.messages as AgentMessage[],
		});

		const unsubscribe = piAgent.on((event) =>
			this.handleAgentEvent(sessionId, event),
		);
		this.agents.set(sessionId, {
			piAgent,
			workspaceId: workspace.id,
			unsubscribe,
		});
	}

	async send(sessionId: string, text: string): Promise<void> {
		await this.ensureRunning(sessionId);
		const entry = this.requireEntry(sessionId);
		await entry.piAgent.prompt(text);
	}

	async steer(sessionId: string, text: string): Promise<void> {
		const entry = this.requireEntry(sessionId);
		await entry.piAgent.steer(text);
	}

	async followUp(sessionId: string, text: string): Promise<void> {
		const entry = this.requireEntry(sessionId);
		await entry.piAgent.followUp(text);
	}

	async abort(sessionId: string): Promise<void> {
		const entry = this.agents.get(sessionId);
		if (!entry) return;
		await entry.piAgent.abort();
	}

	/** Abort, dispose, and unload the agent for a session. */
	async stop(sessionId: string): Promise<void> {
		// If a load is in flight, wait for it to finish so the agent is disposed
		// cleanly instead of leaking (it will have been registered by then).
		const inflight = this.loading.get(sessionId);
		if (inflight) await inflight.catch(() => {});
		const entry = this.agents.get(sessionId);
		if (!entry) return;
		this.agents.delete(sessionId);
		entry.unsubscribe();
		await entry.piAgent.dispose();
		this.deps.sessions.updateStatus(sessionId, "stopped");
		this.deps.bus.emit({ type: "session.status", sessionId, status: "stopped" });
	}

	async disposeAll(): Promise<void> {
		for (const sessionId of [...this.agents.keys()]) {
			await this.stop(sessionId);
		}
	}

	private requireEntry(sessionId: string): PoolEntry {
		const entry = this.agents.get(sessionId);
		if (!entry) {
			throw new Error(`Session not loaded: ${sessionId}`);
		}
		return entry;
	}

	private handleAgentEvent(sessionId: string, event: PiAgentEvent): void {
		const bus = this.deps.bus;
		switch (event.type) {
			case "agent_start":
				bus.emit({ type: "session.status", sessionId, status: "running" });
				break;
			case "message_delta":
				bus.emit({
					type: "session.delta",
					sessionId,
					kind: event.kind,
					delta: event.delta,
				});
				break;
			case "tool_start":
				bus.emit({
					type: "session.tool_start",
					sessionId,
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					args: event.args,
				});
				break;
			case "tool_update":
				bus.emit({
					type: "session.tool_update",
					sessionId,
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					partialResult: event.partialResult,
				});
				break;
			case "tool_end":
				bus.emit({
					type: "session.tool_end",
					sessionId,
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					isError: event.isError,
					result: event.result,
				});
				break;
			case "settled":
				bus.emit({
					type: "session.status",
					sessionId,
					status: event.error ? "error" : "idle",
					error: event.error,
				});
				bus.emit({
					type: "session.settled",
					sessionId,
					messages: event.messages,
					error: event.error,
					aborted: event.aborted,
				});
				break;
		}
	}
}
