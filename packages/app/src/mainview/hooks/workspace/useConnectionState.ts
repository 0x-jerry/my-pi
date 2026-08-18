import { computed } from "vue"
import { useConnectionStore } from "../../stores"

/**
 * Logo color mirrors the connection state (see connectionStore):
 * ok when connected, warn while (re)connecting, offline otherwise.
 */
export function useConnectionState() {
  const connection = useConnectionStore()

  const logoClass = computed(() => {
    switch (connection.state.connectionState) {
      case "connected":
        return "logo-ok"
      case "connecting":
      case "reconnecting":
        return "logo-warn"
      default:
        return "logo-offline"
    }
  })

  return { logoClass }
}
