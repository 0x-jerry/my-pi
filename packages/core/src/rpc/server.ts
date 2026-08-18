import { createHash, timingSafeEqual } from "node:crypto";
import type { Server, ServerWebSocket } from "bun";
import { JsonRpcServer as JsonRpcEngine } from "@0x-jerry/utils";
import { RpcErrorCode } from "@my-pi/shared";

export interface JsonRpcServerOptions {
	host?: string;
	/** 0 = pick a free port. */
	port?: number;
	/**
	 * If set, clients must present this token. Preferred transport is the
	 * WebSocket subprotocol (`new WebSocket(url, token)`), which keeps the
	 * secret out of URLs and process lists; `?token=` is accepted as a
	 * fallback. Comparisons are constant-time.
	 */
	token?: string;
	/** If set, the upgrade must carry exactly this Origin header. */
	allowedOrigin?: string;
}

type Handler = (params: any) => unknown | Promise<unknown>;

/**
 * Thrown by handlers when request params are missing or malformed.
 *
 * NOTE: with the @0x-jerry/utils JSON-RPC engine this surfaces as a
 * ServerError (-32000) rather than INVALID_PARAMS (-32602), because the
 * engine only preserves implementation error codes in the -32099..-32000
 * range. The message is still returned to the client.
 */
export class RpcParamsError extends Error {
	constructor(message = "Invalid params") {
		super(message);
		this.name = "RpcParamsError";
	}
}

/** Constant-time string comparison (safe against length-timing too). */
function safeEqual(a: string, b: string): boolean {
	const ha = createHash("sha256").update(a).digest();
	const hb = createHash("sha256").update(b).digest();
	return timingSafeEqual(ha, hb);
}

/**
 * JSON-RPC 2.0 server over WebSocket (Bun.serve), bound to 127.0.0.1.
 *
 * The WebSocket transport (upgrade/auth, socket tracking, broadcast
 * notifications) lives here; per-connection request dispatch is delegated to
 * `JsonRpcServer` from @0x-jerry/utils (one engine per socket), typed by the
 * shared `RpcMethods`/`RpcNotifications` contracts. Client→server
 * notifications are ignored (no handlers registered).
 *
 * Behavior note vs. the pre-refactor server: request ids of `null` are now
 * rejected with InvalidRequest (-32600) by the engine (the spec discourages
 * the null id; the first-party client never sends it).
 */
export class JsonRpcServer {
	private server?: Server<undefined>;
	private sockets = new Map<ServerWebSocket, JsonRpcEngine>();
	private handlers = new Map<string, Handler>();

	constructor(private opts: JsonRpcServerOptions = {}) {}

	register(method: string, handler: Handler): void {
		this.handlers.set(method, handler);
		for (const engine of this.sockets.values()) {
			this.bind(engine, method, handler);
		}
	}

	/** Start listening; resolves with the actual port. */
	async start(): Promise<number> {
		if (this.server) return this.server.port!;
		const opts = this.opts;
		this.server = Bun.serve({
			hostname: opts.host ?? "127.0.0.1",
			port: opts.port ?? 0,
			fetch: (req, server) => this.handleFetch(req, server),
			websocket: {
				open: (ws) => {
					this.attach(ws);
				},
				message: (ws, message) => {
					void this.handleMessage(ws, message);
				},
				close: (ws) => {
					this.sockets.delete(ws);
				},
			},
		});
		return this.server.port!;
	}

	private attach(ws: ServerWebSocket): void {
		const engine = new JsonRpcEngine((message) => {
			// JSON cannot represent `undefined`; the @0x-jerry/utils client only
			// recognizes responses with exactly one of result/error present, so
			// coerce undefined results to null or the call would hang.
			const out = message as unknown as Record<string, unknown>;
			if (
				"id" in out &&
				out.error === undefined &&
				out.result === undefined
			) {
				out.result = null;
			}
			ws.send(JSON.stringify(out));
		});
		for (const [method, handler] of this.handlers) {
			this.bind(engine, method, handler);
		}
		this.sockets.set(ws, engine);
	}

	private bind(engine: JsonRpcEngine, method: string, handler: Handler): void {
		engine.onRequest(method, (params) => handler(params));
	}

	private handleFetch(
		req: Request,
		server: Server<undefined>,
	): Response | undefined {
		const url = new URL(req.url);
		if (url.pathname !== "/ws") {
			return new Response("Not Found", { status: 404 });
		}

		const token = this.opts.token;
		const subprotocols = (req.headers.get("sec-websocket-protocol") ?? "")
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		const queryToken = url.searchParams.get("token");

		// Token via subprotocol (preferred; must be echoed for the handshake)
		// or ?token= query param (fallback).
		let echoSubprotocol: string | undefined;
		if (token) {
			if (subprotocols.length > 0) {
				echoSubprotocol = subprotocols.find((p) => safeEqual(p, token));
				if (!echoSubprotocol) {
					return new Response("Forbidden", { status: 403 });
				}
			} else if (queryToken === null || !safeEqual(queryToken, token)) {
				return new Response("Forbidden", { status: 403 });
			}
		}

		// Browsers are not subject to CORS on WebSocket handshakes, so when an
		// allowed origin is configured, require the header outright: omitting it
		// must not bypass the check (curl / native clients included).
		if (this.opts.allowedOrigin) {
			const origin = req.headers.get("origin");
			if (!origin || origin !== this.opts.allowedOrigin) {
				return new Response("Forbidden", { status: 403 });
			}
		}

		const upgraded = echoSubprotocol
			? server.upgrade(req, {
					headers: { "Sec-WebSocket-Protocol": echoSubprotocol },
				})
			: server.upgrade(req);
		if (!upgraded) return new Response("Upgrade Failed", { status: 400 });
		return undefined;
	}

	private handleMessage(ws: ServerWebSocket, raw: string | Buffer): void {
		const text = typeof raw === "string" ? raw : raw.toString();
		let msg: unknown;
		try {
			msg = JSON.parse(text);
		} catch {
			this.sendRaw(ws, {
				jsonrpc: "2.0",
				id: null,
				error: { code: RpcErrorCode.PARSE_ERROR, message: "Parse error" },
			});
			return;
		}

		// Preserve the old protocol boundary: params must be a structured value
		// (object or array) when present, else the request is invalid. The
		// @0x-jerry/utils engine passes params straight through to handlers, so
		// guard here to keep bad shapes from reaching them.
		const record = msg as Record<string, unknown> | null;
		if (
			msg !== null &&
			typeof msg === "object" &&
			!Array.isArray(msg) &&
			"params" in msg &&
			record!.params !== undefined &&
			(typeof record!.params !== "object" || record!.params === null)
		) {
			this.sendRaw(ws, {
				jsonrpc: "2.0",
				id: null,
				error: {
					code: RpcErrorCode.INVALID_REQUEST,
					message: "params must be an object or array",
				},
			});
			return;
		}

		const engine = this.sockets.get(ws);
		if (engine) engine.handleMessage(msg);
	}

	/** Broadcast a server→client notification to all connected views. */
	notify(method: string, params?: unknown): void {
		if (this.sockets.size === 0) return;
		const payload = JSON.stringify({ jsonrpc: "2.0", method, params });
		for (const ws of this.sockets.keys()) ws.send(payload);
	}

	private sendRaw(ws: ServerWebSocket, payload: unknown): void {
		ws.send(JSON.stringify(payload));
	}

	async stop(): Promise<void> {
		if (!this.server) return;
		for (const ws of this.sockets.keys()) ws.close();
		this.sockets.clear();
		this.server.stop(true);
		this.server = undefined;
	}
}
