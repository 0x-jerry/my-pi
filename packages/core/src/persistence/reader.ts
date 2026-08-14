import type { StoredMessage, TokenUsageRow } from "@my-pi/shared";
import { MessagesRepo, TokenUsageRepo } from "../db/repos";
import { toStoredMessage } from "./mapping";

export class TranscriptReader {
	constructor(
		private messages: MessagesRepo,
		private usage: TokenUsageRepo,
	) {}

	getMessages(sessionId: string): StoredMessage[] {
		return this.messages.bySession(sessionId).map(toStoredMessage);
	}

	getTokenUsage(sessionId: string): TokenUsageRow[] {
		return this.usage.bySession(sessionId);
	}
}
