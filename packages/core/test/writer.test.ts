import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CoreEvent, MessageRecord } from "@my-pi/shared";
import { openDatabase } from "../src/db/connection";
import { migrate } from "../src/db/migrations";
import {
	MessagesRepo,
	SessionsRepo,
	TokenUsageRepo,
} from "../src/db/repos";
import { EventBus } from "../src/events/event-bus";
import { PersistenceWriter } from "../src/persistence/writer";

let dir: string;
let db: ReturnType<typeof openDatabase>;
let bus: EventBus;
let messages: MessagesRepo;
let usage: TokenUsageRepo;
let sessions: SessionsRepo;
let writer: PersistenceWriter;
let runEnds: CoreEvent[];

function settled(
	sessionId: string,
	records: MessageRecord[],
	opts: { error?: string; aborted?: boolean } = {},
) {
	bus.emit({
		type: "session.settled",
		sessionId,
		messages: records,
		error: opts.error,
		aborted: opts.aborted ?? false,
	});
}

function userRecord(text: string): MessageRecord {
	return { role: "user", data: { role: "user", content: text } };
}

function assistantRecord(
	usageDelta: { input: number; output: number } = { input: 7, output: 3 },
): MessageRecord {
	return {
		role: "assistant",
		model: "claude-opus-4-5",
		provider: "anthropic",
		usage: {
			...usageDelta,
			cacheRead: 1,
			cacheWrite: 0,
			totalTokens: usageDelta.input + usageDelta.output + 1,
			cost: 0.1,
		},
		data: {
			role: "assistant",
			content: [{ type: "text", text: "answer" }],
			stopReason: "stop",
		},
	};
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "my-pi-writer-"));
	db = openDatabase(join(dir, "test.db"));
	migrate(db);
	bus = new EventBus();
	messages = new MessagesRepo(db);
	usage = new TokenUsageRepo(db);
	sessions = new SessionsRepo(db);
	sessions.insert({
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
		autoTitle: false,
		createdAt: 1,
		updatedAt: 1,
		lastActivityAt: 1,
	});
	writer = new PersistenceWriter({ bus, messages, usage, sessions });
	writer.start();
	runEnds = [];
	bus.on("session.run_end", (e) => runEnds.push(e));
});

afterEach(() => {
	db.close();
	rmSync(dir, { recursive: true, force: true });
});

describe("PersistenceWriter", () => {
	test("persists new messages with stable ids and seq", () => {
		settled("s1", [userRecord("hi"), assistantRecord()]);

		const rows = messages.bySession("s1");
		expect(rows).toHaveLength(2);
		expect(rows[0].id).toBe("m-s1-1");
		expect(rows[1].id).toBe("m-s1-2");
		expect(rows[1].model).toBe("claude-opus-4-5");
		expect(rows[1].usageJson).toContain('"input":7');
		expect(JSON.parse(rows[1].dataJson).content[0].text).toBe("answer");
	});

	test("writes token ledger and updates session rollups", () => {
		settled("s1", [assistantRecord()]);

		const ledger = usage.bySession("s1");
		expect(ledger).toHaveLength(1);
		expect(ledger[0]).toMatchObject({
			kind: "assistant",
			input: 7,
			output: 3,
			cacheRead: 1,
			cost: 0.1,
		});

		const row = sessions.byId("s1")!;
		expect(row.messageCount).toBe(1);
		expect(row.totalInputTokens).toBe(7);
		expect(row.totalOutputTokens).toBe(3);
		expect(row.totalCost).toBe(0.1);
		expect(row.status).toBe("idle");
	});

	test("emits message_end per new message and a run_end with the full transcript", () => {
		const messageEnds: CoreEvent[] = [];
		bus.on("session.message_end", (e) => messageEnds.push(e));
		settled("s1", [userRecord("hi"), assistantRecord()]);

		expect(messageEnds).toHaveLength(2);
		expect(runEnds).toHaveLength(1);
		const runEnd = runEnds[0];
		if (runEnd.type === "session.run_end") {
			expect(runEnd.messages).toHaveLength(2);
			expect(runEnd.messages[1].id).toBe("m-s1-2");
			expect(runEnd.usage).toMatchObject({ input: 7, output: 3, cost: 0.1 });
			expect(runEnd.aborted).toBe(false);
		}
	});

	test("is idempotent on repeated settle events (suffix-diff)", () => {
		const records = [userRecord("hi"), assistantRecord()];
		settled("s1", records);
		settled("s1", records); // duplicate settle — nothing new
		settled("s1", [...records, userRecord("follow-up")]); // appended

		expect(messages.bySession("s1")).toHaveLength(3);
		const row = sessions.byId("s1")!;
		expect(row.messageCount).toBe(3);
		expect(runEnds).toHaveLength(3);
	});

	test("marks session error status and carries error on error", () => {
		settled("s1", [userRecord("hi"), assistantRecord()], {
			error: "API returned 429",
		});
		expect(sessions.byId("s1")!.status).toBe("error");
		const runEnd = runEnds[0];
		if (runEnd.type === "session.run_end") {
			expect(runEnd.error).toBe("API returned 429");
		}
	});

	test("partial transcript persists on abort", () => {
		settled("s1", [userRecord("hi")], { aborted: true });
		expect(messages.bySession("s1")).toHaveLength(1);
		const runEnd = runEnds[0];
		if (runEnd.type === "session.run_end") {
			expect(runEnd.aborted).toBe(true);
		}
	});

	test("empty settle still emits run_end without duplicating", () => {
		settled("s1", []);
		expect(messages.bySession("s1")).toHaveLength(0);
		expect(runEnds).toHaveLength(1);
		if (runEnds[0].type === "session.run_end") {
			expect(runEnds[0].usage.totalTokens).toBe(0);
		}
	});
});
