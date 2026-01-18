import { getAllAgents } from "@/services/agent";
import { defineComponent } from "vue";

export default defineComponent({
  data() {
    return {
      agents: [] as any[],
    };
  },
  async beforeRouteEnter(to, from, next) {
    try {
      const agents = await getAllAgents();
      next((vm: any) => (vm.agents = agents));
    } catch (e: any) {
      next((vm: any) => {
        vm.$eventBus.emit(
          "notify",
          `Error when trying to load the agents (${e.message})`,
          "error",
        );
      });
    }
  },
});
