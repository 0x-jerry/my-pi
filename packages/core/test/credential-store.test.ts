import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db/connection";
import { migrate } from "../src/db/migrations";
import { SqliteCredentialStore } from "../src/db/credential-store";
import { CredentialsRepo } from "../src/db/repos";
import { ModelService } from "@my-pi/agent";

let dir: string;
let db: ReturnType<typeof openDatabase>;
let repo: CredentialsRepo;
let store: SqliteCredentialStore;

function deferred<T = void>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "my-pi-creds-"));
	db = openDatabase(join(dir, "test.db"));
	migrate(db);
	repo = new CredentialsRepo(db);
	store = new SqliteCredentialStore(repo);
});

afterEach(() => {
	db.close();
	rmSync(dir, { recursive: true, force: true });
});

describe("SqliteCredentialStore semantics", () => {
	test("read missing entry resolves undefined", async () => {
		expect(await store.read("anthropic")).toBeUndefined();
	});

	test("modify creates an entry and resolves the post-write credential", async () => {
		const result = await store.modify("anthropic", async () => ({
			type: "api_key",
			key: "sk-test",
		}));
		expect(result).toEqual({ type: "api_key", key: "sk-test" });
		expect((await store.read("anthropic"))?.key).toBe("sk-test");
	});

	test("modify's fn sees the current credential", async () => {
		await store.modify("p", async () => ({ type: "api_key", key: "v1" }));
		const seen = await store.modify("p", async (current) => {
			expect(current?.key).toBe("v1");
			return { type: "api_key", key: "v2" };
		});
		expect(seen?.key).toBe("v2");
	});

	test("modify returning undefined leaves the entry unchanged", async () => {
		await store.modify("p", async () => ({ type: "api_key", key: "v1" }));
		const result = await store.modify("p", async (current) => {
			expect(current?.key).toBe("v1");
			return undefined; // pi contract: leave unchanged (login-during-refresh)
		});
		expect(result?.key).toBe("v1");
		expect((await store.read("p"))?.key).toBe("v1");
	});

	test("modify fn rejection propagates and writes nothing", async () => {
		await expect(
			store.modify("p", async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		expect(await store.read("p")).toBeUndefined();
	});

	test("concurrent modify calls for the same provider serialize", async () => {
		const started = deferred();
		const gate1 = deferred();
		const gate2 = deferred();
		let secondStarted = false;

		const first = store.modify("p", async () => {
			started.resolve();
			await gate1.promise;
			return { type: "api_key", key: "k1" };
		});
		const second = store.modify("p", async () => {
			secondStarted = true;
			await gate2.promise;
			return { type: "api_key", key: "k2" };
		});

		await started.promise; // first op is now blocked on gate1
		// Serialized: second op must not have started while first was in flight.
		expect(secondStarted).toBe(false);
		gate1.resolve();
		expect((await first)?.key).toBe("k1");
		// With first complete, the queued second op now runs (its fn sets the flag).
		expect(secondStarted).toBe(true);
		gate2.resolve();
		expect((await second)?.key).toBe("k2");
		expect((await store.read("p"))?.key).toBe("k2");
	});

	test("different providers do not block each other", async () => {
		const gate = deferred();
		const slow = store.modify("a", async () => {
			await gate.promise;
			return { type: "api_key", key: "a1" };
		});
		const fast = store.modify("b", async () => ({ type: "api_key", key: "b1" }));
		expect((await fast)?.key).toBe("b1"); // resolves without waiting for "a"
		gate.resolve();
		await slow;
	});

	test("delete removes the entry and is idempotent", async () => {
		await store.modify("p", async () => ({ type: "api_key", key: "k" }));
		await store.delete("p");
		expect(await store.read("p")).toBeUndefined();
		await store.delete("p"); // idempotent
	});

	test("delete serializes against in-flight modify", async () => {
		const gate = deferred();
		const modify = store.modify("p", async () => {
			await gate.promise;
			return { type: "api_key", key: "k" };
		});
		const del = store.delete("p"); // queued behind the in-flight modify
		gate.resolve();
		await Promise.all([modify, del]);
		expect(await store.read("p")).toBeUndefined();
	});

	test("list returns type metadata only, never secrets", async () => {
		await store.modify("anthropic", async () => ({ type: "api_key", key: "sk-secret" }));
		await store.modify("openai", async () => ({
			type: "oauth",
			access: "a",
			refresh: "r",
			expires: 123,
		}));
		const infos = await store.list();
		expect(infos).toEqual([
			{ providerId: "anthropic", type: "api_key" },
			{ providerId: "openai", type: "oauth" },
		]);
	});

	test("corrupt stored JSON degrades to undefined without throwing", async () => {
		repo.upsert("p", "api_key", "{not json", 1);
		expect(await store.read("p")).toBeUndefined();
	});

	test("credentials persist across store instances over the same db", async () => {
		await store.modify("p", async () => ({ type: "api_key", key: "persist" }));
		const reopened = new SqliteCredentialStore(new CredentialsRepo(db));
		expect((await reopened.read("p"))?.key).toBe("persist");
		expect(await reopened.list()).toEqual([{ providerId: "p", type: "api_key" }]);
	});
});

describe("ModelService wiring", () => {
	test("runtime-only api key is not persisted to the store", async () => {
		const service = await ModelService.create({ credentialStore: store });
		expect(await service.listProviders()).not.toHaveLength(0); // builtin catalog loads
		expect((await store.list())).toHaveLength(0);

		// setRuntimeApiKey must only affect the runtime overlay, never sqlite.
		await service.setRuntimeApiKey("anthropic", "sk-runtime");
		expect(await store.read("anthropic")).toBeUndefined();
	});

	test("loginApiKey persists through pi's login flow into sqlite", async () => {
		const service = await ModelService.create({ credentialStore: store });
		await service.loginApiKey("anthropic", "sk-login");
		expect((await store.read("anthropic"))?.key).toBe("sk-login");
		expect(await store.list()).toEqual([{ providerId: "anthropic", type: "api_key" }]);

		// A second service over the same db sees the credential as configured.
		const reopened = await ModelService.create({ credentialStore: store });
		const providers = await reopened.listProviders();
		const anthropic = providers.find((p) => p.id === "anthropic");
		expect(anthropic?.authConfigured).toBe(true);
	});

	test("logout removes the credential from sqlite", async () => {
		const service = await ModelService.create({ credentialStore: store });
		await service.loginApiKey("anthropic", "sk-login");
		expect(await store.read("anthropic")).toBeDefined();
		await service.logout("anthropic");
		expect(await store.read("anthropic")).toBeUndefined();
		expect(await store.list()).toHaveLength(0);
	});
});
