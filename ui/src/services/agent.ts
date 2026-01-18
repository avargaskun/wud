function getAgentIcon() {
  return "mdi-server-network";
}

async function getAllAgents() {
  const response = await fetch("/api/agents", { credentials: "include" });
  return response.json();
}

export { getAgentIcon, getAllAgents };
