<script setup lang="ts">
import { DEFAULT_SESSION_TITLE } from "@my-pi/shared"
import { useDraftChat } from "../hooks/chat/useDraftChat"

const props = defineProps<{ draftId: string | null }>()

const { input, sending, send } = useDraftChat(() => props.draftId)
</script>

<template>
  <section class="draft">
    <div class="draft-body">
      <el-empty
        description="Type a message to create this session. Its title is generated automatically."
        :image-size="80"
      >
        <template #description>
          <div class="draft-hint">
            <strong>{{ DEFAULT_SESSION_TITLE }}</strong>
            <p>Type a message to create it. Its title is generated automatically.</p>
          </div>
        </template>
      </el-empty>
    </div>

    <footer class="draft-foot">
      <el-input
        v-model="input"
        type="textarea"
        :autosize="{ minRows: 2, maxRows: 6 }"
        resize="none"
        :disabled="sending"
        placeholder="Message… (Enter to send, Shift+Enter for newline)"
        @keydown.enter.exact.prevent="send"
      />
      <div class="draft-hint">
        <template v-if="sending">Starting…</template>
        <template v-else>This session will be created with your first message.</template>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.draft {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.draft-body {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.draft-hint {
  text-align: center;
  color: var(--fg-dim);
  font-size: 13px;
}
.draft-hint strong {
  display: block;
  color: var(--fg);
  font-size: 15px;
  margin-bottom: 6px;
}
.draft-hint p {
  margin: 0;
}
.draft-foot {
  border-top: 1px solid var(--border);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--bg-panel);
}
.draft-hint {
  color: var(--fg-dim);
  font-size: 11px;
}
</style>
