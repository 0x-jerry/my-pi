<script setup lang="ts">
import { computed } from "vue"
import { Markdown } from "@comark/vue"
import type { ComarkPlugin } from "comark"
import { visit } from "comark/utils"
import security from "@comark/vue/plugins/security"
import breaks from "@comark/vue/plugins/breaks"
import math, { Math } from "@comark/vue/plugins/math"
import mermaid, { Mermaid } from "@comark/vue/plugins/mermaid"
import shiki from "@comark/vue/plugins/shiki"
import githubLight from "@shikijs/themes/github-light"

const props = defineProps<{
  content: string
  /** Render incremental content as it streams in. */
  streaming?: boolean
}>()

// Companion Vue components for the Comark `::math` / `::mermaid` elements.
const mdComponents = { math: Math, mermaid: Mermaid }

// Comark's `security()` strips blocked tags and on*/javascript: attributes, but
// lets `style` and `id` through. Model output is untrusted, so strip those too:
// `style` blocks CSS-injection overlays (e.g. position:fixed) and `id` prevents
// spoofed anchors/duplicate ids. Runs in a `post` hook that mutates the tree in
// place (like the built-in security plugin).
const attributeSanitizer: ComarkPlugin = {
  name: "app-attribute-sanitizer",
  post(state) {
    visit(
      state.tree,
      (node) => Array.isArray(node) && node[0] !== null,
      (node) => {
        const attrs = (node as unknown[])[1] as Record<string, unknown> | undefined
        if (attrs && typeof attrs === "object") {
          delete attrs.style
          delete attrs.id
        }
      },
    )
  },
}

// Plugin pipeline for chat markdown:
// - security: hardens model output — drops executable/embedding tags, strips
//   event-handler attributes and javascript:/data: URLs (see markdown.css for
//   prose styling of the rendered `.comark-content` wrapper).
// - breaks: turns single newlines into <br> so multi-line chat text keeps its
//   line breaks (mirrors the old pre-wrap plain-text bubbles).
// - math: renders LaTeX (`$...$`, `$$...$$`) via KaTeX.
// - mermaid: renders `::mermaid` diagrams via beautiful-mermaid.
// - shiki: syntax-highlights code fences. Single light theme because the app
//   has no dark mode (multi-theme would fight the always-light palette).
const plugins = computed<ComarkPlugin[]>(() => [
  security({
    blockedTags: ["script", "iframe", "object", "embed", "form", "style", "link", "meta"],
  }),
  attributeSanitizer,
  breaks(),
  math({ throwOnError: false }),
  mermaid(),
  shiki({ themes: { light: githubLight }, registerDefaultThemes: false }),
])
</script>

<template>
  <!--
    <Markdown> is async, so it must live under a <Suspense> boundary. Do NOT
    pass a `class` to it: @comark/vue's Markdown rebuilds the MarkdownDocument
    vnode internally and drops fallthrough attrs/class. All styling keys off
    the hardcoded `.comark-content` wrapper (see markdown.css and MessageItem's
    user-bubble :deep(.comark-content) rule).
  -->
  <Suspense>
    <Markdown
      :value="content"
      :components="mdComponents"
      :plugins="plugins"
      :streaming="streaming"
    />
  </Suspense>
</template>
