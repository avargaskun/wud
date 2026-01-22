function getContainerIcon() {
  return "mdi-docker";
}

async function getAllContainers() {
  const response = await fetch("/api/containers", { credentials: "include" });
  return response.json();
}

async function refreshAllContainers() {
  const response = await fetch(`/api/containers/watch`, {
    method: "POST",
    credentials: "include",
  });
  return response.json();
}

async function refreshContainer(containerId) {
  const response = await fetch(`/api/containers/${containerId}/watch`, {
    method: "POST",
    credentials: "include",
  });
  if (response.status === 404) {
    return undefined;
  }
  return response.json();
}

async function deleteContainer(containerId) {
  return fetch(`/api/containers/${containerId}`, { method: "DELETE", credentials: "include" });
}

async function getContainerTriggers(containerId) {
  const response = await fetch(`/api/containers/${containerId}/triggers`, { credentials: "include" });
  return response.json();
}

async function runTrigger({ containerId, triggerType, triggerName, triggerAgent }) {
  const url = triggerAgent 
    ? `/api/containers/${containerId}/triggers/${triggerAgent}/${triggerType}/${triggerName}` 
    : `/api/containers/${containerId}/triggers/${triggerType}/${triggerName}`;
  const response = await fetch(
    url,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    },
  );
  return response.json();
}

export {
  getContainerIcon,
  getAllContainers,
  refreshAllContainers,
  refreshContainer,
  deleteContainer,
  getContainerTriggers,
  runTrigger,
};
