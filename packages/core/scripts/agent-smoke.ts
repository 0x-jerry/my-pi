import { CoreApp } from "../src/index";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "my-pi-agent-smoke-"));
const app = await CoreApp.create({ dbPath: join(dir, "smoke.db"), wsPort: 0 });

// Pick the first available deepseek model.
const models = await app.modelService.listAvailable("deepseek");
if (models.length === 0) {
	console.log("SKIP: no deepseek model available (auth required)");
	await app.dispose();
	process.exit(0);
}
const model = models[0];
console.log("using model:", model.id);

const events: string[] = [];
app.bus.on("session.delta", (e) => events.push(`delta[${e.kind}] ${JSON.stringify(e.delta.slice(0, 40))}`));
app.bus.on("session.status", (e) => events.push(`status ${e.status}`));
app.bus.on("session.tool_start", (e) => events.push(`tool_start ${e.toolName}`));
app.bus.on("session.tool_end", (e) => events.push(`tool_end ${e.toolName} err=${e.isError}`));
app.bus.on("session.run_end", (e) => events.push(`run_end messages=${e.messages.length} usage=${JSON.stringify(e.usage)} error=${e.error ?? "none"}`));

const ws = app.workspaces.create({ name: "Agent Smoke", path: dir });
const session = app.sessions.create({
	workspaceId: ws.id,
	model: { provider: "deepseek", id: model.id },
	thinkingLevel: "off",
});
console.log("session:", session.id);

await app.sendMessage(session.id, "Reply with exactly: hello from pi");
console.log("prompt resolved");

const stored = app.getMessages(session.id);
console.log("stored messages:", stored.length);
for (const m of stored) {
	console.log(`  [${m.seq}] ${m.role} ${m.model ?? ""} usage=${m.usage ? `${m.usage.totalTokens} tok $${m.usage.cost.toFixed(4)}` : "-"} ${JSON.stringify(m.data).slice(0, 80)}`);
}
const usage = app.getTokenUsage(session.id);
console.log("token_usage rows:", usage.length);

console.log("--- event log ---");
for (const e of events) console.log(" ", e);

await app.dispose();
console.log("AGENT SMOKE OK");
