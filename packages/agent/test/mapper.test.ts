import { describe, expect, test } from "bun:test";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { mapAgentSessionEvent } from "../src/mapper";
import { findAgentError, serializeMessages, toUsageSummary } from "../src/serialize";

const USAGE = {
	input: 10,
	output: 5,
	cacheRead: 2,
	cacheWrite: 1,
	totalTokens: 18,
	cost: { input: 0.1, output: 0.2, cacheRead: 0.01, cacheWrite: 0.02, total: 0.33 },
};

function assistantMessage(overrides: Partial<Record<string, unknown>> = {}): AgentMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "hi" }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-opus-4-5",
		usage: USAGE,
		stopReason: "stop",
		timestamp: 123,
		...overrides,
	} as unknown as AgentMessage;
}

function userMessage(text = "hello"): AgentMessage {
	return {
		role: "user",
		content: text,
		timestamp: 100,
	} as unknown as AgentMessage;
}

function ctx(messages: AgentMessage[], aborted = false) {
	return {
		aborted: () => aborted,
		getMessages: () => messages,
	};
}

describe("mapAgentSessionEvent", () => {
	test("agent_start maps to agent_start", () => {
		const events = mapAgentSessionEvent(
			{ type: "agent_start" } as AgentSessionEvent,
			ctx([]),
		);
		expect(events).toEqual([{ type: "agent_start" }]);
	});

	test("text_delta maps to message_delta", () => {
		const events = mapAgentSessionEvent(
			{
				type: "message_update",
				message: assistantMessage(),
				assistantMessageEvent: {
					type: "text_delta",
					contentIndex: 0,
					delta: "Hel",
					partial: assistantMessage(),
				},
			} as unknown as AgentSessionEvent,
			ctx([]),
		);
		expect(events).toEqual([{ type: "message_delta", kind: "text", delta: "Hel" }]);
	});

	test("thinking_delta maps to message_delta thinking", () => {
		const events = mapAgentSessionEvent(
			{
				type: "message_update",
				message: assistantMessage(),
				assistantMessageEvent: {
					type: "thinking_delta",
					contentIndex: 0,
					delta: "hmm",
					partial: assistantMessage(),
				},
			} as unknown as AgentSessionEvent,
			ctx([]),
		);
		expect(events).toEqual([
			{ type: "message_delta", kind: "thinking", delta: "hmm" },
		]);
	});

	test("tool execution events map through", () => {
		const start = mapAgentSessionEvent(
			{
				type: "tool_execution_start",
				toolCallId: "t1",
				toolName: "read",
				args: { path: "a.txt" },
			} as unknown as AgentSessionEvent,
			ctx([]),
		);
		expect(start).toEqual([
			{ type: "tool_start", toolCallId: "t1", toolName: "read", args: { path: "a.txt" } },
		]);

		const end = mapAgentSessionEvent(
			{
				type: "tool_execution_end",
				toolCallId: "t1",
				toolName: "read",
				result: "contents",
				isError: false,
			} as unknown as AgentSessionEvent,
			ctx([]),
		);
		expect(end).toEqual([
			{ type: "tool_end", toolCallId: "t1", toolName: "read", isError: false, result: "contents" },
		]);
	});

	test("agent_settled carries serialized messages + aborted flag", () => {
		const messages = [userMessage(), assistantMessage()];
		const events = mapAgentSessionEvent(
			{ type: "agent_settled" } as AgentSessionEvent,
			ctx(messages, true),
		);
		expect(events).toHaveLength(1);
		const settled = events[0];
		expect(settled.type).toBe("settled");
		if (settled.type === "settled") {
			expect(settled.aborted).toBe(true);
			expect(settled.error).toBeUndefined();
			expect(settled.messages).toHaveLength(2);
			expect(settled.messages[1]).toMatchObject({
				role: "assistant",
				model: "claude-opus-4-5",
				provider: "anthropic",
				usage: {
					input: 10,
					output: 5,
					cacheRead: 2,
					cacheWrite: 1,
					totalTokens: 18,
					cost: 0.33,
				},
			});
		}
	});

	test("agent_settled surfaces error from failed assistant message", () => {
		const messages = [assistantMessage({ errorMessage: "API returned 429" })];
		const events = mapAgentSessionEvent(
			{ type: "agent_settled" } as AgentSessionEvent,
			ctx(messages),
		);
		const settled = events[0];
		expect(settled.type).toBe("settled");
		if (settled.type === "settled") expect(settled.error).toBe("API returned 429");
	});

	test("unrelated events produce no output", () => {
		const events = mapAgentSessionEvent(
			{ type: "queue_update", steering: [], followUp: [] } as AgentSessionEvent,
			ctx([]),
		);
		expect(events).toEqual([]);
	});
});

describe("serialize helpers", () => {
	test("toUsageSummary handles undefined and reasoning", () => {
		expect(toUsageSummary(undefined)).toBeUndefined();
		expect(toUsageSummary({ ...USAGE, reasoning: 3 })).toMatchObject({
			reasoning: 3,
			cost: 0.33,
		});
	});

	test("serializeMessages drops usage for user messages", () => {
		const records = serializeMessages([userMessage(), assistantMessage()]);
		expect(records[0].usage).toBeUndefined();
		expect(records[0].role).toBe("user");
		expect(records[1].usage).toBeDefined();
	});

	test("findAgentError returns the last error message", () => {
		expect(findAgentError([userMessage(), assistantMessage()])).toBeUndefined();
		expect(
			findAgentError([
				assistantMessage({ errorMessage: "first" }),
				assistantMessage({ errorMessage: "second" }),
			]),
		).toBe("second");
		expect(
			findAgentError([assistantMessage({ stopReason: "error" })]),
		).toBe("Agent run failed");
	});
});
