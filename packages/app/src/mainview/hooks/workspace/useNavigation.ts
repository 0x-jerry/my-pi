import { useRoute, useRouter } from "vue-router"

/** NavRail routing helpers: highlight the active route and navigate. */
export function useNavigation() {
  const route = useRoute()
  const router = useRouter()

  function isActive(name: string): boolean {
    return route.name === name
  }

  function go(path: string): void {
    void router.push(path)
  }

  return { isActive, go }
}
