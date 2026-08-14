import { describe, expect, test } from "bun:test";
import {
	parseRpcMessage,
	RpcErrorCode,
	rpcError,
	rpcNotification,
	rpcSuccess,
} from "../src";

describe("parseRpcMessage", () => {
	test("parses a request with numeric id", () => {
		const msg = parseRpcMessage(
			JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: { a: 1 } }),
		);
		expect(msg).toEqual({
			kind: "request",
			id: 1,
			method: "ping",
			params: { a: 1 },
		});
	});

	test("parses a request with string id", () => {
		const msg = parseRpcMessage(
			JSON.stringify({ jsonrpc: "2.0", id: "abc", method: "ping" }),
		);
		expect(msg.kind).toBe("request");
		if (msg.kind === "request") {
			expect(msg.id).toBe("abc");
			expect(msg.params).toBeUndefined();
		}
	});

	test("parses a request with null id", () => {
		const msg = parseRpcMessage(
			JSON.stringify({ jsonrpc: "2.0", id: null, method: "ping" }),
		);
		expect(msg).toEqual({ kind: "request", id: null, method: "ping" });
	});

	test("parses a notification (no id)", () => {
		const msg = parseRpcMessage(
			JSON.stringify({ jsonrpc: "2.0", method: "event", params: {} }),
		);
		expect(msg).toEqual({ kind: "notification", method: "event", params: {} });
	});

	test("rejects invalid JSON with PARSE_ERROR", () => {
		const msg = parseRpcMessage("{not json");
		expect(msg.kind).toBe("invalid");
		if (msg.kind === "invalid") {
			expect(msg.error.code).toBe(RpcErrorCode.PARSE_ERROR);
		}
	});

	test("rejects batches (arrays) with INVALID_REQUEST", () => {
		const msg = parseRpcMessage('[{"jsonrpc":"2.0","id":1,"method":"a"}]');
		expect(msg.kind).toBe("invalid");
		if (msg.kind === "invalid") {
			expect(msg.error.code).toBe(RpcErrorCode.INVALID_REQUEST);
		}
	});

	test("rejects wrong jsonrpc version", () => {
		const msg = parseRpcMessage(JSON.stringify({ jsonrpc: "1.0", method: "x" }));
		expect(msg.kind).toBe("invalid");
	});

	test("rejects missing method", () => {
		const msg = parseRpcMessage(JSON.stringify({ jsonrpc: "2.0", id: 1 }));
		expect(msg.kind).toBe("invalid");
	});

	test("accepts array (positional) params", () => {
		const msg = parseRpcMessage(
			JSON.stringify({ jsonrpc: "2.0", id: 1, method: "x", params: [1, 2] }),
		);
		expect(msg).toEqual({ kind: "request", id: 1, method: "x", params: [1, 2] });
	});

	test("rejects non-structured params (e.g. a string)", () => {
		const msg = parseRpcMessage(
			JSON.stringify({ jsonrpc: "2.0", id: 1, method: "x", params: "nope" }),
		);
		expect(msg.kind).toBe("invalid");
	});

	test("rejects non-numeric/string id", () => {
		const msg = parseRpcMessage(
			JSON.stringify({ jsonrpc: "2.0", id: true, method: "x" }),
		);
		expect(msg.kind).toBe("invalid");
	});
});

describe("response builders", () => {
	test("rpcSuccess", () => {
		expect(rpcSuccess(7, { ok: true })).toEqual({
			jsonrpc: "2.0",
			id: 7,
			result: { ok: true },
		});
	});

	test("rpcError", () => {
		expect(
			rpcError(null, { code: RpcErrorCode.INTERNAL_ERROR, message: "boom" }),
		).toEqual({
			jsonrpc: "2.0",
			id: null,
			error: { code: -32603, message: "boom" },
		});
	});

	test("rpcNotification", () => {
		expect(rpcNotification("session.status", { x: 1 })).toEqual({
			jsonrpc: "2.0",
			method: "session.status",
			params: { x: 1 },
		});
	});
});
