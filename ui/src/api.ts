import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

// --- Axios interceptor: attach JWT token to all requests ---
const api = axios.create({ baseURL: API_BASE_URL });

api.interceptors.request.use((config) => {
    const token = localStorage.getItem('aether_token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// --- Types ---

export interface Mission {
    id: string;
    title: string;
    status: 'Queue' | 'Active' | 'Completed';
    description: string;
    agents: string[];
    priority: 'General' | 'Urgent';
    parent_mission_id?: string;
    assigned_agent_id?: string;
    git_branch?: string;
    subtasks?: Mission[];
}

export interface Message {
    role: 'agent' | 'user' | 'system';
    name?: string;
    content: string;
    files?: { name: string; size: string }[];
}

export interface ChatSession {
    id: string;
    type: string;
    agent_id?: string;
    mission_id?: string;
    created_at: string;
}

export interface ChatMessageResponse {
    id: string;
    session_id: string;
    role: string;
    sender_name?: string;
    content: string;
    files?: { name: string; size: string }[];
    created_at: string;
}

export interface AgentInfo {
    id: string;
    name: string;
    type: 'master' | 'sub';
    status: string;
    parent_agent_id?: string;
    model?: string;
    worktree_path?: string;
    git_branch?: string;
    current_task?: string;
    load?: number;
    created_at: string;
    terminated_at?: string;
    children?: AgentInfo[];
}

export interface AuthResponse {
    access_token: string;
    token_type: string;
    user: {
        id: string;
        username: string;
        role: string;
        created_at: string;
    };
}

export interface SystemMetrics {
    cpu_percent: number;
    memory_used_mb: number;
    memory_total_mb: number;
    memory_percent: number;
    disk_used_mb: number;
    disk_total_mb: number;
    active_agents: number;
    total_agents: number;
    uptime_seconds: number;
}

// --- Auth API ---

export const login = async (username: string, password: string): Promise<AuthResponse> => {
    const response = await api.post('/auth/login', { username, password });
    const data = response.data;
    localStorage.setItem('aether_token', data.access_token);
    return data;
};

export const getMe = async (): Promise<AuthResponse['user']> => {
    const response = await api.get('/auth/me');
    return response.data;
};

export const googleLogin = async (accessToken: string): Promise<AuthResponse> => {
    // Google useGoogleLogin with implicit flow gives an access_token.
    // We send it to our backend which exchanges/verifies it and issues a JWT.
    const response = await api.post('/auth/google', { credential: accessToken });
    const data = response.data;
    localStorage.setItem('aether_token', data.access_token);
    return data;
};

export const logout = () => {
    localStorage.removeItem('aether_token');
};

// --- Missions API ---

export const fetchMissions = async (): Promise<Mission[]> => {
    const response = await api.get('/missions');
    return response.data;
};

export const createMission = async (mission: Omit<Mission, 'id'>): Promise<Mission> => {
    const response = await api.post('/missions', mission);
    return response.data;
};

export const updateMission = async (id: string, mission: Partial<Mission>): Promise<Mission> => {
    const response = await api.put(`/missions/${id}`, mission);
    return response.data;
};

export const deleteMission = async (id: string): Promise<void> => {
    await api.delete(`/missions/${id}`);
};

// --- Agents API ---

export const fetchAgents = async (): Promise<AgentInfo[]> => {
    const response = await api.get('/agents');
    return response.data;
};

export const deleteAgent = async (agentId: string): Promise<void> => {
    await api.delete(`/agents/${agentId}`);
};

export const fetchAgent = async (id: string): Promise<AgentInfo> => {
    const response = await api.get(`/agents/${id}`);
    return response.data;
};

export const terminateAgent = async (id: string): Promise<void> => {
    await api.delete(`/agents/${id}`);
};

// --- Chat API (session-based) ---

export const fetchChatSessions = async (): Promise<ChatSession[]> => {
    const response = await api.get('/chat/sessions');
    return response.data;
};

export const createChatSession = async (): Promise<ChatSession> => {
    const response = await api.post('/chat/sessions', { type: 'user' });
    return response.data;
};

export const fetchSessionMessages = async (sessionId: string): Promise<ChatMessageResponse[]> => {
    const response = await api.get(`/chat/sessions/${sessionId}/messages`);
    return response.data;
};

export const sendSessionMessage = async (sessionId: string, content: string): Promise<ChatMessageResponse> => {
    const response = await api.post(`/chat/sessions/${sessionId}/send`, { content });
    return response.data;
};

// --- Chat Status ---

export interface ChatStatus {
    ready: boolean;
    mode: 'orchestrator' | 'conversational';
    api_key_configured: boolean;
    repo_configured: boolean;
    model: string;
    issues: string[];
}

export const fetchChatStatus = async (): Promise<ChatStatus> => {
    const response = await api.get('/chat/status');
    return response.data;
};

// --- Chat API (legacy — backward compat) ---

export const fetchChatHistory = async (): Promise<Message[]> => {
    const response = await api.get('/chat/history');
    return response.data;
};

export const sendMessage = async (message: Message): Promise<Message> => {
    const response = await api.post('/chat/send', message);
    return response.data;
};

// --- Metrics API ---

export const fetchMetrics = async (): Promise<SystemMetrics> => {
    const response = await api.get('/metrics');
    return response.data;
};

// --- Remote Jason (OpenClaw) API ---

export interface RemoteStatus {
    connected: boolean;
    url?: string;
    session_key?: string;
    protocol?: number;
    server?: object;
    health?: object;
    uptime_ms?: number;
}

export interface RemoteConnectRequest {
    url: string;
    token: string;
    session_key?: string;
    cf_client_id?: string;
    cf_client_secret?: string;
}

export const fetchRemoteStatus = async (): Promise<RemoteStatus> => {
    const response = await api.get('/remote/status');
    return response.data;
};

export const connectRemote = async (req: RemoteConnectRequest): Promise<{ ok: boolean; message: string }> => {
    const response = await api.post('/remote/connect', req);
    return response.data;
};

export const disconnectRemote = async (): Promise<{ ok: boolean; message: string }> => {
    const response = await api.post('/remote/disconnect');
    return response.data;
};

export const fetchRemoteHistory = async (sessionKey?: string): Promise<Message[]> => {
    const params = sessionKey ? { session_key: sessionKey } : {};
    const response = await api.get('/remote/history', { params });
    return response.data;
};

export const sendRemoteMessage = async (content: string, sessionKey?: string): Promise<Message> => {
    const response = await api.post('/remote/send', { content, session_key: sessionKey });
    return response.data;
};

export const fetchRemoteSessions = async (): Promise<any[]> => {
    const response = await api.get('/remote/sessions');
    return response.data;
};

export const fetchRemoteAgents = async (): Promise<any> => {
    const response = await api.get('/remote/agents');
    return response.data;
};

export interface CreateAgentRequest {
    agent_id: string;
    name: string;
    model?: string;
    workspace?: string;
    identity?: { name?: string; emoji?: string };
    sandbox?: { mode?: string; workspaceAccess?: string };
}

export const createRemoteAgent = async (req: CreateAgentRequest): Promise<{ ok: boolean; message: string; agent: any }> => {
    const response = await api.post('/remote/agents/create', req);
    return response.data;
};

export const fetchRemoteModels = async (): Promise<any[]> => {
    const response = await api.get('/remote/models');
    return response.data;
};

// --- Remote Config API ---

export interface OpenClawConfig {
    path: string;
    exists: boolean;
    raw: string;
    parsed: Record<string, any>;
    config: Record<string, any>;
    hash: string;
    valid: boolean;
    issues: string[];
    warnings: string[];
}

export interface AgentFileInfo {
    name: string;
    path: string;
    missing: boolean;
    size?: number;
    updatedAtMs?: number;
}

export interface AgentFileContent {
    content: string;
}

export const fetchRemoteConfig = async (): Promise<OpenClawConfig> => {
    const response = await api.get('/remote/config');
    return response.data;
};

export const setRemoteConfig = async (config: Record<string, any>, hash: string): Promise<{ ok: boolean }> => {
    const response = await api.put('/remote/config', { config, hash });
    return response.data;
};

export const fetchRemoteAgentFiles = async (agentId: string = 'main'): Promise<{ agentId: string; workspace: string; files: AgentFileInfo[] }> => {
    const response = await api.get('/remote/agent-files', { params: { agent_id: agentId } });
    return response.data;
};

export const fetchRemoteAgentFile = async (name: string, agentId: string = 'main'): Promise<AgentFileContent> => {
    const response = await api.get(`/remote/agent-files/${name}`, { params: { agent_id: agentId } });
    return response.data;
};

export const setRemoteAgentFile = async (name: string, content: string, agentId: string = 'main'): Promise<{ ok: boolean }> => {
    const response = await api.put(`/remote/agent-files/${name}`, { content }, { params: { agent_id: agentId } });
    return response.data;
};

// --- Deploy API ---

export interface DeployFieldSchema {
    auto: Record<string, { description: string }>;
    mandatory: Record<string, { description: string; hint: string; sensitive: boolean }>;
    optional: Record<string, { description: string; hint: string; sensitive: boolean; group: string; depends_on: string }>;
}

export interface DeployConfigureRequest {
    openrouter_api_key: string;
    anthropic_api_key?: string;
    openai_api_key?: string;
    telegram_bot_token?: string;
    telegram_user_id?: string;
    whatsapp_number?: string;
}

export interface DeployResult {
    ok: boolean;
    deployment_id: string;
    port: number;
    gateway_token: string;
    status: string;
    message: string;
}

export interface DeploymentInfo {
    deployment_id: string;
    name: string;
    port: number;
    status: string;
    deploy_dir?: string;
    containers?: any[];
}

export const fetchDeploySchema = async (): Promise<DeployFieldSchema> => {
    const response = await api.get('/deploy/schema');
    return response.data;
};

export const configureDeploy = async (req: DeployConfigureRequest): Promise<DeployResult> => {
    const response = await api.post('/deploy/configure', req);
    return response.data;
};

export const launchDeploy = async (deploymentId: string): Promise<DeployResult> => {
    const response = await api.post('/deploy/launch', { deployment_id: deploymentId });
    return response.data;
};

export const stopDeploy = async (deploymentId: string): Promise<{ ok: boolean; message: string }> => {
    const response = await api.post('/deploy/stop', { deployment_id: deploymentId });
    return response.data;
};

export const fetchDeployStatus = async (deploymentId: string): Promise<DeploymentInfo> => {
    const response = await api.get(`/deploy/status/${deploymentId}`);
    return response.data;
};

export const fetchDeployLogs = async (deploymentId: string, tail: number = 50): Promise<{ logs: string }> => {
    const response = await api.get(`/deploy/logs/${deploymentId}`, { params: { tail } });
    return response.data;
};

export const fetchDeployList = async (): Promise<DeploymentInfo[]> => {
    const response = await api.get('/deploy/list');
    return response.data;
};

export interface GatewayHealthResult {
    healthy: boolean;
    http_ok: boolean;
    ws_ok: boolean;
    port?: number;
    detail: string;
}

export const checkGatewayHealth = async (deploymentId: string): Promise<GatewayHealthResult> => {
    const response = await api.get(`/deploy/gateway-health/${deploymentId}`);
    return response.data;
};

// --- Deploy Chat API (chat with locally deployed containers) ---

export interface DeployChatStatus {
    connected: boolean;
    deployment_id?: string;
    session_name?: string;
    port?: number;
    url?: string;
}

export interface DeployChatConnectResult {
    connected: boolean;
    deployment_id: string;
    session_name: string;
    port: number;
    protocol?: number;
    server?: object;
}

export const connectDeployChat = async (deploymentId: string, sessionName?: string): Promise<DeployChatConnectResult> => {
    const response = await api.post('/deploy-chat/connect', { deployment_id: deploymentId, session_name: sessionName });
    return response.data;
};

export const disconnectDeployChat = async (): Promise<{ ok: boolean; message: string }> => {
    const response = await api.post('/deploy-chat/disconnect');
    return response.data;
};

export const fetchDeployChatStatus = async (): Promise<DeployChatStatus> => {
    const response = await api.get('/deploy-chat/status');
    return response.data;
};

export const fetchDeployChatHistory = async (): Promise<Message[]> => {
    const response = await api.get('/deploy-chat/history');
    return response.data;
};

export const sendDeployChatMessage = async (content: string): Promise<Message> => {
    const response = await api.post('/deploy-chat/send', { content });
    return response.data;
};

// --- Orchestration API ---

export interface OrchestratorSubtask {
    id: string;
    description: string;
    agent_type: string;
    depends_on: string[];
    status: string;
    result: string | null;
    error: string | null;
    deployment_id: string | null;
    started_at: string | null;
    completed_at: string | null;
}

export interface OrchestratorTask {
    id: string;
    description: string;
    status: string;
    master_deployment_id: string;
    subtasks: OrchestratorSubtask[];
    plan: Record<string, any> | null;
    final_result: string | null;
    error: string | null;
    logs: string[];
    created_at: string;
    completed_at: string | null;
}

export interface AgentTemplate {
    type: string;
    name: string;
    description: string;
    tags: string[];
}

export const submitOrchestratorTask = async (description: string, masterDeploymentId: string): Promise<OrchestratorTask> => {
    const response = await api.post('/orchestrate/task', { description, master_deployment_id: masterDeploymentId });
    return response.data;
};

export const fetchOrchestratorTask = async (taskId: string): Promise<OrchestratorTask> => {
    const response = await api.get(`/orchestrate/task/${taskId}`);
    return response.data;
};

export const fetchOrchestratorTasks = async (): Promise<OrchestratorTask[]> => {
    const response = await api.get('/orchestrate/tasks');
    return response.data;
};

export const fetchAgentTemplates = async (): Promise<AgentTemplate[]> => {
    const response = await api.get('/orchestrate/agents');
    return response.data;
};
