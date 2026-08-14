/**
 * E2E smoke for sqlite-backed pi credentials:
 *  1. login via RPC → credential row in sqlite
 *  2. app restart (new CoreApp over the same db) → provider shows authConfigured
 *  3. logout → row removed
 *  4. db file mode is 0600
 * Run: bun run --cwd packages/core scripts/creds-smoke.ts
 */
import { CoreApp } from "../src/index";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "my-pi-creds-smoke-"));
const dbPath = join(dir, "smoke.db");

async function boot(): Promise<CoreApp> {
	const app = await CoreApp.create({ dbPath, wsPort: 0 });
	console.log("CoreApp started, wsPort =", app.wsPort);
	return app;
}

async function connect(app: CoreApp) {
	const ws = new WebSocket(`ws://127.0.0.1:${app.wsPort}/ws`, app.wsToken);
	await new Promise((res, rej) => {
		ws.onopen = res;
		ws.onerror = rej;
	});
	const pending = new Map<number, (msg: any) => void>();
	ws.onmessage = (e) => {
		const msg = JSON.parse(String(e.data));
		if (msg.id != null && pending.has(msg.id)) {
			pending.get(msg.id)!(msg);
			pending.delete(msg.id);
		}
	};
	let nextId = 1;
	return (method: string, params: unknown) =>
		new Promise<any>((res) => {
			const id = nextId++;
			pending.set(id, res);
			ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
		});
}

let app = await boot();
let call = await connect(app);

const before = await call("models.providers", {});
const anthropicBefore = before.result.find((p: any) => p.id === "anthropic");
console.log("anthropic authConfigured before login:", anthropicBefore?.authConfigured);

const login = await call("models.login", {
	providerId: "anthropic",
	apiKey: "sk-smoke-e2e",
});
console.log("models.login ->", login.error ? `error: ${login.error.message}` : "ok");

// Credential row must exist in sqlite (fresh DB → row survives via WAL after close).
await app.dispose();

const row = (await import("bun:sqlite")).Database.open(dbPath);
const stored = row
	.query(
		`SELECT provider_id AS providerId, type, credential_json AS credentialJson FROM credentials`,
	)
	.all();
console.log("sqlite credentials rows:", JSON.stringify(stored));
row.close();

const mode = (statSync(dbPath).mode & 0o777).toString(8);
console.log("db file mode:", mode, mode === "600" ? "(0600 ✓)" : "(NOT 0600 ✗)");
if (mode !== "600") throw new Error("db file not chmod 0600");
if (stored.length !== 1 || stored[0].providerId !== "anthropic") {
	throw new Error("credential row missing after login");
}
if (JSON.parse((stored[0] as any).credentialJson).key !== "sk-smoke-e2e") {
	throw new Error("stored credential key mismatch");
}

// Restart over the same db → provider must show as configured.
app = await boot();
call = await connect(app);
const after = await call("models.providers", {});
const anthropicAfter = after.result.find((p: any) => p.id === "anthropic");
console.log("anthropic authConfigured after restart:", anthropicAfter?.authConfigured);
if (anthropicAfter?.authConfigured !== true) {
	throw new Error("credential not visible after restart");
}

const logout = await call("models.logout", { providerId: "anthropic" });
console.log("models.logout ->", logout.error ? `error: ${logout.error.message}` : "ok");
const gone = await app.modelService.checkAuth("anthropic");
console.log("anthropic configured after logout:", gone.configured);
if (gone.configured) throw new Error("logout did not clear credential");

await app.dispose();
console.log("CREDS SMOKE OK");
