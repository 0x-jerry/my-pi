import { randomUUID } from "node:crypto";
import type {
	CreateSessionInput,
	SessionInfo,
	SessionStatus,
	ThinkingLevel,
	UsageSummary,
} from "@my-pi/shared";
import {
	MessagesRepo,
	SessionsRepo,
	TokenUsageRepo,
	WorkspacesRepo,
	type SessionRow,
} from "../db/repos";
import { SettingsService } from "../settings/settings-service";

export interface ResumePayload {
	messages: unknown[];
	modelProvider?: string;
	modelId?: string;
	thinkingLevel?: ThinkingLevel;
}

export interface UsageDelta {
	messageCount: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

export function toSessionInfo(row: SessionRow): SessionInfo {
	return {
		id: row.id,
		workspaceId: row.workspaceId,
		title: row.title,
		status: row.status,
		modelProvider: row.modelProvider,
		modelId: row.modelId,
		thinkingLevel: row.thinkingLevel,
		systemPrompt: row.systemPrompt,
		forkedFromSessionId: row.forkedFromSessionId,
		forkedFromMessageSeq: row.forkedFromMessageSeq,
		messageCount: row.messageCount,
		totalInputTokens: row.totalInputTokens,
		totalOutputTokens: row.totalOutputTokens,
		totalCacheRead: row.totalCacheRead,
		totalCacheWrite: row.totalCacheWrite,
		totalCost: row.totalCost,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		lastActivityAt: row.lastActivityAt,
	};
}

function sumUsage(usageJson: string | null | undefined): UsageSummary | undefined {
	if (!usageJson) return undefined;
	try {
		return JSON.parse(usageJson) as UsageSummary;
	} catch {
		return undefined;
	}
}

function totalsFromMessages(
	messages: { usageJson?: string | null }[],
): UsageDelta {
	const delta: UsageDelta = {
		messageCount: messages.length,
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
	};
	for (const m of messages) {
		const usage = sumUsage(m.usageJson);
		if (!usage) continue;
		delta.input += usage.input;
		delta.output += usage.output;
		delta.cacheRead += usage.cacheRead;
		delta.cacheWrite += usage.cacheWrite;
		delta.cost += usage.cost;
	}
	return delta;
}

export class SessionService {
	constructor(
		private sessions: SessionsRepo,
		private messages: MessagesRepo,
		private usage: TokenUsageRepo,
		private settings: SettingsService,
		private workspaces: WorkspacesRepo,
	) {}

	create(input: CreateSessionInput): SessionInfo {
		// Validate the workspace exists so RPC callers can't create orphans
		// (FKs are off by design in the schema).
		if (!input.workspaceId) {
			throw new Error("workspaceId is required");
		}
		if (!this.workspaces.byId(input.workspaceId)) {
			throw new Error(`Workspace not found: ${input.workspaceId}`);
		}
		const model =
			input.model ??
			this.settings.get<{ provider: string; id: string }>("defaultModel");
		const thinkingLevel =
			input.thinkingLevel ??
			this.settings.get<ThinkingLevel>("defaultThinkingLevel");
		const now = Date.now();
		const row: SessionRow = {
			id: randomUUID(),
			workspaceId: input.workspaceId,
			title: input.title ?? "New session",
			status: "idle",
			modelProvider: model?.provider,
			modelId: model?.id,
			thinkingLevel,
			systemPrompt: input.systemPrompt,
			messageCount: 0,
			totalInputTokens: 0,
			totalOutputTokens: 0,
			totalCacheRead: 0,
			totalCacheWrite: 0,
			totalCost: 0,
			createdAt: now,
			updatedAt: now,
			lastActivityAt: now,
		};
		this.sessions.insert(row);
		return toSessionInfo(this.sessions.byId(row.id)!);
	}

	list(workspaceId: string): SessionInfo[] {
		return this.sessions.allByWorkspace(workspaceId).map(toSessionInfo);
	}

	get(id: string): SessionInfo {
		const row = this.sessions.byId(id);
		if (!row) throw new Error(`Session not found: ${id}`);
		return toSessionInfo(row);
	}

	/** Delete the session and all its messages/token usage (app-managed cascade). */
	remove(id: string): void {
		this.usage.deleteBySession(id);
		this.messages.deleteBySession(id);
		this.sessions.remove(id);
	}

	/**
	 * Fork a session: copy the message prefix up to `uptoSeq` into a new
	 * session (provenance recorded), with rollups recomputed from the copy.
	 */
	fork(id: string, uptoSeq?: number): SessionInfo {
		const source = this.sessions.byId(id);
		if (!source) throw new Error(`Session not found: ${id}`);

		const rows = this.messages.bySession(id);
		// Clamp to the actual message count so a bogus uptoSeq can't record a
		// fork provenance that doesn't exist in the copy.
		const rawUpto =
			typeof uptoSeq === "number" && Number.isFinite(uptoSeq)
				? uptoSeq
				: rows.length;
		const upto = Math.max(0, Math.min(rawUpto, rows.length));
		const prefix = rows.filter((m) => m.seq <= upto);
		const totals = totalsFromMessages(prefix);

		const now = Date.now();
		const newId = randomUUID();
		this.sessions.insert({
			...source,
			id: newId,
			title: `${source.title} (fork)`,
			status: "idle",
			forkedFromSessionId: id,
			forkedFromMessageSeq: upto,
			messageCount: totals.messageCount,
			totalInputTokens: totals.input,
			totalOutputTokens: totals.output,
			totalCacheRead: totals.cacheRead,
			totalCacheWrite: totals.cacheWrite,
			totalCost: totals.cost,
			createdAt: now,
			updatedAt: now,
			lastActivityAt: now,
		});

		this.messages.insertMany(
			prefix.map((m) => ({
				...m,
				id: `m-${newId}-${m.seq}`,
				sessionId: newId,
			})),
		);

		// Remap the token-usage ledger for copied messages.
		const oldToNew = new Map(prefix.map((m) => [m.id, `m-${newId}-${m.seq}`]));
		const ledger = this.usage
			.bySession(id)
			.filter((r) => r.messageId && oldToNew.has(r.messageId))
			.map((r) => ({
				sessionId: newId,
				messageId: oldToNew.get(r.messageId!),
				kind: r.kind,
				input: r.input,
				output: r.output,
				cacheRead: r.cacheRead,
				cacheWrite: r.cacheWrite,
				reasoning: r.reasoning,
				cost: r.cost,
				createdAt: now,
			}));
		this.usage.insertMany(ledger);

		return this.get(newId);
	}

	/** Data needed to (re)start an agent for this session. */
	resumePayload(id: string): ResumePayload {
		const info = this.get(id);
		const rows = this.messages.bySession(id);
		return {
			messages: rows.map((r) => JSON.parse(r.dataJson)),
			modelProvider: info.modelProvider,
			modelId: info.modelId,
			thinkingLevel: info.thinkingLevel,
		};
	}

	updateStatus(id: string, status: SessionStatus): void {
		this.sessions.touch(id, status);
	}
}
