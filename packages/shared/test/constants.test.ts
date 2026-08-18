import { describe, expect, test } from "bun:test";
import { RpcEvent, RpcMethod } from "../src";

/**
 * Sanity-checks the RpcMethod (client→server) and RpcEvent (server→client)
 * name constants. Note: a missing/mistyped constant also fails to compile in
 * core/app, where the constants are passed to the typed
 * JsonRpcClient/JsonRpcServer keyed by RpcMethods/RpcNotifications — these
 * runtime checks catch accidental duplicate or colliding names.
 */
describe("RpcMethod / RpcEvent constants", () => {
	const assertUniqueDotted = (names: string[], label: string) => {
		expect(new Set(names).size, `${label} names must be unique`).toBe(
			names.length,
		);
		for (const name of names) {
			expect(name, `${label} name format`).toMatch(/^[a-z][a-zA-Z0-9]*\.[\w.]+$/);
		}
	};

	test("RpcMethod values are unique dotted method names", () => {
		assertUniqueDotted(Object.values(RpcMethod), "RpcMethod");
	});

	test("RpcEvent values are unique dotted event names", () => {
		assertUniqueDotted(Object.values(RpcEvent), "RpcEvent");
	});

	test("method and event namespaces do not collide", () => {
		const methods = new Set<string>(Object.values(RpcMethod));
		for (const event of Object.values(RpcEvent)) {
			expect(methods.has(event), `event collides with a method: ${event}`).toBe(
				false,
			);
		}
	});
});
