<template>
  <v-container fluid>
    <v-row>
      <v-col cols="12">
        <v-card>
          <v-card-title>
            Agents
            <v-spacer></v-spacer>
            <v-text-field
              v-model="search"
              append-icon="mdi-magnify"
              label="Search"
              single-line
              hide-details
            ></v-text-field>
          </v-card-title>
          <v-data-table
            :headers="headers"
            :items="agents"
            :search="search"
            :loading="loading"
          >
            <template v-slot:item.status="{ item }">
              <v-chip
                :color="item.connected ? 'green' : 'red'"
                dark
              >
                {{ item.connected ? 'Connected' : 'Disconnected' }}
              </v-chip>
            </template>
          </v-data-table>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<script>
export default {
  data() {
    return {
      search: '',
      loading: true,
      headers: [
        { text: 'Name', value: 'name' },
        { text: 'URL', value: 'url' },
        { text: 'Status', value: 'status' },
      ],
      agents: [],
    };
  },
  mounted() {
    this.fetchAgents();
    // Poll every 5 seconds
    this.interval = setInterval(this.fetchAgents, 5000);
  },
  beforeDestroy() {
    clearInterval(this.interval);
  },
  methods: {
    async fetchAgents() {
      try {
        const response = await fetch('/api/agents');
        this.agents = await response.json();
      } catch (e) {
        console.error(e);
      } finally {
        this.loading = false;
      }
    },
  },
};
</script>
