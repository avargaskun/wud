<template>
  <v-container fluid>
    <v-row v-for="watcher in watchers" :key="`${watcher.agent || '_local'}.${watcher.id}`">
      <v-col :cols="12" class="pt-2 pb-2">
        <configuration-item :item="watcher" :agents="agents" />
      </v-col>
    </v-row>
    <v-row v-if="watchers.length === 0">
      <v-card-subtitle class="text-h6">No watchers configured</v-card-subtitle>
    </v-row>
  </v-container>
</template>

<script lang="ts" src="./ConfigurationWatchersView.ts"></script>
