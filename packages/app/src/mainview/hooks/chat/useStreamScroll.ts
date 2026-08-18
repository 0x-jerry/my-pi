import { nextTick, watch, type Ref } from "vue"

/**
 * Keep a scrollable transcript pinned to the bottom whenever the message count
 * or the live stream buffers grow. `getSources` returns the reactive values to
 * watch; `scroller` is the element ref to scroll.
 */
export function useStreamScroll(
  getSources: () => unknown[],
  scroller: Ref<HTMLElement | null>,
): void {
  watch(getSources, () => {
    void nextTick(() => {
      if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight
    })
  })
}
