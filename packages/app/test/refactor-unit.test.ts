import { describe, expect, test } from "vitest"
import type { SessionInfo } from "@my-pi/shared"
import { folderName } from "../src/mainview/utils/folderName"
import { statusDot } from "../src/mainview/utils/statusDot"

describe("folderName", () => {
  test("returns the last path segment", () => {
    expect(folderName("/home/u/code/x")).toBe("x")
    expect(folderName("/home/u/code/")).toBe("code")
    expect(folderName("C:\\Users\\me\\proj")).toBe("proj")
  })

  test("falls back to the input for a single segment", () => {
    expect(folderName("plain")).toBe("plain")
  })
})

describe("statusDot", () => {
  const withStatus = (status: string) => ({ status }) as unknown as SessionInfo

  test("maps each status to its CSS class", () => {
    expect(statusDot(withStatus("running"))).toBe("dot-running")
    expect(statusDot(withStatus("error"))).toBe("dot-error")
    expect(statusDot(withStatus("idle"))).toBe("dot-idle")
  })
})
