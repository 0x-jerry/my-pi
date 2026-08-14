// Global ambient declarations (non-module file → merges into global scope).
// The app shell injects the core WS endpoint config into the view via
// executeJavascript on dom-ready (the packaged views:// scheme can't carry
// query params); query params (?ws=&token=) are the dev-server fallback.
interface Window {
  __MY_PI_WS_CONFIG__?: { ws: number; token: string }
}
