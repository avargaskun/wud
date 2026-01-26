import TriggerDetail from "@/components/TriggerDetail.vue";
import { getAllTriggers } from "@/services/trigger";
import agentService from "@/services/agent";
import { defineComponent } from "vue";

export default defineComponent({
  data() {
    return {
      triggers: [] as any[],
      agents: [] as any[],
    };
  },
  components: {
    TriggerDetail,
  },

  async beforeRouteEnter(to, from, next) {
    try {
      const [triggers, agents] = await Promise.all([
        getAllTriggers(),
        agentService.getAgents(),
      ]);
      next((vm: any) => {
        vm.triggers = triggers;
        vm.agents = agents;
      });
    } catch (e: any) {
      next((vm: any) => {
        vm.$eventBus.emit(
          "notify",
          `Error when trying to load the triggers (${e.message})`,
          "error",
        );
      });
    }
  },
});
