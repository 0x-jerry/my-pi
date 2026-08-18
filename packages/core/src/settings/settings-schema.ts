import { THINKING_LEVELS, type SettingKey } from "@my-pi/shared";
import { z } from "zod";

export type { SettingKey };

/**
 * A setting was rejected: unknown key, or a value that doesn't match the
 * schema registered for that key. Thrown by SettingsService.get/set; the
 * message is surfaced to RPC clients as a ServerError.
 */
export class SettingsValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SettingsValidationError";
	}
}

/** Model-setting value: { provider, id } (null means "cleared"). */
const modelSchema = z
	.object({
		provider: z.string(),
		id: z.string(),
	})
	.nullable();

/**
 * Closed map of every allowed settings key and the schema its value must
 * satisfy. Adding a new setting is a one-line addition here; the
 * SettingsService types (`SettingValue`) update automatically. The key set
 * is pinned to the shared `SETTING_KEYS` list (single source of truth for
 * the RPC contract); adding or dropping a key without updating the list is
 * a compile error.
 */
export const settingSchemas = {
	chatModel: modelSchema,
	defaultModel: modelSchema,
	titleModel: modelSchema,
	defaultThinkingLevel: z.enum(THINKING_LEVELS).nullable(),
} as const satisfies Record<SettingKey, unknown>;

// Compile-time guard: the map's key set must EXACTLY equal the shared
// SETTING_KEYS list. `satisfies` above already rejects missing keys; this
// assertion rejects extras. If either drifts, `_settingKeysMatch` resolves
// to a false literal and the assignment fails to compile.
type _MapKeys = keyof typeof settingSchemas;
type _SettingKeysMatch = [Exclude<SettingKey, _MapKeys>, Exclude<_MapKeys, SettingKey>] extends [
	never,
	never,
]
	? true
	: false;
const _settingKeysMatch: _SettingKeysMatch = true;
void _settingKeysMatch; // referenced so the type-level guard is enforced

export type SettingValue<K extends SettingKey> = z.infer<
	(typeof settingSchemas)[K]
>;

/** Snapshot of a settings store: every known key, each with its own value type. */
export type AllSettings = { [K in SettingKey]?: SettingValue<K> };

/**
 * Look up the schema registered for a key. Returns undefined for keys that
 * are not in the closed map (callers decide how to reject them).
 */
export function getSettingSchema(key: string): z.ZodType | undefined {
	return (settingSchemas as Record<string, z.ZodType | undefined>)[key];
}
