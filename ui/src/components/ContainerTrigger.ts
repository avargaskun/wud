import { runTrigger } from "@/services/container";
import { defineComponent } from "vue";

interface DependentOutcome {
  name: string;
  status: string;
  reason?: string;
}

interface TriggerRunResult {
  dependents?: DependentOutcome[];
}

export default defineComponent({
  props: {
    trigger: {
      type: Object,
      required: true,
    },
    updateAvailable: {
      type: Boolean,
      required: true,
    },
    containerId: {
      type: String,
      required: true,
    },
  },
  data() {
    return {
      isTriggering: false,
      triggerId: this.trigger.id
    };
  },
  computed: {},

  methods: {
    async runTrigger() {
      this.isTriggering = true;
      try {
        const result: TriggerRunResult | undefined = await runTrigger({
          containerId: this.containerId,
          triggerType: this.trigger.type,
          triggerName: this.trigger.name,
          triggerAgent: this.trigger.agent,
        });
        const notBounced = (result?.dependents ?? []).filter(
          (dependent) => dependent.status !== "bounced",
        );
        if (notBounced.length > 0) {
          (this as any).$eventBus.emit(
            "notify",
            `Updated; ${notBounced.length} dependent(s) not restarted: ${notBounced
              .map((dependent) => dependent.name)
              .join(", ")}`,
            "warning",
          );
        } else {
          (this as any).$eventBus.emit(
            "notify",
            "Trigger executed with success",
          );
        }

        // Emit event to parent to trigger refresh after delay
        this.$emit('trigger-executed');
      } catch (err: any) {
        (this as any).$eventBus.emit(
          "notify",
          `Trigger executed with error (${err.message}})`,
          "error",
        );
      } finally {
        this.isTriggering = false;
      }
      this.isTriggering = false;
    },
  },
});
