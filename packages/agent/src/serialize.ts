import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";
import type { MessageRecord, UsageSummary } from "@my-pi/shared";

export function toUsageSummary(usage: Usage | undefined): UsageSummary | undefined {
	if (!usage) return undefined;
	return {
		input: usage.input,
		output: usage.output,
		cacheRead: usage.cacheRead,
		cacheWrite: usage.cacheWrite,
		reasoning: usage.reasoning,
		totalTokens: usage.totalTokens,
		cost: usage.cost.total,
	};
}

/** Convert one pi AgentMessage into an opaque, persistable MessageRecord. */
export function serializeMessage(message: AgentMessage): MessageRecord {
	const record: MessageRecord = {
		role: message.role,
		data: message as unknown,
	};
	if (message.role === "assistant") {
		record.model = message.model;
		record.provider = message.provider;
		record.usage = toUsageSummary(message.usage);
	} else if (message.role === "toolResult") {
		record.usage = toUsageSummary(message.usage);
	}
	return record;
}

export function serializeMessages(messages: AgentMessage[]): MessageRecord[] {
	return messages.map(serializeMessage);
}

/** Last non-empty error message from the transcript, if the run failed. */
export function findAgentError(messages: AgentMessage[]): string | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.role !== "assistant") continue;
		if (m.errorMessage) return m.errorMessage;
		if (m.stopReason === "error") return "Agent run failed";
	}
	return undefined;
}
