import { afterEach, describe, expect, test } from "bun:test";
import { RpcMethod } from "@my-pi/shared";
import { JsonRpcServer, RpcParamsError } from "../src/rpc/server";

let server: JsonRpcServer | undefined;

afterEach(async () => {
	await server?.stop();
	server = undefined;
});

async function startServer(
	opts: { token?: string; allowedOrigin?: string } = {},
): Promise<number> {
	server = new JsonRpcServer({
		port: 0,
		token: opts.token,
		allowedOrigin: opts.allowedOrigin,
	});
	server.register("ping", (p) => ({ pong: p }));
	server.register("boom", () => {
		throw new Error("kaboom");
	});
	server.register("needs", (p) => {
		if (typeof p !== "object" || p === null || Array.isArray(p)) {
			throw new RpcParamsError();
		}
		return { got: p };
	});
	server.register(RpcMethod.workspacesList, () => [{ id: "w1", name: "Demo" }]);
	return server.start();
}

function connect(port: number, token?: string): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const url = `ws://127.0.0.1:${port}/ws`;
		const ws = token ? new WebSocket(url, token) : new WebSocket(url);
		ws.onopen = () => resolve(ws);
		ws.onerror = () => reject(new Error("connection failed"));
	});
}

function request(ws: WebSocket, id: number, method: string, params?: unknown) {
	ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
}

function nextMessage(ws: WebSocket): Promise<unknown> {
	return new Promise((resolve) => {
		ws.onmessage = (e) => {
			resolve(JSON.parse(String(e.data)));
		};
	});
}

describe("JsonRpcServer", () => {
	test("answers requests and propagates errors", async () => {
		const port = await startServer();
		const ws = await connect(port);

		request(ws, 1, "ping", { x: 1 });
		const reply = (await nextMessage(ws)) as { id: number; result: unknown };
		expect(reply.id).toBe(1);
		expect(reply.result).toEqual({ pong: { x: 1 } });

		request(ws, 2, "boom");
		const err = (await nextMessage(ws)) as { error: { code: number; message: string } };
		expect(err.error.code).toBe(-32603);
		expect(err.error.message).toBe("kaboom");

		ws.close();
	});

	test("rejects unknown methods with -32601", async () => {
		const port = await startServer();
		const ws = await connect(port);
		request(ws, 3, "nope");
		const err = (await nextMessage(ws)) as { error: { code: number } };
		expect(err.error.code).toBe(-32601);
		ws.close();
	});

	test("replies with parse error to invalid JSON", async () => {
		const port = await startServer();
		const ws = await connect(port);
		ws.send("{bad json");
		const err = (await nextMessage(ws)) as { error: { code: number } };
		expect(err.error.code).toBe(-32700);
		ws.close();
	});

	test("maps RpcParamsError to -32602 INVALID_PARAMS", async () => {
		const port = await startServer();
		const ws = await connect(port);
		request(ws, 4, "needs"); // params omitted
		const err = (await nextMessage(ws)) as { error: { code: number } };
		expect(err.error.code).toBe(-32602);
		request(ws, 5, "needs", { a: 1 }); // object params are fine
		const ok = (await nextMessage(ws)) as { result: unknown };
		expect(ok.result).toEqual({ got: { a: 1 } });
		ws.close();
	});

	test("answers requests with null id", async () => {
		const port = await startServer();
		const ws = await connect(port);
		ws.send(JSON.stringify({ jsonrpc: "2.0", id: null, method: "ping" }));
		const reply = (await nextMessage(ws)) as { id: null };
		expect(reply.id).toBe(null);
		ws.close();
	});

	test("pushes notifications to connected clients", async () => {
		const port = await startServer();
		const ws = await connect(port);
		server!.notify("session.delta", { delta: "hi" });
		const msg = (await nextMessage(ws)) as { method: string; params: unknown };
		expect(msg.method).toBe("session.delta");
		expect(msg.params).toEqual({ delta: "hi" });
		ws.close();
	});

	test("rejects connections with a wrong token", async () => {
		const port = await startServer({ token: "secret" });

		// Wrong token via subprotocol.
		const wrong = await fetch(`http://127.0.0.1:${port}/ws`, {
			headers: {
				upgrade: "websocket",
				connection: "Upgrade",
				"sec-websocket-protocol": "wrong",
			},
		});
		expect(wrong.status).toBe(403);

		// Wrong token via query param.
		const wrongQuery = await fetch(`http://127.0.0.1:${port}/ws?token=wrong`);
		expect(wrongQuery.status).toBe(403);

		// Missing token entirely.
		const none = await fetch(`http://127.0.0.1:${port}/ws`);
		expect(none.status).toBe(403);

		// Correct token via subprotocol → handshake proceeds (not 403). The
		// server echoes the subprotocol; 101 or 400 are both acceptable here.
		const ok = await fetch(`http://127.0.0.1:${port}/ws`, {
			headers: {
				upgrade: "websocket",
				connection: "Upgrade",
				"sec-websocket-protocol": "secret",
			},
		});
		expect(ok.status).not.toBe(403);

		// Correct token via query param (fallback) → also not 403.
		const okQuery = await fetch(`http://127.0.0.1:${port}/ws?token=secret`, {
			headers: { upgrade: "websocket", connection: "Upgrade" },
		});
		expect(okQuery.status).not.toBe(403);
	});

	test("connects over the wire with a subprotocol token", async () => {
		const port = await startServer({ token: "secret" });
		const ws = await connect(port, "secret");
		request(ws, 1, "ping");
		const reply = (await nextMessage(ws)) as { result: unknown };
		expect(reply.result).toEqual({ pong: undefined });
		ws.close();
	});

	test("enforces allowedOrigin (missing or wrong origin rejected)", async () => {
		const port = await startServer({ allowedOrigin: "http://localhost:5173" });

		const noOrigin = await fetch(`http://127.0.0.1:${port}/ws`, {
			headers: { upgrade: "websocket", connection: "Upgrade" },
		});
		expect(noOrigin.status).toBe(403);

		const wrong = await fetch(`http://127.0.0.1:${port}/ws`, {
			headers: {
				upgrade: "websocket",
				connection: "Upgrade",
				origin: "http://evil.example",
			},
		});
		expect(wrong.status).toBe(403);

		const ok = await fetch(`http://127.0.0.1:${port}/ws`, {
			headers: {
				upgrade: "websocket",
				connection: "Upgrade",
				origin: "http://localhost:5173",
			},
		});
		expect(ok.status).not.toBe(403);
	});

	test("404 for non-ws paths", async () => {
		const port = await startServer();
		const res = await fetch(`http://127.0.0.1:${port}/other`);
		expect(res.status).toBe(404);
	});
});
