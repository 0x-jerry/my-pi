export { PiAgent, type PiAgentConfig } from "./pi-agent";
export { ModelService, type ModelServiceOptions } from "./model-service";
export {
	buildResourceLoader,
	type BuildResourceLoaderOptions,
} from "./resource-loader";
export {
	serializeMessage,
	serializeMessages,
	toUsageSummary,
	findAgentError,
} from "./serialize";
export { mapAgentSessionEvent, type MapperContext } from "./mapper";

// Re-export pi types that leak through this package's public API, so
// consumers (core) never import pi packages directly.
export type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
export type { Usage, Model } from "@earendil-works/pi-ai";
export type {
	ApiKeyCredential,
	AuthOperationOptions,
	Credential,
	CredentialInfo,
	CredentialStore,
	OAuthCredential,
} from "@earendil-works/pi-ai";
export type { ModelRuntime } from "@earendil-works/pi-coding-agent";
export type {
	InlineExtension,
	ExtensionAPI,
	ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
