import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type {
	AuthCheck,
	AuthInteraction,
	CredentialStore,
	Model,
} from "@earendil-works/pi-ai";
import type { AuthStatus, ModelInfo, ProviderInfo } from "@my-pi/shared";

export interface ModelServiceOptions {
	authPath?: string;
	modelsPath?: string | null;
	/** Allow network refresh of model catalogs on create. Default false. */
	allowModelNetwork?: boolean;
	/**
	 * Credential storage. Defaults to pi's auth.json file at authPath.
	 * my-pi supplies a sqlite-backed store (see core SqliteCredentialStore).
	 */
	credentialStore?: CredentialStore;
}

/**
 * Owns the single shared pi ModelRuntime and exposes app-friendly views
 * (providers, available models, auth status, credential management).
 */
export class ModelService {
	private constructor(readonly runtime: ModelRuntime) {}

	static async create(options?: ModelServiceOptions): Promise<ModelService> {
		const runtime = await ModelRuntime.create({
			credentials: options?.credentialStore,
			authPath: options?.authPath,
			modelsPath: options?.modelsPath,
			allowModelNetwork: options?.allowModelNetwork ?? false,
		});
		return new ModelService(runtime);
	}

	async listProviders(): Promise<ProviderInfo[]> {
		const providers = this.runtime.getProviders();
		const out: ProviderInfo[] = [];
		for (const p of providers) {
			const check: AuthCheck | undefined = await this.runtime.checkAuth(p.id);
			out.push({
				id: p.id,
				name: p.name,
				authConfigured: this.runtime.hasConfiguredAuth(p.id),
				authType: check?.type,
				authSource: check?.source,
			});
		}
		return out;
	}

	async listAvailable(providerId?: string): Promise<ModelInfo[]> {
		const providers = this.runtime.getProviders();
		const names = new Map(providers.map((p) => [p.id, p.name]));
		const models = await this.runtime.getAvailable(providerId);
		return models.map((m) => ({
			providerId: m.provider,
			providerName: names.get(m.provider) ?? m.provider,
			id: m.id,
			name: m.name,
			reasoning: m.reasoning,
			contextWindow: m.contextWindow,
		}));
	}

	async checkAuth(providerId: string): Promise<AuthStatus> {
		const check = await this.runtime.checkAuth(providerId);
		return {
			providerId,
			configured: this.runtime.hasConfiguredAuth(providerId),
			type: check?.type,
			source: check?.source,
		};
	}

	/** Resolve a pi Model instance by provider/id (no auth check). */
	getModel(providerId: string, modelId: string): Model<"openai" | "anthropic" | string> | undefined {
		return this.runtime.getModel(providerId, modelId);
	}

	/** Runtime-only API key override (not persisted). */
	async setRuntimeApiKey(providerId: string, apiKey: string): Promise<void> {
		await this.runtime.setRuntimeApiKey(providerId, apiKey);
	}

	/** Persist an API key via the provider's login flow (auth.json). */
	async loginApiKey(providerId: string, apiKey: string): Promise<void> {
		const interaction: AuthInteraction = {
			prompt: async (prompt) => {
				if (prompt.type === "secret" || prompt.type === "text") return apiKey;
				throw new Error(`Unsupported auth prompt type: ${prompt.type}`);
			},
			notify: () => {},
		};
		await this.runtime.login(providerId, "api_key", interaction);
	}

	async logout(providerId: string): Promise<void> {
		await this.runtime.logout(providerId);
	}

	async refresh(): Promise<void> {
		await this.runtime.refresh();
	}
}
