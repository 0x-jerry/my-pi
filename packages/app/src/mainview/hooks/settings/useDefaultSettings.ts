import { ref, watch } from "vue"
import { ElMessage } from "element-plus"
import type { ThinkingLevel } from "@my-pi/shared"
import { useSettingsStore } from "../../stores"
import { useModelOptions, type ModelRef } from "../picks/useModelOptions"
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
 * Defaults for new sessions shown in the Settings page: the chat model (used
 * by all sessions by default), an optional title model (falls back to the
 * background model), the background-task model (stored under `defaultModel`),
 * and the default thinking level. Mirrors persisted store values and saves
 * them back.
 */
export function useDefaultSettings() {
  const settings = useSettingsStore()
  const modelOptions = useModelOptions()

  const chatModel = ref<ModelRef>(
    (settings.state.settings.chatModel as { provider: string; id: string } | undefined) ??
      null,
  )
  const titleModel = ref<ModelRef>(
    (settings.state.settings.titleModel as { provider: string; id: string } | undefined) ??
      null,
  )
  const backgroundModel = ref<ModelRef>(
    (settings.state.settings.defaultModel as { provider: string; id: string } | undefined) ??
      null,
  )
  const thinking = ref<string>(
    (settings.state.settings.defaultThinkingLevel as ThinkingLevel | undefined) ??
      THINKING_DEFAULT,
  )
  const saving = ref(false)

  // Keep the local refs in sync with the store so the selects don't show stale
  // values if a model setting changes from elsewhere while the panel is open.
  watch(
    () => settings.state.settings.chatModel as { provider: string; id: string } | undefined,
    (v) => {
      if (v !== chatModel.value) chatModel.value = v ?? null
    },
  )
  watch(
    () => settings.state.settings.titleModel as { provider: string; id: string } | undefined,
    (v) => {
      if (v !== titleModel.value) titleModel.value = v ?? null
    },
  )
  watch(
    () => settings.state.settings.defaultModel as { provider: string; id: string } | undefined,
    (v) => {
      if (v !== backgroundModel.value) backgroundModel.value = v ?? null
    },
  )

  return {
    ...modelOptions,
    chatModel,
    titleModel,
    backgroundModel,
    thinking,
    saving,
    async saveChat(): Promise<void> {
      if (!chatModel.value) return
      saving.value = true
      try {
        await settings.setChatModel(chatModel.value)
        ElMessage.success("Chat model saved")
      } catch (err) {
        showError(err)
      } finally {
        saving.value = false
      }
    },
    async saveTitle(): Promise<void> {
      saving.value = true
      try {
        await settings.setTitleModel(titleModel.value)
        ElMessage.success("Title model saved")
      } catch (err) {
        showError(err)
      } finally {
        saving.value = false
      }
    },
    async saveBackground(): Promise<void> {
      if (!backgroundModel.value) return
      saving.value = true
      try {
        await settings.setDefaultModel(backgroundModel.value)
        ElMessage.success("Background model saved")
      } catch (err) {
        showError(err)
      } finally {
        saving.value = false
      }
    },
    async saveThinking(): Promise<void> {
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
    },
  }
}
