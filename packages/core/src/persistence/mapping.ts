import type { StoredMessage, TokenUsageRow } from "@my-pi/shared";
import type { MessageRow } from "../db/repos";

export function toStoredMessage(row: MessageRow): StoredMessage {
	return {
		id: row.id,
		sessionId: row.sessionId,
		seq: row.seq,
		role: row.role,
		model: row.model ?? undefined,
		provider: row.provider ?? undefined,
		usage: row.usageJson ? (JSON.parse(row.usageJson) as StoredMessage["usage"]) : undefined,
		data: JSON.parse(row.dataJson),
		createdAt: row.createdAt,
	};
}

export function toTokenUsage(row: TokenUsageRow): TokenUsageRow {
	return row;
}
