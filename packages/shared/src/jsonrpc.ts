/**
 * JSON-RPC wire-coupling helpers shared by the core server and the app client.
 *
 * Framing itself is delegated to @0x-jerry/utils `JsonRpcClient`/`JsonRpcServer`;
 * this module only holds the bits core/app still reference directly:
 * `RpcErrorCode` (used by the core server's transport parse/param guards) and
 * the `RpcMethod`/`RpcEvent` name constants. The wire contracts live in
 * rpc-contracts.ts.
 */

/** Standard JSON-RPC 2.0 error codes. */
export const RpcErrorCode = {
	PARSE_ERROR: -32700,
	INVALID_REQUEST: -32600,
	METHOD_NOT_FOUND: -32601,
	INVALID_PARAMS: -32602,
	INTERNAL_ERROR: -32603,
} as const;

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
