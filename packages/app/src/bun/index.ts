import { BrowserWindow, Updater } from "electrobun/bun"
import { CoreApp } from "@my-pi/core"

const DEV_SERVER_PORT = 5173
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`

// Check if Vite dev server is running for HMR
async function getMainViewUrl(): Promise<string> {
  const channel = await Updater.localInfo.channel()
  if (channel === "dev") {
    try {
      await fetch(DEV_SERVER_URL, { method: "HEAD" })
      console.log(`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`)
      return DEV_SERVER_URL
    } catch {
      console.log(
        "Vite dev server not running. Run 'bun run dev:hmr' for HMR support.",
      )
    }
  }
  return "views://mainview/index.html"
}

/**
 * Append the WS port + auth token to an HTTP view URL (dev server). The
 * subprotocol remains the primary auth transport; the query token is only a
 * fallback. NOTE: the packaged `views://` scheme handler resolves files by
 * exact path and rejects query/fragment strings — for those URLs the config
 * is delivered via executeJavascript (see injectWsConfig). The token is a
 * fresh per-launch secret on a 127.0.0.1-bound socket, so the dev-only URL
 * exposure is accepted; packaged builds never put it in the URL.
 */
function withServerParams(url: string, wsPort: number, wsToken: string): string {
  const u = new URL(url)
  u.searchParams.set("ws", String(wsPort))
  u.searchParams.set("token", wsToken)
  return u.toString()
}

// Boot core: sqlite + services + agent pool + JSON-RPC server on a random
// localhost port with a fresh per-launch token.
const app = await CoreApp.create({ wsPort: 0 })
console.log(`CoreApp started: ws://127.0.0.1:${app.wsPort}/ws`)

const baseUrl = await getMainViewUrl()
const url =
  baseUrl.startsWith("http")
    ? withServerParams(baseUrl, app.wsPort, app.wsToken)
    : baseUrl

const mainWindow = new BrowserWindow({
  title: "my-pi",
  url,
  frame: {
    width: 1200,
    height: 800,
    x: 200,
    y: 200,
  },
})

/**
 * Deliver the WS config to the view. `views://` cannot carry query params,
 * so set a plain window global once the page's DOM is ready (and once
 * immediately, in case dom-ready already fired). The view polls this global
 * briefly as its fallback.
 */
function injectWsConfig(): void {
  const payload = JSON.stringify({ ws: app.wsPort, token: app.wsToken })
  mainWindow.webview.executeJavascript(
    `window.__MY_PI_WS_CONFIG__ = ${payload}; true;`,
  )
}
injectWsConfig()
mainWindow.webview.on("dom-ready", () => injectWsConfig())

// Process lifecycle: dispose agents, close the WS server and the sqlite db on
// SIGINT/SIGTERM (dev Ctrl+C). On window close the process exits via
// electrobun's exitOnLastWindowClosed; sqlite WAL recovers on next open.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`${signal} received, disposing CoreApp…`)
    void app.dispose().finally(() => process.exit(0))
  })
}

console.log("my-pi started!")
