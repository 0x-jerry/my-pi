/**
 * JSON-RPC method + notification contracts shared by the core server and the
 * app client.
 *
 * `RpcMethods` extends @0x-jerry/utils's `JsonRpcMethods` (a record of
 * `{ params; result }` contracts) and `RpcNotifications` extends its
 * `JsonRpcNotifications` (a record of method → params), so they can be passed
 * directly as the `Methods`/`Notifications` generics of the package's
 * `JsonRpcClient`/`JsonRpcServer` to fully type the wire pair.
 *
 * `params: undefined` marks a method that takes no arguments — the wire omits
 * `params` entirely and the client's `call()` makes the argument optional.
 */

import type {
	JsonRpcMethods,
	JsonRpcNotifications,
} from "@0x-jerry/utils";
import type {
	AddPluginInput,
	AuthStatus,
	CreateSessionInput,
	CreateWorkspaceInput,
	ModelInfo,
	PluginInfo,
	ProviderInfo,
	SessionInfo,
	StoredMessage,
	TokenUsageRow,
	UsageSummary,
	Workspace,
} from "./types";

/** Method → { params; result } contract map for every client→server method. */
export interface RpcMethods extends JsonRpcMethods {
	// Workspaces
	"workspaces.list": { params: undefined; result: Workspace[] };
	"workspaces.create": { params: CreateWorkspaceInput; result: Workspace };
	"workspaces.remove": { params: { id: string }; result: null };
	// Native dialogs
	"dialogs.pickFolder": { params: undefined; result: string | null };
	// Sessions
	"sessions.list": { params: { workspaceId: string }; result: SessionInfo[] };
	"sessions.create": { params: CreateSessionInput; result: SessionInfo };
	"sessions.delete": { params: { id: string }; result: null };
	"sessions.fork": {
		params: { id: string; uptoSeq?: number };
		result: SessionInfo;
	};
	"sessions.messages": { params: { id: string }; result: StoredMessage[] };
	"sessions.usage": { params: { id: string }; result: TokenUsageRow[] };
	"sessions.updateModel": {
		params: { id: string; model: { provider: string; id: string } };
		result: SessionInfo;
	};
	// Chat
	"chat.send": { params: { sessionId: string; text: string }; result: null };
	"chat.steer": {
		params: { sessionId: string; text: string };
		result: null;
	};
	"chat.followUp": {
		params: { sessionId: string; text: string };
		result: null;
	};
	"chat.abort": { params: { sessionId: string }; result: null };
	// Models & auth
	"models.providers": { params: undefined; result: ProviderInfo[] };
	"models.available": {
		params: { providerId?: string };
		result: ModelInfo[];
	};
	"models.checkAuth": { params: { providerId: string }; result: AuthStatus };
	"models.setApiKey": {
		params: { providerId: string; apiKey: string };
		result: null;
	};
	"models.login": {
		params: { providerId: string; apiKey: string };
		result: null;
	};
	"models.logout": { params: { providerId: string }; result: null };
	// Plugins
	"plugins.list": { params: { workspaceId?: string }; result: PluginInfo[] };
	"plugins.add": { params: AddPluginInput; result: PluginInfo };
	"plugins.remove": { params: { id: string }; result: null };
	"plugins.setEnabled": {
		params: { id: string; enabled: boolean };
		result: null;
	};
	// Settings
	/**
	 * `result` is whatever JSON value was stored under `key`, or `undefined`
	 * when absent. NOTE on the wire: JSON cannot carry `undefined`, and the
	 * server engine normalizes undefined results to `null`, so a missing key
	 * arrives as `null` — consumers should treat `null` as `undefined`.
	 */
	"settings.get": {
		params: { key: string; fallback?: unknown };
		result: unknown;
	};
	"settings.set": { params: { key: string; value: unknown }; result: null };
}

/** Notification method → params map for every server→client push. */
export interface RpcNotifications extends JsonRpcNotifications {
	"session.status": {
		sessionId: string;
		status: "idle" | "running" | "stopped" | "error";
		error?: string;
	};
	"session.delta": {
		sessionId: string;
		kind: "text" | "thinking";
		delta: string;
	};
	"session.tool_start": {
		sessionId: string;
		toolCallId: string;
		toolName: string;
		args: unknown;
	};
	"session.tool_update": {
		sessionId: string;
		toolCallId: string;
		toolName: string;
		partialResult: unknown;
	};
	"session.tool_end": {
		sessionId: string;
		toolCallId: string;
		toolName: string;
		isError: boolean;
		result: unknown;
	};
	"session.message_end": { sessionId: string; message: StoredMessage };
	"session.title_updated": {
		sessionId: string;
		title: string;
		updatedAt?: number;
	};
	"session.run_end": {
		sessionId: string;
		messages: StoredMessage[];
		usage: UsageSummary;
		error?: string;
		aborted: boolean;
	};
	"workspace.updated": { workspaceId: string };
}
