/**
 * JSON-RPC 2.0 protocol types and pure helpers.
 * Dependency-free so both `core` (server) and `app` (client) can share them.
 */

export const RPC_VERSION = "2.0" as const;

export interface JsonRpcRequest {
	jsonrpc: "2.0";
	/** Per spec, `null` is a valid request id (the response echoes it). */
	id: number | string | null;
	method: string;
	params?: unknown;
}

export interface JsonRpcNotification {
	jsonrpc: "2.0";
	method: string;
	params?: unknown;
}

export interface JsonRpcError {
	code: number;
	message: string;
	data?: unknown;
}

export interface JsonRpcResponse {
	jsonrpc: "2.0";
	id: number | string | null;
	result?: unknown;
	error?: JsonRpcError;
}

/** Standard JSON-RPC 2.0 error codes. */
export const RpcErrorCode = {
	PARSE_ERROR: -32700,
	INVALID_REQUEST: -32600,
	METHOD_NOT_FOUND: -32601,
	INVALID_PARAMS: -32602,
	INTERNAL_ERROR: -32603,
} as const;

export type ParsedRpcMessage =
	| {
			kind: "request";
			id: number | string | null;
			method: string;
			params?: unknown;
	  }
	| { kind: "notification"; method: string; params?: unknown }
	| { kind: "invalid"; error: JsonRpcError };

function isObject(value: unknown): boolean {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** JSON-RPC "Structured value": a plain object or an array (positional params). */
function isStructured(value: unknown): boolean {
	return typeof value === "object" && value !== null;
}

/**
 * Parse a single JSON-RPC message from a text frame.
 * Batches (top-level arrays) are rejected with INVALID_REQUEST; `id: null`
 * and array (positional) params are valid per the spec and accepted.
 */
export function parseRpcMessage(text: string): ParsedRpcMessage {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return {
			kind: "invalid",
			error: { code: RpcErrorCode.PARSE_ERROR, message: "Parse error" },
		};
	}

	if (!isObject(raw)) {
		return {
			kind: "invalid",
			error: { code: RpcErrorCode.INVALID_REQUEST, message: "Invalid Request" },
		};
	}

	const obj = raw as Record<string, unknown>;
	if (obj.jsonrpc !== "2.0" || typeof obj.method !== "string") {
		return {
			kind: "invalid",
			error: { code: RpcErrorCode.INVALID_REQUEST, message: "Invalid Request" },
		};
	}
	if (obj.params !== undefined && !isStructured(obj.params)) {
		return {
			kind: "invalid",
			error: {
				code: RpcErrorCode.INVALID_REQUEST,
				message: "params must be an object or array",
			},
		};
	}

	if (Object.prototype.hasOwnProperty.call(obj, "id")) {
		const id = obj.id;
		// Spec: id is String, Number, or NULL (omitting it means notification).
		if (id !== null && typeof id !== "number" && typeof id !== "string") {
			return {
				kind: "invalid",
				error: { code: RpcErrorCode.INVALID_REQUEST, message: "Invalid id" },
			};
		}
		return {
			kind: "request",
			id: id as number | string | null,
			method: obj.method,
			params: obj.params,
		};
	}

	return { kind: "notification", method: obj.method, params: obj.params };
}

export function rpcSuccess(id: number | string | null, result: unknown): JsonRpcResponse {
	return { jsonrpc: RPC_VERSION, id, result };
}

export function rpcError(id: number | string | null, error: JsonRpcError): JsonRpcResponse {
	return { jsonrpc: RPC_VERSION, id, error };
}

export function rpcNotification(method: string, params?: unknown): JsonRpcNotification {
	return { jsonrpc: RPC_VERSION, method, params };
}

/** Method names for client→server requests. */
export const RpcMethod = {
	workspacesList: "workspaces.list",
	workspacesCreate: "workspaces.create",
	workspacesRemove: "workspaces.remove",
	dialogsPickFolder: "dialogs.pickFolder",
	sessionsList: "sessions.list",
	sessionsCreate: "sessions.create",
	sessionsDelete: "sessions.delete",
	sessionsFork: "sessions.fork",
	sessionsMessages: "sessions.messages",
	sessionsUsage: "sessions.usage",
	sessionsUpdateModel: "sessions.updateModel",
	chatSend: "chat.send",
	chatSteer: "chat.steer",
	chatFollowUp: "chat.followUp",
	chatAbort: "chat.abort",
	modelsProviders: "models.providers",
	modelsAvailable: "models.available",
	modelsCheckAuth: "models.checkAuth",
	modelsSetApiKey: "models.setApiKey",
	modelsLogin: "models.login",
	modelsLogout: "models.logout",
	pluginsList: "plugins.list",
	pluginsAdd: "plugins.add",
	pluginsRemove: "plugins.remove",
	pluginsSetEnabled: "plugins.setEnabled",
	settingsGet: "settings.get",
	settingsSet: "settings.set",
} as const;

/** Notification names for server→client pushes. */
export const RpcEvent = {
	sessionStatus: "session.status",
	sessionDelta: "session.delta",
	sessionToolStart: "session.tool_start",
	sessionToolUpdate: "session.tool_update",
	sessionToolEnd: "session.tool_end",
	sessionMessageEnd: "session.message_end",
	sessionTitleUpdated: "session.title_updated",
	sessionRunEnd: "session.run_end",
	workspaceUpdated: "workspace.updated",
} as const;
