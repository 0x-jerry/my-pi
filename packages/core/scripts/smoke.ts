import { CoreApp } from "../src/index";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "my-pi-smoke-"));
const app = await CoreApp.create({ dbPath: join(dir, "smoke.db"), wsPort: 0 });
console.log("CoreApp started, wsPort =", app.wsPort);
console.log(
	"providers:",
	(await app.modelService.listProviders())
		.map((p) => `${p.id} (auth:${p.authConfigured})`)
		.join(", "),
);

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
	} else {
		console.log("notification:", msg.method, JSON.stringify(msg.params ?? {}).slice(0, 120));
	}
};
function call(id: number, method: string, params?: unknown) {
	return new Promise<any>((res) => {
		pending.set(id, res);
		ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
	});
}

console.log("workspaces.list ->", JSON.stringify(await call(1, "workspaces.list", {})));
const created = await call(2, "workspaces.create", { name: "Smoke", path: dir });
console.log("workspaces.create ->", created.result?.id, created.result?.path);
const session = (
	await call(3, "sessions.create", {
		workspaceId: created.result.id,
		model: { provider: "anthropic", id: "claude-opus-4-5" },
	})
).result;
console.log("sessions.create ->", session.id, session.modelId);
const fork = (await call(4, "sessions.fork", { id: session.id })).result;
console.log("sessions.fork ->", fork.id, "msgCount:", fork.messageCount);
console.log(
	"plugins.list ->",
	(await call(5, "plugins.list", {})).result
		.map((p: any) => `${p.id} (${p.enabled})`)
		.join(", "),
);
console.log(
	"settings.set/get ->",
	(await call(6, "settings.set", { key: "defaultThinkingLevel", value: "high" })).result,
	"|",
	(await call(7, "settings.get", { key: "defaultThinkingLevel" })).result,
);
console.log(
	"settings.getAll ->",
	JSON.stringify((await call(9, "settings.getAll")).result),
);
const bad = await call(10, "chat.send", { sessionId: "does-not-exist", text: "hi" });
console.log("chat.send to missing session -> error:", bad.error?.message.slice(0, 60));

ws.close();
await app.dispose();
console.log("SMOKE OK");
