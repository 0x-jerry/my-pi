import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"
import ElementPlus from "element-plus"
import ThinkingBlock from "../src/mainview/components/chat/ThinkingBlock.vue"

function mountBlock(content: string, extra: Record<string, unknown> = {}) {
  return mount(ThinkingBlock, {
    props: { content, ...extra },
    global: { plugins: [ElementPlus] },
  })
}

const preview = (w: ReturnType<typeof mountBlock>): string =>
  w.find(".thinking-preview-text").text()

const isExpanded = (w: ReturnType<typeof mountBlock>): boolean =>
  (w.find("button.thinking-toggle").element as HTMLElement).getAttribute("aria-expanded") === "true"

describe("ThinkingBlock", () => {
  test("defaults to collapsed", () => {
    expect(isExpanded(mountBlock("x"))).toBe(false)
  })

  test("previews the last 3 non-empty trailing lines with an ellipsis", () => {
    const w = mountBlock("a\nb\nc\nd\ne\n")
    expect(preview(w)).toBe("c\nd\ne")
    expect(w.find(".thinking-ellipsis").exists()).toBe(true)
  })

  test("strips trailing blank lines before picking the tail", () => {
    expect(preview(mountBlock("a\nb\nc\n\n\n"))).toBe("a\nb\nc")
  })

  test("shows everything without an ellipsis when <= 3 lines", () => {
    const w = mountBlock("a\nb\nc")
    expect(preview(w)).toBe("a\nb\nc")
    expect(w.find(".thinking-ellipsis").exists()).toBe(false)
  })

  test("expanding renders the full content body, collapsing removes it", async () => {
    const w = mountBlock("a\nb\nc\nd")
    await w.find("button.thinking-toggle").trigger("click")
    expect(isExpanded(w)).toBe(true)
    expect(w.find(".thinking-body").exists()).toBe(true)
    await w.find("button.thinking-toggle").trigger("click")
    expect(isExpanded(w)).toBe(false)
    expect(w.find(".thinking-body").exists()).toBe(false)
  })

  test("labels: streaming and redacted variants", () => {
    expect(mountBlock("x").find(".thinking-label").text()).toBe("thinking")
    expect(mountBlock("x", { streaming: true }).find(".thinking-label").text()).toBe("thinking…")
    expect(mountBlock("x", { redacted: true }).find(".thinking-label").text()).toBe(
      "thinking (redacted)",
    )
  })

  test("exposes aria-expanded and a show-more hint", () => {
    const w = mountBlock("x")
    expect(w.find(".thinking-hint").text()).toBe("show more")
    expect(w.find("button.thinking-toggle").attributes("aria-expanded")).toBe("false")
  })
})
