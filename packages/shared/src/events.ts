/** Event types flowing between packages.
 * - PiAgentEvent: emitted by the agent package (per-agent, no session id).
 * - CoreEvent: session-scoped events emitted by core (persistence + UI push).
 * - InternalEvent: core-internal (consumed by the persistence writer only).
 */

import type { MessageRecord, SessionStatus, StoredMessage, UsageSummary } from "./types";

export type PiAgentEvent =
	| { type: "agent_start" }
	| { type: "message_delta"; kind: "text" | "thinking"; delta: string }
	| { type: "tool_start"; toolCallId: string; toolName: string; args: unknown }
	| {
			type: "tool_update";
			toolCallId: string;
			toolName: string;
			partialResult: unknown;
	  }
	| {
			type: "tool_end";
			toolCallId: string;
			toolName: string;
			isError: boolean;
			result: unknown;
	  }
	| {
			type: "settled";
			messages: MessageRecord[];
			error?: string;
			aborted: boolean;
	  };

export type CoreEvent =
	| { type: "session.status"; sessionId: string; status: SessionStatus; error?: string }
	| { type: "session.delta"; sessionId: string; kind: "text" | "thinking"; delta: string }
	| {
			type: "session.tool_start";
			sessionId: string;
			toolCallId: string;
			toolName: string;
			args: unknown;
	  }
	| {
			type: "session.tool_update";
			sessionId: string;
			toolCallId: string;
			toolName: string;
			partialResult: unknown;
	  }
	| {
			type: "session.tool_end";
			sessionId: string;
			toolCallId: string;
			toolName: string;
			isError: boolean;
			result: unknown;
	  }
	| { type: "session.message_end"; sessionId: string; message: StoredMessage }
	| { type: "session.title_updated"; sessionId: string; title: string; updatedAt?: number }
	| {
			type: "session.run_end";
			sessionId: string;
			messages: StoredMessage[];
			usage: UsageSummary;
			error?: string;
			aborted: boolean;
	  }
	| { type: "workspace.updated"; workspaceId: string };

export type InternalEvent = {
	type: "session.settled";
	sessionId: string;
	messages: MessageRecord[];
	error?: string;
	aborted: boolean;
};

export type AppEvent = CoreEvent | InternalEvent;
