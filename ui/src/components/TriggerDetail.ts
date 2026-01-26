import { runTrigger } from "@/services/trigger";
import { defineComponent } from "vue";
import { useDisplay } from "vuetify";

export default defineComponent({
  setup() {
    const { smAndUp } = useDisplay();
    return { smAndUp };
  },
  components: {},
  props: {
    trigger: {
      type: Object,
      required: true,
    },
    agents: {
      type: Array,
      required: false,
      default: () => [],
    },
  },
  data() {
    return {
      showDetail: false,
      showTestForm: false,
      isTriggering: false,
      container: {
        id: "123456789",
        name: "container_test",
        watcher: "watcher_test",
        updateKind: {
          kind: "tag",
          semverDiff: "major",
          localValue: "1.2.3",
          remoteValue: "4.5.6",
          result: {
            link: "https://my-container/release-notes/",
          },
        },
      },
    };
  },
  computed: {
    agentStatusColor() {
      const agent = (this.agents as any[]).find(
        (a) => a.name === this.trigger.agent,
      );
      if (agent) {
        return agent.connected ? "success" : "error";
      }
      return "info";
    },

    configurationItems() {
      return Object.keys(this.trigger.configuration || [])
        .map((key) => ({
          key,
          value: this.trigger.configuration[key],
        }))
        .sort((trigger1, trigger2) => trigger1.key.localeCompare(trigger2.key));
    },
  },

  methods: {
    collapse() {
      this.showDetail = !this.showDetail;
    },
    async runTrigger() {
      this.isTriggering = true;
      try {
        await runTrigger({
          triggerType: this.trigger.type,
          triggerName: this.trigger.name,
          container: this.container,
        });
        (this as any).$eventBus.emit("notify", "Trigger executed with success");
      } catch (err: any) {
        (this as any).$eventBus.emit(
          "notify",
          `Trigger executed with error (${err.message}})`,
          "error",
        );
      } finally {
        this.isTriggering = false;
      }
    },
    formatValue(value: any) {
      if (value === undefined || value === null || value === "") {
        return "<empty>";
      }
      return value;
    },
  },
});
