import "./app.css"
import { createApp } from "vue"
import App from "./App.vue"
import { RpcClient } from "./rpc/client"
import { Store, StoreKey } from "./store"

/**
 * Resolve the core WS endpoint config. Sources, in order:
 * 1. Query params `?ws=<port>&token=<secret>` — appended by the shell to the
 *    dev-server URL (verified to survive).
 * 2. `window.__MY_PI_WS_CONFIG__` — injected by the shell via executeJavascript
 *    on dom-ready. Needed because the packaged `views://` scheme resolves files
 *    by exact path and rejects query/fragment strings.
 */
async function resolveWsConfig(): Promise<{ ws: string; token: string } | null> {
  const params = new URLSearchParams(location.search)
  const qsWs = params.get("ws")
  const qsToken = params.get("token")
  if (qsWs && qsToken) return { ws: qsWs, token: qsToken }

  const injected = window.__MY_PI_WS_CONFIG__
  if (injected) return { ws: String(injected.ws), token: injected.token }

  // The shell injects shortly after the page loads — poll briefly.
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 150))
    const cfg = window.__MY_PI_WS_CONFIG__
    if (cfg) return { ws: String(cfg.ws), token: cfg.token }
  }
  return null
}

const config = await resolveWsConfig()

const store = new Store(
  new RpcClient({
    url: config ? `ws://127.0.0.1:${config.ws}/ws` : "",
    token: config?.token ?? "",
  }),
)

if (!config) {
  store.state.error =
    "No server connection config received (?ws=&token= or __MY_PI_WS_CONFIG__). Start the app via the my-pi shell."
}

const app = createApp(App)
app.provide(StoreKey, store)
app.mount("#app")

if (config) {
  store.init()
}
