<script setup lang="ts">
import AuthPanel from "../components/settings/AuthPanel.vue"
import DefaultsPanel from "../components/settings/DefaultsPanel.vue"
import PluginsPanel from "../components/settings/PluginsPanel.vue"
</script>

<template>
  <section class="page">
    <h2 class="page-title">Settings</h2>
    <AuthPanel />
    <DefaultsPanel />
    <PluginsPanel />
  </section>
</template>

<style scoped>
.page {
  flex: 1;
  padding: 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 760px;
}
.page-title {
  margin: 0;
  font-size: 17px;
}
</style>
