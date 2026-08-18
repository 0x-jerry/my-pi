import { RpcMethod } from "@my-pi/shared";
import { RpcParamsError, type JsonRpcServer } from "./server";
import type { CoreApp } from "../app";

/**
 * Extract request params as an object. Methods that require params throw
 * RpcParamsError when params are missing or not an object; optional-param
 * methods pass `required: false` to get `{}`.
 *
 * NOTE: with the @0x-jerry/utils engine a thrown RpcParamsError surfaces as
 * ServerError (-32000), not INVALID_PARAMS (-32602) — the engine only
 * preserves codes in the -32099..-32000 range (see server.ts).
 */
function params(raw: unknown, required = true): any {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		if (required) throw new RpcParamsError("params must be an object");
		return {};
	}
	return raw;
}

/** Bind every core service to the JSON-RPC method registry. */
export function registerRpcMethods(server: JsonRpcServer, app: CoreApp): void {
	// Workspaces
	server.register(RpcMethod.workspacesList, () => app.workspaces.list());
	server.register(RpcMethod.workspacesCreate, (p) =>
		app.createWorkspace(params(p)),
	);
	server.register(RpcMethod.workspacesRemove, (p) =>
		app.removeWorkspace(params(p).id),
	);

	// Native dialogs (folder picker provided by the shell)
	server.register(RpcMethod.dialogsPickFolder, async () =>
		app.pickFolder ? await app.pickFolder() : null,
	);

	// Sessions
	server.register(RpcMethod.sessionsList, (p) =>
		app.sessions.list(params(p).workspaceId),
	);
	server.register(RpcMethod.sessionsCreate, (p) => app.createSession(params(p)));
	server.register(RpcMethod.sessionsDelete, (p) =>
		app.deleteSession(params(p).id),
	);
	server.register(RpcMethod.sessionsFork, (p) => {
		const q = params(p);
		return app.forkSession(q.id, q.uptoSeq);
	});
	server.register(RpcMethod.sessionsMessages, (p) =>
		app.getMessages(params(p).id),
	);
	server.register(RpcMethod.sessionsUsage, (p) =>
		app.getTokenUsage(params(p).id),
	);
	server.register(RpcMethod.sessionsUpdateModel, (p) => {
		const q = params(p);
		return app.updateSessionModel(q.id, q.model);
	});

	// Chat
	server.register(RpcMethod.chatSend, (p) => {
		const q = params(p);
		return app.sendMessage(q.sessionId, q.text);
	});
	server.register(RpcMethod.chatSteer, (p) => {
		const q = params(p);
		return app.pool.steer(q.sessionId, q.text);
	});
	server.register(RpcMethod.chatFollowUp, (p) => {
		const q = params(p);
		return app.pool.followUp(q.sessionId, q.text);
	});
	server.register(RpcMethod.chatAbort, (p) =>
		app.pool.abort(params(p).sessionId),
	);

	// Models & auth
	server.register(RpcMethod.modelsProviders, () => app.modelService.listProviders());
	server.register(RpcMethod.modelsAvailable, (p) =>
		app.modelService.listAvailable(params(p, false).providerId),
	);
	server.register(RpcMethod.modelsCheckAuth, (p) =>
		app.modelService.checkAuth(params(p).providerId),
	);
	server.register(RpcMethod.modelsSetApiKey, (p) => {
		const q = params(p);
		return app.modelService.setRuntimeApiKey(q.providerId, q.apiKey);
	});
	server.register(RpcMethod.modelsLogin, (p) => {
		const q = params(p);
		return app.modelService.loginApiKey(q.providerId, q.apiKey);
	});
	server.register(RpcMethod.modelsLogout, (p) =>
		app.modelService.logout(params(p).providerId),
	);

	// Plugins
	server.register(RpcMethod.pluginsList, (p) =>
		app.plugins.list(params(p, false).workspaceId),
	);
	server.register(RpcMethod.pluginsAdd, (p) => app.plugins.addPathPlugin(params(p)));
	server.register(RpcMethod.pluginsRemove, (p) =>
		app.plugins.remove(params(p).id),
	);
	server.register(RpcMethod.pluginsSetEnabled, (p) => {
		const q = params(p);
		return app.plugins.setEnabled(q.id, q.enabled);
	});

	// Settings
	server.register(RpcMethod.settingsGet, (p) => {
		const q = params(p, false);
		return app.settings.get(q.key, q.fallback);
	});
	server.register(RpcMethod.settingsSet, (p) => {
		const q = params(p);
		return app.settings.set(q.key, q.value);
	});
}
