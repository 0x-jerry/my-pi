import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { StoredMessage } from "@my-pi/shared";
import { ModelService } from "@my-pi/agent";
import { openDatabase } from "../src/db/connection";
import { migrate } from "../src/db/migrations";
import {
	MessagesRepo,
	SessionsRepo,
	SettingsRepo,
	TokenUsageRepo,
	WorkspacesRepo,
} from "../src/db/repos";
import { EventBus } from "../src/events/event-bus";
import { SettingsService } from "../src/settings/settings-service";
import { WorkspaceService } from "../src/workspaces/workspace-service";
import { SessionService } from "../src/sessions/session-service";
import { TitleService } from "../src/sessions/title-service";

let dir: string;
let db: ReturnType<typeof openDatabase>;
let settings: SettingsService;
let workspaces: WorkspaceService;
let sessions: SessionService;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "my-pi-svc-"));
	db = openDatabase(join(dir, "test.db"));
	migrate(db);
	settings = new SettingsService(new SettingsRepo(db));
	workspaces = new WorkspaceService(new WorkspacesRepo(db));
	sessions = new SessionService(
		new SessionsRepo(db),
		new MessagesRepo(db),
		new TokenUsageRepo(db),
		settings,
		new WorkspacesRepo(db),
	);
});

afterEach(() => {
	db.close();
	rmSync(dir, { recursive: true, force: true });
});

describe("WorkspaceService", () => {
	test("creates a workspace for an existing directory", () => {
		const ws = workspaces.create({ name: "My Project", path: dir });
		expect(ws.path).toBe(dir);
		expect(ws.name).toBe("My Project");
		expect(workspaces.list()).toHaveLength(1);
		expect(workspaces.get(ws.id).id).toBe(ws.id);
	});

	test("defaults name to the directory basename", () => {
		const ws = workspaces.create({ name: "  ", path: dir });
		expect(ws.name).toBe(basename(dir));
	});

	test("rejects non-directory paths", () => {
		expect(() =>
			workspaces.create({ name: "x", path: join(dir, "nope") }),
		).toThrow(/Not a directory/);
	});

	test("rejects duplicate paths", () => {
		workspaces.create({ name: "a", path: dir });
		expect(() => workspaces.create({ name: "b", path: dir })).toThrow(
			/already exists/,
		);
	});

	test("remove deletes the workspace", () => {
		const ws = workspaces.create({ name: "a", path: dir });
		workspaces.remove(ws.id);
		expect(workspaces.list()).toHaveLength(0);
	});
});

describe("SessionService", () => {
	test("create resolves chat model from settings", () => {
		settings.set("chatModel", { provider: "anthropic", id: "claude-opus" });
		settings.set("defaultThinkingLevel", "high");
		const ws = workspaces.create({ name: "a", path: dir });
		const session = sessions.create({ workspaceId: ws.id });
		expect(session.modelProvider).toBe("anthropic");
		expect(session.modelId).toBe("claude-opus");
		expect(session.thinkingLevel).toBe("high");
		expect(session.status).toBe("idle");
		expect(sessions.list(ws.id)).toHaveLength(1);
	});

	test("explicit model overrides settings", () => {
		settings.set("chatModel", { provider: "anthropic", id: "claude-opus" });
		const ws = workspaces.create({ name: "a", path: dir });
		const session = sessions.create({
			workspaceId: ws.id,
			model: { provider: "openai", id: "gpt-5" },
		});
		expect(session.modelId).toBe("gpt-5");
	});

	test("updateModel overrides the model for one session", () => {
		const ws = workspaces.create({ name: "a", path: dir });
		const session = sessions.create({
			workspaceId: ws.id,
			model: { provider: "openai", id: "gpt-5" },
		});
		const updated = sessions.updateModel(session.id, {
			provider: "anthropic",
			id: "claude-4",
		});
		expect(updated.modelProvider).toBe("anthropic");
		expect(updated.modelId).toBe("claude-4");
		expect(sessions.get(session.id).modelId).toBe("claude-4");
	});

	test("resumePayload returns stored transcript", () => {
		const ws = workspaces.create({ name: "a", path: dir });
		const session = sessions.create({ workspaceId: ws.id });
		// Simulate persisted messages.
		const repo = new MessagesRepo(db);
		repo.insertMany([
			{
				id: `m-${session.id}-1`,
				sessionId: session.id,
				seq: 1,
				role: "user",
				dataJson: JSON.stringify({ role: "user", content: "hi", timestamp: 1 }),
				createdAt: 1,
			},
		]);
		const payload = sessions.resumePayload(session.id);
		expect(payload.messages).toHaveLength(1);
		expect((payload.messages[0] as { content: string }).content).toBe("hi");
	});

	test("fork copies the message prefix with provenance", () => {
		const ws = workspaces.create({ name: "a", path: dir });
		const session = sessions.create({ workspaceId: ws.id });
		const repo = new MessagesRepo(db);
		repo.insertMany([
			{
				id: `m-${session.id}-1`,
				sessionId: session.id,
				seq: 1,
				role: "user",
				dataJson: JSON.stringify({ role: "user", content: "m1", timestamp: 1 }),
				createdAt: 1,
			},
			{
				id: `m-${session.id}-2`,
				sessionId: session.id,
				seq: 2,
				role: "assistant",
				model: "m",
				provider: "p",
				usageJson: JSON.stringify({
					input: 1,
					output: 2,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 3,
					cost: 0.05,
				}),
				dataJson: "{}",
				createdAt: 2,
			},
			{
				id: `m-${session.id}-3`,
				sessionId: session.id,
				seq: 3,
				role: "user",
				dataJson: JSON.stringify({ role: "user", content: "m3", timestamp: 3 }),
				createdAt: 3,
			},
		]);
		const usage = new TokenUsageRepo(db);
		usage.insertMany([
			{
				sessionId: session.id,
				messageId: `m-${session.id}-2`,
				kind: "assistant",
				input: 1,
				output: 2,
				cacheRead: 0,
				cacheWrite: 0,
				cost: 0.05,
				createdAt: 2,
			},
		]);

		const fork = sessions.fork(session.id, 2);
		expect(fork.id).not.toBe(session.id);
		expect(fork.forkedFromSessionId).toBe(session.id);
		expect(fork.forkedFromMessageSeq).toBe(2);
		expect(fork.messageCount).toBe(2);

		const forkMessages = new MessagesRepo(db).bySession(fork.id);
		expect(forkMessages).toHaveLength(2);
		expect(forkMessages.map((m) => m.seq)).toEqual([1, 2]);
		expect(forkMessages[1].id.startsWith(`m-${fork.id}-`)).toBe(true);
		// Rollups recomputed from the copied messages.
		expect(fork.totalInputTokens).toBe(1);
		expect(fork.totalCost).toBe(0.05);
		// Ledger remapped.
		const ledger = new TokenUsageRepo(db).bySession(fork.id);
		expect(ledger).toHaveLength(1);
		expect(ledger[0].messageId).toBe(forkMessages[1].id);
	});

	test("remove deletes messages and ledger (app-managed cascade)", () => {
		const ws = workspaces.create({ name: "a", path: dir });
		const session = sessions.create({ workspaceId: ws.id });
		const repo = new MessagesRepo(db);
		repo.insertMany([
			{
				id: `m-${session.id}-1`,
				sessionId: session.id,
				seq: 1,
				role: "user",
				dataJson: "{}",
				createdAt: 1,
			},
		]);
		sessions.remove(session.id);
		expect(repo.bySession(session.id)).toHaveLength(0);
		expect(() => sessions.get(session.id)).toThrow(/not found/);
	});

	test("autoTitle flag persists only for draft-created sessions", () => {
		const ws = workspaces.create({ name: "a", path: dir });
		const draft = sessions.create({ workspaceId: ws.id, autoTitle: true });
		const normal = sessions.create({ workspaceId: ws.id });
		expect(sessions.isAutoTitleEligible(draft.id)).toBe(true);
		expect(sessions.isAutoTitleEligible(normal.id)).toBe(false);
	});

	test("updateTitle replaces the title", () => {
		const ws = workspaces.create({ name: "a", path: dir });
		const session = sessions.create({ workspaceId: ws.id });
		const updated = sessions.updateTitle(session.id, "Generated title");
		expect(updated.title).toBe("Generated title");
		expect(sessions.get(session.id).title).toBe("Generated title");
	});
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeStored(seq: number, role: string, content: unknown): StoredMessage {
	return {
		id: `m-s-${seq}`,
		sessionId: "s",
		seq,
		role,
		data: { role, content, timestamp: 1 },
		createdAt: 1,
	};
}

/** Controllable fake ModelService: resolve the completion manually. */
function makeFakeModelService(reply: unknown) {
	let resolve: (value: unknown) => void = () => {};
	const calls = { count: 0 };
	const service = {
		getModel: () => ({ id: "claude", provider: "anthropic" }),
		runtime: {
			completeSimple: () => {
				calls.count += 1;
				return new Promise((res) => {
					resolve = res;
				});
			},
		},
	} as unknown as ModelService;
	return {
		service,
		calls,
		resolve: (value?: unknown) => resolve(value ?? reply),
	};
}

describe("TitleService", () => {
	function setup() {
		const bus = new EventBus();
		const ws = workspaces.create({ name: "a", path: dir });
		const session = sessions.create({
			workspaceId: ws.id,
			autoTitle: true,
			model: { provider: "anthropic", id: "claude" },
		});
		const events: string[] = [];
		bus.on("session.title_updated", (e) => events.push(e.title));
		return { bus, session };
	}

	function emitRunEnd(bus: EventBus, sessionId: string, messages: StoredMessage[]) {
		bus.emit({
			type: "session.run_end",
			sessionId,
			messages,
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: 0,
			},
			error: undefined,
			aborted: false,
		});
	}

	test("titles a draft session from its first user message", async () => {
		const fake = makeFakeModelService({
			content: [{ type: "text", text: "\"Refactor the sidebar\"" }],
		});
		const { bus, session } = setup();
		const svc = new TitleService(bus, sessions, settings, fake.service);
		svc.start();

		emitRunEnd(bus, session.id, [
			makeStored(1, "user", "make the sidebar a tree"),
			makeStored(2, "assistant", "done"),
		]);
		await flush();
		fake.resolve();
		await flush();

		expect(sessions.get(session.id).title).toBe("Refactor the sidebar");
		expect(sessions.get(session.id).updatedAt).toBeGreaterThan(0);
	});

	test("does not title a non-draft session", async () => {
		const fake = makeFakeModelService({ content: [{ type: "text", text: "x" }] });
		const bus = new EventBus();
		const ws = workspaces.create({ name: "a", path: dir });
		const session = sessions.create({
			workspaceId: ws.id,
			model: { provider: "anthropic", id: "claude" },
		});
		const svc = new TitleService(bus, sessions, settings, fake.service);
		svc.start();

		emitRunEnd(bus, session.id, [makeStored(1, "user", "hello")]);
		await flush();

		expect(sessions.get(session.id).title).toBe("New session");
	});

	test("does not re-title once the session has a real title", async () => {
		const fake = makeFakeModelService({ content: [{ type: "text", text: "x" }] });
		const { bus, session } = setup();
		sessions.updateTitle(session.id, "Already named");
		const svc = new TitleService(bus, sessions, settings, fake.service);
		svc.start();

		emitRunEnd(bus, session.id, [makeStored(1, "user", "hello")]);
		await flush();

		expect(sessions.get(session.id).title).toBe("Already named");
	});

	test("skips when no model is configured on the session", async () => {
		const fake = makeFakeModelService({ content: [{ type: "text", text: "x" }] });
		const bus = new EventBus();
		const ws = workspaces.create({ name: "a", path: dir });
		const session = sessions.create({ workspaceId: ws.id, autoTitle: true });
		const svc = new TitleService(bus, sessions, settings, fake.service);
		svc.start();

		emitRunEnd(bus, session.id, [makeStored(1, "user", "hello")]);
		await flush();

		expect(sessions.get(session.id).title).toBe("New session");
	});

	test("extracts text from array content and sanitizes the reply", async () => {
		const fake = makeFakeModelService({
			content: [
				{ type: "thinking", text: "hmm" },
				{ type: "text", text: "Fix the  broken   build. " },
			],
		});
		const { bus, session } = setup();
		const svc = new TitleService(bus, sessions, settings, fake.service);
		svc.start();

		emitRunEnd(bus, session.id, [
			makeStored(1, "user", [
				{ type: "text", text: "please " },
				{ type: "text", text: "fix the build" },
			]),
		]);
		await flush();
		fake.resolve();
		await flush();

		expect(sessions.get(session.id).title).toBe("Fix the broken build");
	});

	test("a failing model call leaves the title untouched", async () => {
		const fake = makeFakeModelService(undefined);
		const { bus, session } = setup();
		const svc = new TitleService(bus, sessions, settings, fake.service);
		svc.start();

		emitRunEnd(bus, session.id, [makeStored(1, "user", "hello")]);
		await flush();
		fake.resolve({ errorMessage: "boom", content: [] });
		await flush();

		expect(sessions.get(session.id).title).toBe("New session");
	});

	test("a manual rename while titling is in flight is not clobbered", async () => {
		const fake = makeFakeModelService({
			content: [{ type: "text", text: "Generated" }],
		});
		const { bus, session } = setup();
		const svc = new TitleService(bus, sessions, settings, fake.service);
		svc.start();

		emitRunEnd(bus, session.id, [makeStored(1, "user", "hello")]);
		await flush(); // model call is now in flight
		// User renames the session while the model is returning a title.
		sessions.updateTitle(session.id, "User's Manual Name");
		fake.resolve();
		await flush();

		expect(sessions.get(session.id).title).toBe("User's Manual Name");
	});

	test("a second run_end while titling is in flight fires no extra model call", async () => {
		const fake = makeFakeModelService({
			content: [{ type: "text", text: "Generated" }],
		});
		const { bus, session } = setup();
		const svc = new TitleService(bus, sessions, settings, fake.service);
		svc.start();

		emitRunEnd(bus, session.id, [makeStored(1, "user", "hello")]);
		await flush();
		expect(fake.calls.count).toBe(1);
		// A second run_end lands before the first resolves (e.g. a second
		// message sent quickly). It must not start another titling call.
		emitRunEnd(bus, session.id, [makeStored(1, "user", "hello")]);
		await flush();
		expect(fake.calls.count).toBe(1);

		fake.resolve();
		await flush();
		expect(sessions.get(session.id).title).toBe("Generated");
	});
});
