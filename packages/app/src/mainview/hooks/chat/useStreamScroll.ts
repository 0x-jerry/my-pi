import { nextTick, watch, type Ref } from "vue"

function scrollToBottom(scroller: HTMLElement | null): void {
  if (scroller) scroller.scrollTop = scroller.scrollHeight
}

/**
 * Scroll a transcript to the bottom after the DOM settles. Comark's <Markdown>
 * renders asynchronously (async parse + shiki highlight) under <Suspense>,
 * resolving after the synchronous nextTick flush — so a single nextTick can
 * race the content growth. We scroll again on the next animation frame and
 * after a follow-up microtask to catch content that lands one render later.
 */
function scrollSoon(scroller: Ref<HTMLElement | null>): void {
  void nextTick(() => {
    scrollToBottom(scroller.value)
    requestAnimationFrame(() => {
      scrollToBottom(scroller.value)
      void nextTick(() => scrollToBottom(scroller.value))
    })
  })
}

/**
 * Keep a scrollable transcript pinned to the bottom whenever the message count
 * or the live stream buffers grow. `getSources` returns the reactive values to
 * watch; `scroller` is the element ref to scroll.
 */
export function useStreamScroll(
  getSources: () => unknown[],
  scroller: Ref<HTMLElement | null>,
): void {
  watch(getSources, () => scrollSoon(scroller))
}
