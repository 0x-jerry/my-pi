import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { PiAgentEvent } from "@my-pi/shared";
import { findAgentError, serializeMessages } from "./serialize";

export interface MapperContext {
	aborted: () => boolean;
	getMessages: () => AgentMessage[];
}

/**
 * Pure mapping from pi AgentSessionEvents to app-level PiAgentEvents.
 * Extracted so it can be unit-tested with fabricated events.
 */
export function mapAgentSessionEvent(
	event: AgentSessionEvent,
	ctx: MapperContext,
): PiAgentEvent[] {
	switch (event.type) {
		case "agent_start":
			return [{ type: "agent_start" }];

		case "message_update": {
			const e = event.assistantMessageEvent;
			if (e.type === "text_delta") {
				return [{ type: "message_delta", kind: "text", delta: e.delta }];
			}
			if (e.type === "thinking_delta") {
				return [{ type: "message_delta", kind: "thinking", delta: e.delta }];
			}
			return [];
		}

		case "tool_execution_start":
			return [
				{
					type: "tool_start",
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					args: event.args,
				},
			];

		case "tool_execution_update":
			return [
				{
					type: "tool_update",
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					partialResult: event.partialResult,
				},
			];

		case "tool_execution_end":
			return [
				{
					type: "tool_end",
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					isError: event.isError,
					result: event.result,
				},
			];

		case "agent_settled": {
			const messages = ctx.getMessages();
			return [
				{
					type: "settled",
					messages: serializeMessages(messages),
					error: findAgentError(messages),
					aborted: ctx.aborted(),
				},
			];
		}

		default:
			return [];
	}
}
