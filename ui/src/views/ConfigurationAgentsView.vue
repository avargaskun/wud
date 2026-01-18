<template>
  <v-container fluid>
    <v-row v-for="agent in agents" :key="agent.name">
      <v-col :cols="12" class="pt-2 pb-2">
        <v-card>
            <v-card-title class="pa-3 d-flex align-center bg-surface">
                <div class="text-body-3">
                    <v-chip label color="warning" variant="outlined">{{ agent.name }}</v-chip>
                </div>
                <v-spacer />
                <v-chip :color="agent.status === 'connected' ? 'success' : 'error'" size="small" class="mr-2">{{ agent.status }}</v-chip>
            </v-card-title>
             <v-card-text>
                <div class="text-caption">{{ agent.url }}</div>
             </v-card-text>
        </v-card>
      </v-col>
    </v-row>
    <v-row v-if="agents.length === 0">
      <v-card-subtitle class="text-h6">No agents configured</v-card-subtitle>
    </v-row>
  </v-container>
</template>

<script lang="ts" src="./ConfigurationAgentsView.ts"></script>
