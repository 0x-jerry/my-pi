export { CoreApp, type CoreAppOptions } from "./app";
export { EventBus } from "./events/event-bus";
export { openDatabase, DEFAULT_DB_PATH } from "./db/connection";
export { migrate } from "./db/migrations";
export { JsonRpcServer, RpcParamsError, type JsonRpcServerOptions } from "./rpc/server";
export { registerRpcMethods } from "./rpc/methods";
export { WorkspaceService } from "./workspaces/workspace-service";
export { SessionService, toSessionInfo, type ResumePayload } from "./sessions/session-service";
export { SettingsService } from "./settings/settings-service";
export {
	settingSchemas,
	getSettingSchema,
	SettingsValidationError,
	type AllSettings,
	type SettingKey,
	type SettingValue,
} from "./settings/settings-schema";
export { PluginService, type BuiltinPlugin } from "./plugins/plugin-service";
export { builtinPlugins } from "./plugins/builtin";
export { AgentPool, type AgentPoolDeps } from "./agents/agent-pool";
export { PersistenceWriter, type PersistenceWriterDeps } from "./persistence/writer";
export { TranscriptReader } from "./persistence/reader";
export { toStoredMessage } from "./persistence/mapping";
export * from "./db/repos";
export type * from "@my-pi/shared";
