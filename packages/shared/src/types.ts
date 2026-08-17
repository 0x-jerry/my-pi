/** App-level data transfer objects. No dependency on pi types. */

export type SessionStatus = "idle" | "running" | "stopped" | "error";

export type ThinkingLevel =
	| "off"
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh"
	| "max";

export interface UsageSummary {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	/** Subset of `output`; undefined when the provider doesn't report it. */
	reasoning?: number;
	totalTokens: number;
	/** Total monetary cost (sum of all components). */
	cost: number;
}

export interface Workspace {
	id: string;
	name: string;
	path: string;
	createdAt: number;
	updatedAt: number;
}

export interface SessionInfo {
	id: string;
	workspaceId: string;
	title: string;
	status: SessionStatus;
	modelProvider?: string;
	modelId?: string;
	thinkingLevel?: ThinkingLevel;
	systemPrompt?: string;
	forkedFromSessionId?: string;
	forkedFromMessageSeq?: number;
	messageCount: number;
	totalInputTokens: number;
	totalOutputTokens: number;
	totalCacheRead: number;
	totalCacheWrite: number;
	totalCost: number;
	createdAt: number;
	updatedAt: number;
	lastActivityAt: number;
}

/**
 * A message before persistence: pi message shape kept opaque in `data`.
 * Produced by the agent package (pi-specific extraction), consumed by core.
 */
export interface MessageRecord {
	role: string;
	model?: string;
	provider?: string;
	usage?: UsageSummary;
	/** Opaque serialized pi AgentMessage. */
	data: unknown;
}

/** A persisted message with stable id + sequence number. */
export interface StoredMessage {
	id: string;
	sessionId: string;
	seq: number;
	role: string;
	model?: string;
	provider?: string;
	usage?: UsageSummary;
	data: unknown;
	createdAt: number;
}

export interface TokenUsageRow {
	id: number;
	sessionId: string;
	messageId?: string;
	kind: "assistant" | "tool";
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	reasoning?: number;
	cost: number;
	createdAt: number;
}

export type PluginScope = "global" | "workspace";
export type PluginSourceType = "path" | "builtin";

export interface PluginInfo {
	id: string;
	name: string;
	description?: string;
	sourceType: PluginSourceType;
	/** For path plugins: absolute path. For builtins: builtin id. */
	source: string;
	scope: PluginScope;
	workspaceId?: string;
	enabled: boolean;
	installedAt: number;
	updatedAt: number;
}

export interface ProviderInfo {
	id: string;
	name: string;
	authConfigured: boolean;
	authType?: "api_key" | "oauth";
	authSource?: string;
}

export interface ModelInfo {
	providerId: string;
	providerName: string;
	id: string;
	name: string;
	reasoning: boolean;
	contextWindow: number;
}

export interface CreateWorkspaceInput {
	name: string;
	path: string;
}

export interface CreateSessionInput {
	workspaceId: string;
	title?: string;
	model?: { provider: string; id: string };
	thinkingLevel?: ThinkingLevel;
	systemPrompt?: string;
	/**
	 * Session was created as a placeholder (draft flow); the title starts as
	 * DEFAULT_SESSION_TITLE and is LLM-generated from the first user message.
	 */
	autoTitle?: boolean;
}

export interface AddPluginInput {
	source: string;
	scope?: PluginScope;
	workspaceId?: string;
	name?: string;
}

export interface AuthStatus {
	providerId: string;
	configured: boolean;
	type?: "api_key" | "oauth";
	source?: string;
}
