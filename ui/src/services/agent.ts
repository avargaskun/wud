import axios from 'axios';

const BASE_URL = '/api/agents';

export function getAgentIcon() {
    return 'mdi-lan';
}

export default {
    getAgents() {
        return axios.get(BASE_URL).then((response) => response.data);
    },
};