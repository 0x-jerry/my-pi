import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db/connection";
import { migrate } from "../src/db/migrations";
import { SettingsRepo } from "../src/db/repos";
import { SettingsService } from "../src/settings/settings-service";
import {
	SettingsValidationError,
	settingSchemas,
} from "../src/settings/settings-schema";
import type { SettingValue } from "../src/settings/settings-schema";

let dir: string;
let db: ReturnType<typeof openDatabase>;
let repo: SettingsRepo;
let settings: SettingsService;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "my-pi-settings-"));
	db = openDatabase(join(dir, "test.db"));
	migrate(db);
	repo = new SettingsRepo(db);
	settings = new SettingsService(repo);
});

afterEach(() => {
	db.close();
	rmSync(dir, { recursive: true, force: true });
});

describe("SettingsService schema map", () => {
	test("contains exactly the known settings keys", () => {
		expect(Object.keys(settingSchemas).sort()).toEqual([
			"chatModel",
			"defaultModel",
			"defaultThinkingLevel",
			"titleModel",
		]);
	});

	test("valid keys are statically typed (compile-time check)", () => {
		// These lines type-check via the SettingKey/SettingValue map.
		const chat: SettingValue<"chatModel"> = { provider: "anthropic", id: "claude" };
		const level: SettingValue<"defaultThinkingLevel"> = "high";
		expect(chat).toEqual({ provider: "anthropic", id: "claude" });
		expect(level).toBe("high");
	});
});

describe("SettingsService.set/get round-trip", () => {
	test("round-trips every known key with a valid value", () => {
		const model = { provider: "anthropic", id: "claude-opus" };
		settings.set("chatModel", model);
		settings.set("defaultModel", model);
		settings.set("titleModel", model);
		settings.set("defaultThinkingLevel", "high");

		expect(settings.get("chatModel")).toEqual(model);
		expect(settings.get("defaultModel")).toEqual(model);
		expect(settings.get("titleModel")).toEqual(model);
		expect(settings.get("defaultThinkingLevel")).toBe("high");
	});

	test("returns undefined for an absent key (fallback only when given)", () => {
		expect(settings.get("chatModel")).toBeUndefined();
		expect(settings.get("chatModel", undefined)).toBeUndefined();
		expect(settings.get("chatModel", null)).toBeNull();
		expect(settings.get("chatModel", { provider: "d", id: "m" })).toEqual({
			provider: "d",
			id: "m",
		});
	});

	test("rejects a fallback that doesn't match the key's schema", () => {
		expect(() => settings.get("defaultThinkingLevel", "bogus")).toThrow(
			SettingsValidationError,
		);
		expect(() => settings.get("chatModel", "not-a-model")).toThrow(
			SettingsValidationError,
		);
	});

	test("set strips unknown fields (zod object default)", () => {
		settings.set("chatModel", {
			provider: "a",
			id: "b",
			extra: 1,
		} as never); // deliberate superset; the schema strips `extra`
		expect(settings.get("chatModel")).toEqual({ provider: "a", id: "b" });
	});

	test("null is stored and returned as null (cleared setting)", () => {
		settings.set("chatModel", null);
		expect(settings.get("chatModel")).toBeNull();
		expect(settings.get("chatModel", { provider: "d", id: "m" })).toBeNull();
		// Raw storage preserves JSON `null`, matching the pre-validation behavior.
		expect(repo.get("chatModel")?.valueJson).toBe("null");
	});

	test("every thinking level value is accepted", () => {
		const levels: SettingValue<"defaultThinkingLevel">[] = [
			"off", "minimal", "low", "medium", "high", "xhigh", "max",
		];
		for (const level of levels) {
			settings.set("defaultThinkingLevel", level);
			expect(settings.get("defaultThinkingLevel")).toBe(level);
		}
	});
});

describe("SettingsService strict validation", () => {
	test("rejects unknown keys on set without writing", () => {
		expect(() => settings.set("noSuchKey", "x")).toThrow(SettingsValidationError);
		expect(() => settings.set("noSuchKey", "x")).toThrow(/unknown settings key/i);
		expect(repo.get("noSuchKey")).toBeNull();
	});

	test("rejects unknown keys on get", () => {
		expect(() => settings.get("noSuchKey")).toThrow(SettingsValidationError);
		expect(() => settings.get("noSuchKey")).toThrow(/unknown settings key/i);
	});

	test("rejects invalid values on set without writing", () => {
		expect(() => settings.set("defaultThinkingLevel", "bogus")).toThrow(
			SettingsValidationError,
		);
		expect(() => settings.set("chatModel", "nope")).toThrow(
			SettingsValidationError,
		);
		expect(() =>
			settings.set("chatModel", { provider: 1, id: "x" }),
		).toThrow(SettingsValidationError);
		expect(() => settings.set("chatModel", { provider: "a" })).toThrow(
			SettingsValidationError,
		);
		// Nothing was written.
		expect(repo.get("defaultThinkingLevel")).toBeNull();
		expect(repo.get("chatModel")).toBeNull();
	});

	test("rejects a stored value that no longer matches its schema on get", () => {
		repo.set("defaultThinkingLevel", JSON.stringify("bogus"));
		expect(() => settings.get("defaultThinkingLevel")).toThrow(
			SettingsValidationError,
		);
	});

	test("rejects corrupt stored JSON on get", () => {
		repo.set("chatModel", "{oops");
		expect(() => settings.get("chatModel")).toThrow(SettingsValidationError);
	});

	describe("SettingsService.all", () => {
		test("snapshots every stored valid setting", () => {
			const model = { provider: "anthropic", id: "claude-opus" };
			settings.set("chatModel", model);
			settings.set("titleModel", null);
			settings.set("defaultThinkingLevel", "high");

			const all = settings.all();
			expect(all.chatModel).toEqual(model);
			expect(all.titleModel).toBeNull(); // stored-but-cleared stays null
			expect(all.defaultThinkingLevel).toBe("high");
			expect(all.defaultModel).toBeUndefined(); // never written
		});

		test("ignores rows for keys outside the closed map", () => {
			repo.set("somePluginKey", JSON.stringify({ x: 1 }));
			expect(settings.all()).toEqual({});
		});

		test("skips corrupt or stale rows instead of throwing", () => {
			settings.set("chatModel", { provider: "a", id: "b" });
			repo.set("defaultThinkingLevel", "{oops"); // torn write
			repo.set("titleModel", JSON.stringify("not-a-model")); // stale value

			const all = settings.all();
			expect(all.chatModel).toEqual({ provider: "a", id: "b" });
			expect(all.defaultThinkingLevel).toBeUndefined();
			expect(all.titleModel).toBeUndefined();
		});
	});
});