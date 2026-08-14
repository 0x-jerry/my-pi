import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { openDatabase } from "../src/db/connection";
import { migrate } from "../src/db/migrations";
import {
	MessagesRepo,
	SessionsRepo,
	SettingsRepo,
	TokenUsageRepo,
	WorkspacesRepo,
} from "../src/db/repos";
import { SettingsService } from "../src/settings/settings-service";
import { WorkspaceService } from "../src/workspaces/workspace-service";
import { SessionService } from "../src/sessions/session-service";

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
	test("create resolves default model from settings", () => {
		settings.set("defaultModel", { provider: "anthropic", id: "claude-opus" });
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
		settings.set("defaultModel", { provider: "anthropic", id: "claude-opus" });
		const ws = workspaces.create({ name: "a", path: dir });
		const session = sessions.create({
			workspaceId: ws.id,
			model: { provider: "openai", id: "gpt-5" },
		});
		expect(session.modelId).toBe("gpt-5");
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
});
