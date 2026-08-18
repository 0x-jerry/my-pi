import { ref } from "vue"
import { ElMessage } from "element-plus"
import type { ThinkingLevel } from "@my-pi/shared"
import { useSettingsStore } from "../../stores"
import { showError } from "../shared/useErrors"

export const THINKING_LEVELS: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]

// el-select can't hold undefined as a selectable option value — the "default"
// choice is a sentinel string mapped to undefined at the API edge.
export const THINKING_DEFAULT = "__default__"

/**
 * Defaults for new sessions (default model + default thinking level) shown in
 * the Settings page. Mirrors persisted store values and saves them back.
 */
export function useDefaultSettings() {
  const settings = useSettingsStore()

  const model = ref<{ provider: string; id: string } | null>(
    (settings.state.settings.defaultModel as { provider: string; id: string } | undefined) ??
      null,
  )
  const thinking = ref<string>(
    (settings.state.settings.defaultThinkingLevel as ThinkingLevel | undefined) ??
      THINKING_DEFAULT,
  )
  const saving = ref(false)

  async function saveModel(): Promise<void> {
    if (!model.value) return
    saving.value = true
    try {
      await settings.setDefaultModel(model.value)
      ElMessage.success("Default model saved")
    } catch (err) {
      showError(err)
    } finally {
      saving.value = false
    }
  }

  async function saveThinking(): Promise<void> {
    if (thinking.value === THINKING_DEFAULT) return
    saving.value = true
    try {
      await settings.setDefaultThinkingLevel(thinking.value as ThinkingLevel)
      ElMessage.success("Thinking level saved")
    } catch (err) {
      showError(err)
    } finally {
      saving.value = false
    }
  }

  return { model, thinking, saving, saveModel, saveThinking }
}
