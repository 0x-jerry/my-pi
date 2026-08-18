import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PiAgent, PiAgentConfig } from "@my-pi/agent";
import type { PiAgentEvent } from "@my-pi/shared";
import { ModelService } from "@my-pi/agent";
import { openDatabase } from "../src/db/connection";
import { migrate } from "../src/db/migrations";
import {
	MessagesRepo,
	PluginsRepo,
	SettingsRepo,
	SessionsRepo,
	TokenUsageRepo,
	WorkspacesRepo,
} from "../src/db/repos";
import { EventBus } from "../src/events/event-bus";
import { SettingsService } from "../src/settings/settings-service";
import { WorkspaceService } from "../src/workspaces/workspace-service";
import { SessionService } from "../src/sessions/session-service";
import { PluginService } from "../src/plugins/plugin-service";
import { builtinPlugins } from "../src/plugins/builtin";
import { AgentPool } from "../src/agents/agent-pool";

/** Minimal controllable fake agent exposing the PiAgent surface the pool uses. */
class FakeAgent {
	prompts: string[] = [];
	steers: string[] = [];
	followUps: string[] = [];
	aborted = 0;
	disposed = false;
	private listeners = new Set<(e: PiAgentEvent) => void>();

	on(listener: (e: PiAgentEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async prompt(text: string): Promise<void> {
		this.prompts.push(text);
	}

	async steer(text: string): Promise<void> {
		this.steers.push(text);
	}

	async followUp(text: string): Promise<void> {
		this.followUps.push(text);
	}

	async abort(): Promise<void> {
		this.aborted += 1;
	}

	async dispose(): Promise<void> {
		this.disposed = true;
	}

	emit(event: PiAgentEvent): void {
		for (const l of [...this.listeners]) l(event);
	}
}

let dir: string;
let db: ReturnType<typeof openDatabase>;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "my-pi-pool-"));
	db = openDatabase(join(dir, "test.db"));
	migrate(db);
});

afterEach(() => {
	db.close();
	rmSync(dir, { recursive: true, force: true });
});

function setup() {
	const bus = new EventBus();
	const settings = new SettingsService(new SettingsRepo(db));
	const plugins = new PluginService(new PluginsRepo(db), builtinPlugins());
	const workspaces = new WorkspaceService(new WorkspacesRepo(db));
	const sessions = new SessionService(
		new SessionsRepo(db),
		new MessagesRepo(db),
		new TokenUsageRepo(db),
		settings,
		new WorkspacesRepo(db),
	);

	const agents = new Map<string, FakeAgent>();
	const created: Array<{ sessionId: string; config: PiAgentConfig }> = [];
	const pool = new AgentPool({
		bus,
		modelService: {} as ModelService,
		pluginService: plugins,
		sessions,
		workspaces,
		agentFactory: async (sessionId, config) => {
			created.push({ sessionId, config });
			const agent = new FakeAgent();
			agents.set(sessionId, agent);
			return agent as unknown as PiAgent;
		},
	});

	const ws = workspaces.create({ name: "ws", path: dir });
	function makeSession(): string {
		return sessions.create({
			workspaceId: ws.id,
			model: { provider: "anthropic", id: "claude" },
		}).id;
	}

	return { bus, pool, agents, created, sessions, makeSession };
}

describe("AgentPool (parallel agents)", () => {
	test("concurrent send on different sessions reaches distinct agents", async () => {
		const { pool, agents, makeSession } = setup();
		const s1 = makeSession();
		const s2 = makeSession();

		await Promise.all([pool.send(s1, "hello one"), pool.send(s2, "hello two")]);

		const a1 = agents.get(s1);
		const a2 = agents.get(s2);
		expect(a1).toBeDefined();
		expect(a2).toBeDefined();
		expect(a1).not.toBe(a2);
		expect(a1!.prompts).toContain("hello one");
		expect(a2!.prompts).toContain("hello two");
		expect(a1!.prompts).not.toContain("hello two");
		expect(pool.isLoaded(s1)).toBe(true);
		expect(pool.isLoaded(s2)).toBe(true);
	});

	test("agentFactory is invoked only once per session (lazy load)", async () => {
		const { pool, agents, created, makeSession } = setup();
		const s1 = makeSession();
		await pool.send(s1, "a");
		await pool.send(s1, "b"); // already loaded
		expect(created).toHaveLength(1);
		expect(created[0].sessionId).toBe(s1);
		expect(agents.get(s1)!.prompts).toEqual(["a", "b"]);
	});

	test("stop emits session.status stopped and disposes only that agent", async () => {
		const { bus, pool, agents, sessions, makeSession } = setup();
		const s1 = makeSession();
		const s2 = makeSession();
		await Promise.all([pool.send(s1, "a"), pool.send(s2, "b")]);

		const stopped: string[] = [];
		bus.on("session.status", (e) => {
			if (e.status === "stopped") stopped.push(e.sessionId);
		});

		await pool.stop(s1);

		expect(stopped).toEqual([s1]);
		expect(agents.get(s1)!.disposed).toBe(true);
		expect(agents.get(s2)!.disposed).toBe(false);
		expect(pool.isLoaded(s1)).toBe(false);
		expect(pool.isLoaded(s2)).toBe(true);
		expect(sessions.get(s1).status).toBe("stopped");
	});

	test("abort affects only its own session", async () => {
		const { pool, agents, makeSession } = setup();
		const s1 = makeSession();
		const s2 = makeSession();
		await Promise.all([pool.send(s1, "a"), pool.send(s2, "b")]);

		await pool.abort(s1);

		expect(agents.get(s1)!.aborted).toBe(1);
		expect(agents.get(s2)!.aborted).toBe(0);
		expect(agents.get(s2)!.disposed).toBe(false);
	});

	test("status transitions running → idle are emitted from agent events", async () => {
		const { bus, pool, agents, makeSession } = setup();
		const s1 = makeSession();
		const statuses: Array<[string, string]> = [];
		bus.on("session.status", (e) => statuses.push([e.sessionId, e.status]));

		await pool.send(s1, "a");
		const agent = agents.get(s1)!;

		agent.emit({ type: "agent_start" });
		expect(statuses).toContainEqual([s1, "running"]);

		agent.emit({ type: "message_delta", kind: "text", delta: "hi" });

		agent.emit({ type: "settled", messages: [], error: undefined, aborted: false });
		expect(statuses.at(-1)).toEqual([s1, "idle"]);
	});

	test("settled with an error emits status error and a settled event", async () => {
		const { bus, pool, agents, makeSession } = setup();
		const s1 = makeSession();
		await pool.send(s1, "a");
		const agent = agents.get(s1)!;

		const settled: unknown[] = [];
		const errored: Array<{ sessionId: string; status: string }> = [];
		bus.on("session.settled", (e) => settled.push(e));
		bus.on("session.status", (e) => {
			if (e.status === "error")
				errored.push({ sessionId: e.sessionId, status: e.status });
		});

		agent.emit({ type: "settled", messages: [], error: "boom", aborted: false });

		expect(errored).toContainEqual({ sessionId: s1, status: "error" });
		expect(settled).toHaveLength(1);
		expect((settled[0] as { error: string }).error).toBe("boom");
	});

	test("steer and followUp route to the loaded agent", async () => {
		const { pool, agents, makeSession } = setup();
		const s1 = makeSession();
		await pool.send(s1, "a");
		const agent = agents.get(s1)!;

		await pool.steer(s1, "go left");
		await pool.followUp(s1, "more");

		expect(agent.steers).toContain("go left");
		expect(agent.followUps).toContain("more");
	});
});

