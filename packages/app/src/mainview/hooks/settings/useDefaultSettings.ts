import { ref, watch } from "vue"
import { ElMessage } from "element-plus"
import { THINKING_LEVELS, type ThinkingLevel } from "@my-pi/shared"
import { useSettingsStore } from "../../stores"
import { useModelOptions, type ModelRef } from "../picks/useModelOptions"
import { showError } from "../shared/useErrors"

export { THINKING_LEVELS }

// el-select can't hold undefined as a selectable option value — the "default"
// choice is a sentinel string mapped to undefined at the API edge.
export const THINKING_DEFAULT = "__default__"

/** Type guard for the persisted thinking-level value at the save boundary. */
function isThinkingLevel(v: string): v is ThinkingLevel {
  return (THINKING_LEVELS as readonly string[]).includes(v)
}

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
    settings.state.settings.chatModel ?? null,
  )
  const titleModel = ref<ModelRef>(
    settings.state.settings.titleModel ?? null,
  )
  const backgroundModel = ref<ModelRef>(
    settings.state.settings.defaultModel ?? null,
  )
  const thinking = ref<string>(
    settings.state.settings.defaultThinkingLevel ?? THINKING_DEFAULT,
  )
  const saving = ref(false)

  // Keep the local refs in sync with the store so the selects don't show stale
  // values if a model setting changes from elsewhere while the panel is open.
  watch(
    () => settings.state.settings.chatModel,
    (v) => {
      if (v !== chatModel.value) chatModel.value = v ?? null
    },
  )
  watch(
    () => settings.state.settings.titleModel,
    (v) => {
      if (v !== titleModel.value) titleModel.value = v ?? null
    },
  )
  watch(
    () => settings.state.settings.defaultModel,
    (v) => {
      if (v !== backgroundModel.value) backgroundModel.value = v ?? null
    },
  )
  watch(
    () => settings.state.settings.defaultThinkingLevel,
    (v) => {
      // Mirrors the model watches: a cleared store value resets the local
      // select back to the "default" sentinel.
      if (v !== undefined && v !== thinking.value) thinking.value = v
      if (v === undefined && thinking.value !== THINKING_DEFAULT) {
        thinking.value = THINKING_DEFAULT
      }
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
      const level = thinking.value
      if (level === THINKING_DEFAULT || !isThinkingLevel(level)) return
      saving.value = true
      try {
        await settings.setDefaultThinkingLevel(level)
        ElMessage.success("Thinking level saved")
      } catch (err) {
        showError(err)
      } finally {
        saving.value = false
      }
    },
  }
}
