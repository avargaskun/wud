<template>
  <v-container fluid>
    <v-row v-for="trigger in triggers" :key="`${trigger.agent || '_local'}.${trigger.id}`">
      <v-col :cols="12" class="pt-2 pb-2">
        <trigger-detail :trigger="trigger" :agents="agents" />
      </v-col>
    </v-row>
    <v-row v-if="triggers.length === 0">
      <v-card-subtitle class="text-h6">No triggers configured</v-card-subtitle>
    </v-row>
  </v-container>
</template>

<script lang="ts" src="./ConfigurationTriggersView.ts"></script>
