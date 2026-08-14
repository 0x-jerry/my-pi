import type { InternalEvent, SessionStatus, UsageSummary } from "@my-pi/shared";
import { EventBus } from "../events/event-bus";
import {
	MessagesRepo,
	SessionsRepo,
	TokenUsageRepo,
	type InsertMessage,
} from "../db/repos";
import type { InsertTokenUsage } from "../db/repos/token-usage";
import { toStoredMessage } from "./mapping";

export interface PersistenceWriterDeps {
	bus: EventBus;
	messages: MessagesRepo;
	usage: TokenUsageRepo;
	sessions: SessionsRepo;
}

/**
 * Persists settled runs to sqlite (suffix-diff by message count, so it is
 * idempotent across repeated settle events) and re-emits public events with
 * stable stored message ids.
 */
export class PersistenceWriter {
	constructor(private deps: PersistenceWriterDeps) {}

	start(): void {
		this.deps.bus.on("session.settled", (event) => this.handleSettled(event));
	}

	handleSettled(event: InternalEvent): void {
		const { sessionId, messages, error, aborted } = event;
		const existing = this.deps.messages.countBySession(sessionId);
		const fresh = messages.slice(existing);

		const usage = this.persistMessages(sessionId, existing, fresh);
		let status: SessionStatus;
		if (error) {
			status = "error";
		} else if (fresh.length === 0) {
			// Re-settle of an already-persisted run: don't let a later settle
			// (e.g. an abort without an error flag) downgrade an error status.
			status =
				this.deps.sessions.byId(sessionId)?.status === "error"
					? "error"
					: "idle";
		} else {
			status = "idle";
		}
		this.deps.sessions.updateAfterRun(sessionId, {
			status,
			messageCountDelta: fresh.length,
			input: usage.input,
			output: usage.output,
			cacheRead: usage.cacheRead,
			cacheWrite: usage.cacheWrite,
			cost: usage.cost,
			lastActivityAt: Date.now(),
		});

		const stored = this.deps.messages.bySession(sessionId).map(toStoredMessage);
		for (const message of stored.slice(existing)) {
			this.deps.bus.emit({
				type: "session.message_end",
				sessionId,
				message,
			});
		}
		this.deps.bus.emit({
			type: "session.run_end",
			sessionId,
			messages: stored,
			usage: {
				input: usage.input,
				output: usage.output,
				cacheRead: usage.cacheRead,
				cacheWrite: usage.cacheWrite,
				totalTokens:
					usage.input + usage.output + usage.cacheRead + usage.cacheWrite,
				cost: usage.cost,
			},
			error,
			aborted,
		});
	}

	private persistMessages(
		sessionId: string,
		existing: number,
		fresh: { role: string; model?: string; provider?: string; usage?: UsageSummary; data: unknown }[],
	): UsageSummary {
		if (fresh.length === 0) {
			return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 };
		}
		const now = Date.now();
		const rows: InsertMessage[] = fresh.map((m, i) => ({
			id: `m-${sessionId}-${existing + i + 1}`,
			sessionId,
			seq: existing + i + 1,
			role: m.role,
			model: m.model ?? null,
			provider: m.provider ?? null,
			usageJson: m.usage ? JSON.stringify(m.usage) : null,
			dataJson: JSON.stringify(m.data),
			createdAt: now,
		}));
		this.deps.messages.insertMany(rows);

		const ledger: InsertTokenUsage[] = [];
		let input = 0,
			output = 0,
			cacheRead = 0,
			cacheWrite = 0,
			cost = 0;
		for (const row of rows) {
			if (!row.usageJson) continue;
			const usage = JSON.parse(row.usageJson) as UsageSummary;
			const kind =
				row.role === "assistant"
					? ("assistant" as const)
					: row.role === "toolResult"
						? ("tool" as const)
						: null;
			if (!kind) continue;
			ledger.push({
				sessionId,
				messageId: row.id,
				kind,
				input: usage.input,
				output: usage.output,
				cacheRead: usage.cacheRead,
				cacheWrite: usage.cacheWrite,
				reasoning: usage.reasoning,
				cost: usage.cost,
				createdAt: now,
			});
			input += usage.input;
			output += usage.output;
			cacheRead += usage.cacheRead;
			cacheWrite += usage.cacheWrite;
			cost += usage.cost;
		}
		if (ledger.length > 0) this.deps.usage.insertMany(ledger);

		return { input, output, cacheRead, cacheWrite, totalTokens: input + output + cacheRead + cacheWrite, cost };
	}
}
