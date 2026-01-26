import ConfigurationItem from "@/components/ConfigurationItem.vue";
import { getAllWatchers } from "@/services/watcher";
import agentService from "@/services/agent";
import { defineComponent } from "vue";

export default defineComponent({
  data() {
    return {
      watchers: [] as any[],
      agents: [] as any[],
    };
  },
  components: {
    ConfigurationItem,
  },

  async beforeRouteEnter(to, from, next) {
    try {
      const [watchers, agents] = await Promise.all([
        getAllWatchers(),
        agentService.getAgents(),
      ]);
      next((vm: any) => {
        vm.watchers = watchers;
        vm.agents = agents;
      });
    } catch (e: any) {
      next((vm: any) => {
        vm.$eventBus.emit(
          "notify",
          `Error when trying to load the watchers (${e.message})`,
          "error",
        );
      });
    }
  },
});
