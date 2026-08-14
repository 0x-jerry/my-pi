import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db/connection";
import { migrate } from "../src/db/migrations";
import {
	CredentialsRepo,
	MessagesRepo,
	PluginsRepo,
	SessionsRepo,
	SettingsRepo,
	TokenUsageRepo,
	WorkspacesRepo,
} from "../src/db/repos";

let dir: string;
let db: ReturnType<typeof openDatabase>;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "my-pi-db-"));
	db = openDatabase(join(dir, "test.db"));
});

afterEach(() => {
	db.close();
	rmSync(dir, { recursive: true, force: true });
});

describe("migrations", () => {
	test("creates tables and is idempotent", () => {
		migrate(db);
		migrate(db);
		const tables = db
			.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
			.all() as { name: string }[];
		const names = tables.map((t) => t.name);
		for (const expected of [
			"workspaces",
			"sessions",
			"messages",
			"token_usage",
			"plugins",
			"settings",
		]) {
			expect(names).toContain(expected);
		}
		const version = db.query("PRAGMA user_version").get() as { user_version: number };
		expect(version.user_version).toBeGreaterThan(0);
	});

	test("upgrades an existing v1 database to v2 without data loss", () => {
		// Simulate a pre-credentials database: apply only migration #1 by setting
		// user_version to 1 with the v1 tables present.
		db.run(
			`CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
		);
		db.run("PRAGMA user_version = 1");
		db.run(
			`INSERT INTO workspaces (id, name, path, created_at, updated_at) VALUES ('w1', 'keep', '/tmp/keep', 1, 1)`,
		);
		migrate(db);
		// v1 data survives and the credentials table is added.
		expect(db.query(`SELECT name FROM workspaces WHERE id = 'w1'`).get()).toEqual({
			name: "keep",
		});
		const tables = db
			.query("SELECT name FROM sqlite_master WHERE type='table'")
			.all() as { name: string }[];
		expect(tables.map((t) => t.name)).toContain("credentials");
		const version = db.query("PRAGMA user_version").get() as { user_version: number };
		expect(version.user_version).toBe(2);
	});
});

describe("credentials repo", () => {
	test("CRUD round-trip and upsert overwrite", () => {
		migrate(db);
		const repo = new CredentialsRepo(db);
		expect(repo.get("anthropic")).toBeNull();
		repo.upsert("anthropic", "api_key", JSON.stringify({ type: "api_key", key: "sk-1" }), 1);
		expect(repo.get("anthropic")?.type).toBe("api_key");
		expect(JSON.parse(repo.get("anthropic")!.credentialJson)).toEqual({
			type: "api_key",
			key: "sk-1",
		});
		// Upsert overwrites the same provider.
		repo.upsert("anthropic", "api_key", JSON.stringify({ type: "api_key", key: "sk-2" }), 2);
		expect(JSON.parse(repo.get("anthropic")!.credentialJson).key).toBe("sk-2");
		expect(repo.get("anthropic")!.updatedAt).toBe(2);
		repo.delete("anthropic");
		expect(repo.get("anthropic")).toBeNull();
		// Delete is idempotent.
		repo.delete("anthropic");
	});

	test("list returns metadata only, never credential_json", () => {
		migrate(db);
		const repo = new CredentialsRepo(db);
		repo.upsert("anthropic", "api_key", JSON.stringify({ type: "api_key", key: "sk-secret" }), 1);
		repo.upsert("openai", "oauth", JSON.stringify({ type: "oauth", access: "a", refresh: "r", expires: 1 }), 2);
		const rows = repo.list();
		expect(rows).toEqual([
			{ providerId: "anthropic", type: "api_key" },
			{ providerId: "openai", type: "oauth" },
		]);
		for (const row of rows) {
			expect("credentialJson" in row).toBe(false);
		}
	});
});

describe("workspaces repo", () => {
	test("CRUD round-trip", () => {
		migrate(db);
		const repo = new WorkspacesRepo(db);
		repo.insert({
			id: "w1",
			name: "My Project",
			path: "/tmp/proj",
			createdAt: 1,
			updatedAt: 2,
		});
		expect(repo.byId("w1")?.name).toBe("My Project");
		expect(repo.byPath("/tmp/proj")?.id).toBe("w1");
		expect(repo.all()).toHaveLength(1);
		repo.updateName("w1", "Renamed");
		expect(repo.byId("w1")?.name).toBe("Renamed");
		repo.remove("w1");
		expect(repo.byId("w1")).toBeNull();
	});

	test("path uniqueness is enforced", () => {
		migrate(db);
		const repo = new WorkspacesRepo(db);
		repo.insert({
			id: "w1",
			name: "a",
			path: "/tmp/proj",
			createdAt: 1,
			updatedAt: 1,
		});
		expect(() =>
			repo.insert({
				id: "w2",
				name: "b",
				path: "/tmp/proj",
				createdAt: 1,
				updatedAt: 1,
			}),
		).toThrow();
	});
});

describe("sessions + messages repos", () => {
	test("message seq uniqueness per session", () => {
		migrate(db);
		const repo = new MessagesRepo(db);
		repo.insertMany([
			{ id: "m-a-1", sessionId: "a", seq: 1, role: "user", dataJson: "{}", createdAt: 1 },
		]);
		expect(() =>
			repo.insertMany([
				{ id: "m-a-2", sessionId: "a", seq: 1, role: "user", dataJson: "{}", createdAt: 1 },
			]),
		).toThrow();
		// Same seq in a different session is fine.
		repo.insertMany([
			{ id: "m-b-1", sessionId: "b", seq: 1, role: "user", dataJson: "{}", createdAt: 1 },
		]);
		expect(repo.countBySession("a")).toBe(1);
		expect(repo.countBySession("b")).toBe(1);
	});

	test("updateAfterRun accumulates rollups", () => {
		migrate(db);
		const repo = new SessionsRepo(db);
		repo.insert({
			id: "s1",
			workspaceId: "w1",
			title: "t",
			status: "idle",
			messageCount: 0,
			totalInputTokens: 0,
			totalOutputTokens: 0,
			totalCacheRead: 0,
			totalCacheWrite: 0,
			totalCost: 0,
			createdAt: 1,
			updatedAt: 1,
			lastActivityAt: 1,
		});
		repo.updateAfterRun("s1", {
			status: "idle",
			messageCountDelta: 2,
			input: 10,
			output: 5,
			cacheRead: 1,
			cacheWrite: 0,
			cost: 0.3,
			lastActivityAt: 9,
		});
		const row = repo.byId("s1")!;
		expect(row.messageCount).toBe(2);
		expect(row.totalInputTokens).toBe(10);
		expect(row.totalCost).toBe(0.3);
		expect(row.lastActivityAt).toBe(9);
	});

	test("settings repo upsert", () => {
		migrate(db);
		const repo = new SettingsRepo(db);
		repo.set("defaultModel", '{"provider":"anthropic","id":"opus"}');
		repo.set("defaultModel", '{"provider":"openai","id":"gpt"}');
		expect(JSON.parse(repo.get("defaultModel")!.valueJson)).toEqual({
			provider: "openai",
			id: "gpt",
		});
	});

	test("token usage insert/list/delete", () => {
		migrate(db);
		const repo = new TokenUsageRepo(db);
		repo.insertMany([
			{
				sessionId: "s1",
				messageId: "m1",
				kind: "assistant",
				input: 5,
				output: 3,
				cacheRead: 0,
				cacheWrite: 0,
				cost: 0.1,
				createdAt: 1,
			},
		]);
		expect(repo.bySession("s1")).toHaveLength(1);
		repo.deleteBySession("s1");
		expect(repo.bySession("s1")).toHaveLength(0);
	});

	test("plugin repo upsert preserves enabled state", () => {
		migrate(db);
		const repo = new PluginsRepo(db);
		const now = 1;
		repo.upsert({
			id: "p1",
			name: "A",
			description: "d",
			sourceType: "builtin",
			source: "p1",
			scope: "global",
			enabled: true,
			installedAt: now,
			updatedAt: now,
		});
		repo.setEnabled("p1", false);
		repo.upsert({
			id: "p1",
			name: "A2",
			description: "d2",
			sourceType: "builtin",
			source: "p1",
			scope: "global",
			enabled: true,
			installedAt: now,
			updatedAt: now,
		});
		const row = repo.byId("p1")!;
		expect(row.name).toBe("A2");
		expect(row.enabled).toBe(false);
	});
});
