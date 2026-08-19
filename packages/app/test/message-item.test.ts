import { describe, expect, test } from "vitest"
import { mount } from "@vue/test-utils"
import ElementPlus from "element-plus"
import MessageItem from "../src/mainview/components/chat/MessageItem.vue"
import type { StoredMessage } from "@my-pi/shared"

function thinkingMessage(id: string, thinking = "reasoning…"): StoredMessage {
  return {
    id,
    sessionId: "s1",
    seq: 1,
    role: "assistant",
    data: { role: "assistant", content: [{ type: "thinking", thinking }] },
    createdAt: 0,
  }
}

function mountItem(msg: StoredMessage) {
  return mount(MessageItem, { props: { msg }, global: { plugins: [ElementPlus] } })
}

const isExpanded = (w: ReturnType<typeof mountItem>): boolean =>
  (w.find("button.thinking-toggle").element as HTMLElement).getAttribute("aria-expanded") === "true"

describe("MessageItem thinking block", () => {
  test("thinking block starts collapsed, previewing only the last 3 lines", () => {
    const w = mountItem(thinkingMessage("m1", "l1\nl2\nl3\nl4\nl5"))
    expect(isExpanded(w)).toBe(false)
    expect(w.find(".thinking-preview-text").text()).toBe("l3\nl4\nl5")
    expect(w.find(".thinking-ellipsis").exists()).toBe(true)
    expect(w.text()).not.toContain("l1")
    expect(w.text()).not.toContain("l2")
  })

  test("short thinking (<= 3 lines) shows all lines with no ellipsis", () => {
    const w = mountItem(thinkingMessage("m1", "a\nb"))
    expect(w.find(".thinking-preview-text").text()).toBe("a\nb")
    expect(w.find(".thinking-ellipsis").exists()).toBe(false)
  })

  test("toggling expands then collapses the thinking block", async () => {
    const w = mountItem(thinkingMessage("m1"))
    await w.find("button.thinking-toggle").trigger("click")
    expect(isExpanded(w)).toBe(true)
    expect(w.find(".thinking-body").exists()).toBe(true)
    await w.find("button.thinking-toggle").trigger("click")
    expect(isExpanded(w)).toBe(false)
    expect(w.find(".thinking-body").exists()).toBe(false)
  })

  test("expand state is independent per message", async () => {
    const a = mountItem(thinkingMessage("m-a"))
    const b = mountItem(thinkingMessage("m-b"))
    await a.find("button.thinking-toggle").trigger("click")
    expect(isExpanded(a)).toBe(true)
    expect(isExpanded(b)).toBe(false)
  })
})
