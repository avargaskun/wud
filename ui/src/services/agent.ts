import { url } from "./base";

export function getAgentIcon() {
  return 'mdi-lan';
}

export async function getAgents() {
  const response = await fetch(url("api/agents"), { credentials: "include" });
  if (!response.ok) {
    throw new Error(`Failed to get agents: ${response.statusText}`);
  }
  return response.json();
}

export default {
  getAgents,
};
