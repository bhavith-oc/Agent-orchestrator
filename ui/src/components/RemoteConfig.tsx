import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
    Wifi, WifiOff, Server, Save, RefreshCw, ChevronDown, ChevronRight,
    FileText, Cpu, Link2, Unlink, Eye, EyeOff, AlertCircle, CheckCircle2,
    Key, Shield, MessageCircle, Send, Trash2, Plus
} from 'lucide-react'
import {
    fetchRemoteStatus, connectRemote, disconnectRemote,
    fetchRemoteConfig, setRemoteConfig,
    fetchRemoteAgentFiles, fetchRemoteAgentFile, setRemoteAgentFile,
    fetchRemoteModels, createRemoteAgent,
    fetchDeployList, fetchMasterDeployment, setMasterDeployment,
    fetchLLMProvider, setLLMProvider, testLLMConnection,
    type RemoteStatus, type OpenClawConfig, type AgentFileInfo, type DeploymentInfo,
    type LLMProviderInfo, type LLMProviderOption
} from '../api'

// --- Toast ---
function Toast({ message, type, onClose }: { message: string; type: 'success' | 'error'; onClose: () => void }) {
    useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t) }, [onClose])
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-bold shadow-lg ${type === 'success' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'}`}
        >
            {type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {message}
        </motion.div>
    )
}

// --- Section wrapper ---
function Section({ title, icon: Icon, children, defaultOpen = true, badge }: { title: string; icon: any; children: React.ReactNode; defaultOpen?: boolean; badge?: string }) {
    const [open, setOpen] = useState(defaultOpen)
    return (
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-3 px-6 py-4 hover:bg-slate-800/50 transition-colors">
                <Icon className="w-5 h-5 text-primary" />
                <span className="font-bold text-sm tracking-tight flex-1 text-left">{title}</span>
                {badge && <span className="text-[10px] font-bold text-slate-500 bg-slate-800 px-2 py-0.5 rounded-md">{badge}</span>}
                {open ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
            </button>
            {open && <div className="px-6 pb-6 space-y-4">{children}</div>}
        </div>
    )
}

// --- Input field ---
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
    return (
        <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">{label}</label>
            {children}
            {hint && <p className="text-[10px] text-slate-600">{hint}</p>}
        </div>
    )
}

// --- Toggle ---
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
    return (
        <label className="flex items-center gap-3 cursor-pointer">
            <div className={`relative w-10 h-5 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-slate-700'}`} onClick={() => onChange(!checked)}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </div>
            <span className="text-xs font-bold text-slate-400">{label}</span>
        </label>
    )
}

const inputClass = "w-full bg-slate-900 border border-border rounded-xl px-4 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
const btnPrimary = "flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-white text-sm font-bold shadow-[0_0_15px_rgba(6,87,249,0.3)] hover:shadow-[0_0_25px_rgba(6,87,249,0.5)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
const btnDanger = "flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-400 text-sm font-bold border border-red-500/30 transition-all"
const btnSecondary = "flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-bold border border-border transition-all"

const PERSONA_FILES = ['IDENTITY.md', 'SOUL.md', 'USER.md', 'TOOLS.md', 'AGENTS.md', 'HEARTBEAT.md', 'BOOTSTRAP.md']

export default function RemoteConfig() {
    // Connection state
    const [status, setStatus] = useState<RemoteStatus | null>(null)
    const [url, setUrl] = useState('ws://')
    const [token, setToken] = useState('')
    const [sessionKey, setSessionKey] = useState('agent:main:main')
    const [showToken, setShowToken] = useState(false)
    const [connecting, setConnecting] = useState(false)
    const [cfClientId, setCfClientId] = useState('')
    const [cfClientSecret, setCfClientSecret] = useState('')
    const [showCfSecret, setShowCfSecret] = useState(false)

    // Master node designation state
    const [deployments, setDeployments] = useState<DeploymentInfo[]>([])
    const [masterDeployId, setMasterDeployId] = useState('')
    const [masterName, setMasterName] = useState('')
    const [selectedMasterId, setSelectedMasterId] = useState('')
    const [settingMaster, setSettingMaster] = useState(false)

    // LLM Provider state
    const [llmInfo, setLlmInfo] = useState<LLMProviderInfo | null>(null)
    const [llmProvider, setLlmProviderState] = useState('openrouter')
    const [llmFields, setLlmFields] = useState<Record<string, string>>({})
    const [llmSaving, setLlmSaving] = useState(false)
    const [llmTesting, setLlmTesting] = useState(false)
    const [llmTestResult, setLlmTestResult] = useState<{ ok: boolean; models?: string[]; error?: string } | null>(null)
    const [llmShowSensitive, setLlmShowSensitive] = useState<Record<string, boolean>>({})

    // Config state
    const [config, setConfig] = useState<OpenClawConfig | null>(null)
    const [configDraft, setConfigDraft] = useState<Record<string, any>>({})
    const [configHash, setConfigHash] = useState('')
    const [savingConfig, setSavingConfig] = useState(false)

    // Models
    const [models, setModels] = useState<{ id: string; name: string; provider: string }[]>([])
    const [modelSearch, setModelSearch] = useState('')

    // Agent files
    const [agentFiles, setAgentFiles] = useState<AgentFileInfo[]>([])
    const [activeFile, setActiveFile] = useState('IDENTITY.md')
    const [fileContent, setFileContent] = useState('')
    const [fileOriginal, setFileOriginal] = useState('')
    const [savingFile, setSavingFile] = useState(false)
    const [loadingFile, setLoadingFile] = useState(false)

    // Visibility toggles for sensitive fields
    const [showGatewayToken, setShowGatewayToken] = useState(false)
    const [showOpenRouterKey, setShowOpenRouterKey] = useState(false)

    // Toast
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

    const isConnected = status?.connected === true

    // --- Load status on mount ---
    const loadStatus = useCallback(async () => {
        try {
            const s = await fetchRemoteStatus()
            setStatus(s)
            if (s.connected && s.url) {
                setUrl(s.url)
            }
        } catch { /* ignore */ }
    }, [])

    const loadMasterInfo = useCallback(async () => {
        try {
            const [deploys, master] = await Promise.all([
                fetchDeployList(),
                fetchMasterDeployment().catch(() => ({ master_deployment_id: '', name: '' })),
            ])
            setDeployments(deploys)
            setMasterDeployId(master.master_deployment_id || '')
            setMasterName(master.name || '')
            if (master.master_deployment_id) {
                setSelectedMasterId(master.master_deployment_id)
            } else if (deploys.filter(d => d.status === 'running').length > 0) {
                setSelectedMasterId(deploys.filter(d => d.status === 'running')[0].deployment_id)
            }
        } catch { /* ignore */ }
    }, [])

    const loadLLMProvider = useCallback(async () => {
        try {
            const info = await fetchLLMProvider()
            setLlmInfo(info)
            setLlmProviderState(info.provider)
        } catch { /* ignore */ }
    }, [])

    useEffect(() => { loadStatus(); loadMasterInfo(); loadLLMProvider() }, [loadStatus, loadMasterInfo, loadLLMProvider])

    // --- Load config + models + files when connected ---
    useEffect(() => {
        if (!isConnected) return
        loadConfig()
        loadModels()
        loadAgentFiles()
    }, [isConnected])

    // --- Load active file content when tab changes ---
    useEffect(() => {
        if (isConnected && activeFile) loadFileContent(activeFile)
    }, [isConnected, activeFile])

    const loadConfig = async () => {
        try {
            const c = await fetchRemoteConfig()
            setConfig(c)
            setConfigDraft(c.config || c.parsed || {})
            setConfigHash(c.hash || '')
        } catch (e: any) {
            setToast({ message: `Failed to load config: ${e.message}`, type: 'error' })
        }
    }

    const loadModels = async () => {
        try {
            const result = await fetchRemoteModels()
            const list = (result as any)?.models || result || []
            setModels(list)
        } catch { /* ignore */ }
    }

    const loadAgentFiles = async () => {
        try {
            const result = await fetchRemoteAgentFiles()
            setAgentFiles(result.files || [])
        } catch { /* ignore */ }
    }

    const loadFileContent = async (name: string) => {
        setLoadingFile(true)
        try {
            const result = await fetchRemoteAgentFile(name)
            const content = result.content || ''
            setFileContent(content)
            setFileOriginal(content)
        } catch {
            setFileContent('')
            setFileOriginal('')
        } finally {
            setLoadingFile(false)
        }
    }

    // --- Connect ---
    const handleConnect = async () => {
        if (!url || !token) return
        setConnecting(true)
        try {
            await connectRemote({
                url, token, session_key: sessionKey,
                cf_client_id: cfClientId || undefined,
                cf_client_secret: cfClientSecret || undefined,
            })
            setToast({ message: 'Connected to remote OpenClaw', type: 'success' })
            await loadStatus()
        } catch (e: any) {
            setToast({ message: `Connection failed: ${e.response?.data?.detail || e.message}`, type: 'error' })
        } finally {
            setConnecting(false)
        }
    }

    // --- Disconnect ---
    const handleDisconnect = async () => {
        try {
            await disconnectRemote()
            setStatus({ connected: false })
            setConfig(null)
            setModels([])
            setAgentFiles([])
            setToast({ message: 'Disconnected', type: 'success' })
        } catch (e: any) {
            setToast({ message: `Disconnect failed: ${e.message}`, type: 'error' })
        }
    }

    // --- Save config ---
    const handleSaveConfig = async () => {
        setSavingConfig(true)
        try {
            await setRemoteConfig(configDraft, configHash)
            setToast({ message: 'Configuration saved & pushed to container', type: 'success' })
            await loadConfig()
        } catch (e: any) {
            setToast({ message: `Failed to save config: ${e.response?.data?.detail || e.message}`, type: 'error' })
        } finally {
            setSavingConfig(false)
        }
    }

    // --- Save agent file ---
    const handleSaveFile = async () => {
        setSavingFile(true)
        try {
            await setRemoteAgentFile(activeFile, fileContent)
            setFileOriginal(fileContent)
            setToast({ message: `${activeFile} saved`, type: 'success' })
        } catch (e: any) {
            setToast({ message: `Failed to save ${activeFile}: ${e.response?.data?.detail || e.message}`, type: 'error' })
        } finally {
            setSavingFile(false)
        }
    }

    // --- Deep config helpers ---
    const getConfigVal = (path: string[], fallback: any = '') => {
        let obj: any = configDraft
        for (const key of path) {
            if (obj == null || typeof obj !== 'object') return fallback
            obj = obj[key]
        }
        return obj ?? fallback
    }

    const updateConfigField = (path: string[], value: any) => {
        setConfigDraft(prev => {
            const draft = JSON.parse(JSON.stringify(prev))
            let obj = draft
            for (let i = 0; i < path.length - 1; i++) {
                if (!obj[path[i]]) obj[path[i]] = {}
                obj = obj[path[i]]
            }
            obj[path[path.length - 1]] = value
            return draft
        })
    }

    const deleteConfigField = (path: string[]) => {
        setConfigDraft(prev => {
            const draft = JSON.parse(JSON.stringify(prev))
            let obj = draft
            for (let i = 0; i < path.length - 1; i++) {
                if (obj == null || typeof obj !== 'object') return draft
                obj = obj[path[i]]
            }
            if (obj && typeof obj === 'object') delete obj[path[path.length - 1]]
            return draft
        })
    }

    // Extracted config values
    const primaryModel = getConfigVal(['agents', 'defaults', 'model', 'primary'], '')
    const maxConcurrent = getConfigVal(['agents', 'defaults', 'maxConcurrent'], 4)
    const maxSubagents = getConfigVal(['agents', 'defaults', 'subagents', 'maxConcurrent'], 8)
    const compactionMode = getConfigVal(['agents', 'defaults', 'compaction', 'mode'], 'safeguard')
    const modelAliases: Record<string, any> = getConfigVal(['agents', 'defaults', 'models'], {})
    const gatewayToken = getConfigVal(['gateway', 'auth', 'token'], '')
    const gatewayMode = getConfigVal(['gateway', 'mode'], 'local')
    const commandsNative = getConfigVal(['commands', 'native'], 'auto')
    const commandsNativeSkills = getConfigVal(['commands', 'nativeSkills'], 'auto')
    const telegramEnabled = getConfigVal(['plugins', 'entries', 'telegram', 'enabled'], false)
    const telegramDmPolicy = getConfigVal(['channels', 'telegram', 'dmPolicy'], 'allowlist')
    const telegramAllowFrom = getConfigVal(['channels', 'telegram', 'allowFrom'], [])
    const telegramGroupPolicy = getConfigVal(['channels', 'telegram', 'groupPolicy'], 'disabled')
    const telegramStreamMode = getConfigVal(['channels', 'telegram', 'streamMode'], 'partial')
    const telegramMediaMaxMb = getConfigVal(['channels', 'telegram', 'mediaMaxMb'], 50)

    // Filter models for dropdown
    const filteredModels = models.filter(m =>
        !modelSearch || m.name?.toLowerCase().includes(modelSearch.toLowerCase()) || m.id?.toLowerCase().includes(modelSearch.toLowerCase())
    )

    // Group models by provider
    const groupedModels: Record<string, typeof models> = {}
    filteredModels.forEach(m => {
        const provider = m.provider || 'other'
        if (!groupedModels[provider]) groupedModels[provider] = []
        groupedModels[provider].push(m)
    })

    const fileHasChanges = fileContent !== fileOriginal

    // Create Agent state
    const [newAgentId, setNewAgentId] = useState('')
    const [newAgentName, setNewAgentName] = useState('')
    const [newAgentModel, setNewAgentModel] = useState('')
    const [newAgentEmoji, setNewAgentEmoji] = useState('')
    const [creatingAgent, setCreatingAgent] = useState(false)

    // New alias state
    const [newAliasModel, setNewAliasModel] = useState('')
    const [newAliasName, setNewAliasName] = useState('')

    const addModelAlias = () => {
        if (!newAliasModel || !newAliasName) return
        updateConfigField(['agents', 'defaults', 'models', newAliasModel, 'alias'], newAliasName)
        setNewAliasModel('')
        setNewAliasName('')
    }

    const removeModelAlias = (modelId: string) => {
        deleteConfigField(['agents', 'defaults', 'models', modelId])
    }

    // Create Agent handler
    const handleCreateAgent = async () => {
        if (!newAgentId || !newAgentName) return
        setCreatingAgent(true)
        try {
            const result = await createRemoteAgent({
                agent_id: newAgentId.toLowerCase().replace(/\s+/g, '-'),
                name: newAgentName,
                model: newAgentModel || undefined,
                identity: newAgentEmoji ? { name: newAgentName, emoji: newAgentEmoji } : { name: newAgentName },
            })
            setToast({ message: result.message || `Agent '${newAgentName}' created!`, type: 'success' })
            setNewAgentId('')
            setNewAgentName('')
            setNewAgentModel('')
            setNewAgentEmoji('')
            // Reload config to reflect the new agent
            await loadConfig()
        } catch (e: any) {
            setToast({ message: `Failed to create agent: ${e.response?.data?.detail || e.message}`, type: 'error' })
        } finally {
            setCreatingAgent(false)
        }
    }

    // Telegram allowFrom management
    const [newTelegramId, setNewTelegramId] = useState('')
    const addTelegramAllowFrom = () => {
        if (!newTelegramId) return
        const current = [...telegramAllowFrom]
        if (!current.includes(newTelegramId)) current.push(newTelegramId)
        updateConfigField(['channels', 'telegram', 'allowFrom'], current)
        setNewTelegramId('')
    }
    const removeTelegramAllowFrom = (id: string) => {
        updateConfigField(['channels', 'telegram', 'allowFrom'], telegramAllowFrom.filter((x: string) => x !== id))
    }

    return (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6 max-w-4xl">
            {/* Header */}
            <div>
                <h3 className="text-xl font-bold font-display">Master Node Deployment</h3>
                <p className="text-xs text-slate-500 mt-1">Connect to and configure the master OpenClaw node. Changes are pushed to the container in real-time via <span className="font-mono text-slate-400">config.set</span>.</p>
            </div>

            {/* Section 0: Master Node Designation */}
            <Section title="Master Node Designation" icon={Server} defaultOpen={true} badge={masterDeployId ? masterName || 'Set' : 'None'}>
                <p className="text-xs text-slate-500 mb-4">
                    Designate a running container as the master node for orchestration tasks. The Orchestrate page will automatically use this container.
                </p>

                {masterDeployId ? (
                    <div className="space-y-4">
                        <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                                <Server className="w-5 h-5 text-emerald-400" />
                            </div>
                            <div className="flex-1">
                                <p className="text-sm font-bold text-emerald-400">{masterName || masterDeployId.slice(0, 12)}</p>
                                <p className="text-[10px] text-slate-500 font-mono">{masterDeployId}</p>
                            </div>
                            <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">Active Master</span>
                        </div>
                        <button
                            onClick={async () => {
                                setSettingMaster(true)
                                try {
                                    await setMasterDeployment('')
                                    setMasterDeployId('')
                                    setMasterName('')
                                    setToast({ message: 'Master node revoked', type: 'success' })
                                } catch (e: any) {
                                    setToast({ message: `Failed to revoke: ${e.message}`, type: 'error' })
                                } finally {
                                    setSettingMaster(false)
                                }
                            }}
                            disabled={settingMaster}
                            className={btnDanger}
                        >
                            <Unlink className="w-4 h-4" /> {settingMaster ? 'Revoking...' : 'Revoke Master Node'}
                        </button>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {deployments.filter(d => d.status === 'running').length === 0 ? (
                            <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/20 text-xs text-amber-400">
                                No running containers. Deploy an agent first.
                            </div>
                        ) : (
                            <>
                                <Field label="Select Container" hint="Choose a running container to designate as master node">
                                    <select
                                        value={selectedMasterId}
                                        onChange={e => setSelectedMasterId(e.target.value)}
                                        className={inputClass}
                                    >
                                        {deployments.filter(d => d.status === 'running').map(d => (
                                            <option key={d.deployment_id} value={d.deployment_id}>
                                                {d.name} — port {d.port} ({d.deployment_id.slice(0, 10)})
                                            </option>
                                        ))}
                                    </select>
                                </Field>
                                <button
                                    onClick={async () => {
                                        if (!selectedMasterId) return
                                        setSettingMaster(true)
                                        try {
                                            const result = await setMasterDeployment(selectedMasterId)
                                            setMasterDeployId(selectedMasterId)
                                            setMasterName(result.name || '')
                                            setToast({ message: result.message || 'Master node set', type: 'success' })
                                        } catch (e: any) {
                                            setToast({ message: `Failed: ${e.response?.data?.detail || e.message}`, type: 'error' })
                                        } finally {
                                            setSettingMaster(false)
                                        }
                                    }}
                                    disabled={settingMaster || !selectedMasterId}
                                    className={btnPrimary}
                                >
                                    {settingMaster ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Server className="w-4 h-4" />}
                                    {settingMaster ? 'Setting...' : 'Set as Master Node'}
                                </button>
                            </>
                        )}
                    </div>
                )}
            </Section>

            {/* Section: LLM Provider */}
            <Section title="LLM Provider" icon={Cpu} defaultOpen={false} badge={llmInfo ? `${llmInfo.provider}${llmInfo.configured ? '' : ' ⚠'}` : '...'}>
                <p className="text-xs text-slate-500 mb-4">
                    Select the LLM backend for Jason and expert agents. Supports OpenRouter, RunPod Serverless, or any OpenAI-compatible endpoint.
                </p>

                {llmInfo && (
                    <div className="space-y-5">
                        {/* Provider selector tabs */}
                        <div className="flex gap-2 flex-wrap">
                            {llmInfo.available_providers.map((p: LLMProviderOption) => (
                                <button
                                    key={p.id}
                                    onClick={() => { setLlmProviderState(p.id); setLlmTestResult(null) }}
                                    className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all ${
                                        llmProvider === p.id
                                            ? 'bg-primary/10 border-primary/40 text-primary shadow-[0_0_10px_rgba(6,87,249,0.2)]'
                                            : 'bg-slate-900 border-border text-slate-400 hover:border-slate-600'
                                    }`}
                                >
                                    {p.name}
                                    {llmInfo.provider === p.id && llmInfo.configured && (
                                        <span className="ml-2 text-emerald-400">●</span>
                                    )}
                                </button>
                            ))}
                        </div>

                        {/* Provider description */}
                        {llmInfo.available_providers.filter((p: LLMProviderOption) => p.id === llmProvider).map((p: LLMProviderOption) => (
                            <div key={p.id} className="space-y-4">
                                <p className="text-[11px] text-slate-400 bg-slate-900/50 rounded-xl px-4 py-3 border border-border">
                                    {p.description}
                                </p>

                                {/* Dynamic fields */}
                                {p.fields.map(f => (
                                    <Field key={f.key} label={f.label} hint={f.hint}>
                                        <div className="relative">
                                            <input
                                                type={f.sensitive && !llmShowSensitive[f.key] ? 'password' : 'text'}
                                                value={llmFields[f.key] || ''}
                                                onChange={e => setLlmFields(prev => ({ ...prev, [f.key]: e.target.value }))}
                                                placeholder={f.hint}
                                                className={inputClass}
                                            />
                                            {f.sensitive && (
                                                <button
                                                    onClick={() => setLlmShowSensitive(prev => ({ ...prev, [f.key]: !prev[f.key] }))}
                                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                                                >
                                                    {llmShowSensitive[f.key] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                                </button>
                                            )}
                                        </div>
                                    </Field>
                                ))}

                                {/* RunPod info box */}
                                {p.id === 'runpod' && (
                                    <div className="text-[11px] text-slate-400 bg-slate-900/50 rounded-xl px-4 py-3 border border-border space-y-1">
                                        <p className="font-bold text-slate-300">RunPod Setup:</p>
                                        <p>1. Create a Serverless Endpoint at <a href="https://www.runpod.io/console/serverless" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">runpod.io/console/serverless</a></p>
                                        <p>2. Use the vLLM Worker template with your chosen model</p>
                                        <p>3. Copy the Endpoint ID from the dashboard URL</p>
                                        <p>4. Get your API Key from <a href="https://www.runpod.io/console/user/settings" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Settings → API Keys</a></p>
                                        <p className="text-slate-500 mt-1">Base URL auto-builds to: <span className="font-mono text-primary/70">https://api.runpod.ai/v2/{'<ENDPOINT_ID>'}/openai/v1</span></p>
                                    </div>
                                )}

                                {/* Action buttons */}
                                <div className="flex gap-3 flex-wrap">
                                    <button
                                        onClick={async () => {
                                            setLlmSaving(true)
                                            setLlmTestResult(null)
                                            try {
                                                const payload: any = { provider: p.id }
                                                if (p.id === 'runpod') {
                                                    payload.runpod_api_key = llmFields['RUNPOD_API_KEY'] || ''
                                                    payload.runpod_endpoint_id = llmFields['RUNPOD_ENDPOINT_ID'] || ''
                                                    payload.runpod_model_name = llmFields['RUNPOD_MODEL_NAME'] || ''
                                                } else if (p.id === 'custom') {
                                                    payload.custom_base_url = llmFields['CUSTOM_LLM_BASE_URL'] || ''
                                                    payload.custom_api_key = llmFields['CUSTOM_LLM_API_KEY'] || ''
                                                    payload.custom_model_name = llmFields['CUSTOM_LLM_MODEL_NAME'] || ''
                                                } else {
                                                    payload.openrouter_api_key = llmFields['OPENROUTER_API_KEY'] || ''
                                                }
                                                const result = await setLLMProvider(payload)
                                                setToast({ message: result.message, type: 'success' })
                                                await loadLLMProvider()
                                            } catch (e: any) {
                                                setToast({ message: `Failed: ${e.response?.data?.detail || e.message}`, type: 'error' })
                                            } finally {
                                                setLlmSaving(false)
                                            }
                                        }}
                                        disabled={llmSaving}
                                        className={btnPrimary}
                                    >
                                        {llmSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                        {llmSaving ? 'Saving...' : `Activate ${p.name}`}
                                    </button>

                                    <button
                                        onClick={async () => {
                                            setLlmTesting(true)
                                            setLlmTestResult(null)
                                            try {
                                                const result = await testLLMConnection()
                                                setLlmTestResult(result)
                                            } catch (e: any) {
                                                setLlmTestResult({ ok: false, error: e.message })
                                            } finally {
                                                setLlmTesting(false)
                                            }
                                        }}
                                        disabled={llmTesting || !llmInfo.configured}
                                        className={btnSecondary}
                                    >
                                        {llmTesting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
                                        {llmTesting ? 'Testing...' : 'Test Connection'}
                                    </button>
                                </div>

                                {/* Test result */}
                                {llmTestResult && (
                                    <div className={`p-4 rounded-xl border text-xs ${
                                        llmTestResult.ok
                                            ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-400'
                                            : 'bg-red-500/5 border-red-500/20 text-red-400'
                                    }`}>
                                        {llmTestResult.ok ? (
                                            <div className="space-y-2">
                                                <p className="font-bold flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> Connection successful!</p>
                                                {llmTestResult.models && llmTestResult.models.length > 0 && (
                                                    <div>
                                                        <p className="text-slate-400 mb-1">Available models:</p>
                                                        <div className="flex flex-wrap gap-1">
                                                            {llmTestResult.models.map(m => (
                                                                <span key={m} className="px-2 py-0.5 bg-emerald-500/10 rounded-md font-mono text-[10px]">{m}</span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            <p className="font-bold flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {llmTestResult.error}</p>
                                        )}
                                    </div>
                                )}

                                {/* Current status indicator */}
                                {llmInfo.provider === p.id && (
                                    <div className={`flex items-center gap-2 text-[11px] font-bold ${llmInfo.configured ? 'text-emerald-400' : 'text-amber-400'}`}>
                                        {llmInfo.configured ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                                        {llmInfo.configured ? 'Active and configured' : 'Active but missing configuration'}
                                        {llmInfo.base_url && <span className="text-slate-500 font-mono font-normal ml-2">→ {llmInfo.base_url}</span>}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </Section>

            {/* Section 1: Connection */}
            <Section title="Connection" icon={Link2} defaultOpen={true}>
                {/* Status badge */}
                <div className="flex items-center gap-3 mb-4">
                    {isConnected ? (
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                            <Wifi className="w-4 h-4 text-emerald-400" />
                            <span className="text-xs font-bold text-emerald-400">Connected</span>
                            {status?.url && <span className="text-xs text-slate-500 ml-1">— {status.url}</span>}
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 border border-border">
                            <WifiOff className="w-4 h-4 text-slate-500" />
                            <span className="text-xs font-bold text-slate-500">Disconnected</span>
                        </div>
                    )}
                    {isConnected && status?.protocol && (
                        <span className="text-[10px] text-slate-600">Protocol v{status.protocol}</span>
                    )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Field label="WebSocket URL" hint="The OpenClaw container's WebSocket endpoint">
                        <input
                            type="text" value={url} onChange={e => setUrl(e.target.value)}
                            placeholder="ws://72.61.254.5:61816"
                            className={inputClass} disabled={isConnected}
                        />
                    </Field>
                    <Field label="Auth Token" hint="Gateway authentication token">
                        <div className="relative">
                            <input
                                type={showToken ? 'text' : 'password'} value={token} onChange={e => setToken(e.target.value)}
                                placeholder="Enter gateway token"
                                className={`${inputClass} pr-10`} disabled={isConnected}
                            />
                            <button onClick={() => setShowToken(!showToken)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                        </div>
                    </Field>
                    <Field label="Session Key" hint="Agent session identifier">
                        <input
                            type="text" value={sessionKey} onChange={e => setSessionKey(e.target.value)}
                            placeholder="agent:main:main"
                            className={inputClass} disabled={isConnected}
                        />
                    </Field>
                </div>

                {/* Cloudflare Access fields — shown for wss:// URLs */}
                {url.startsWith('wss://') && (
                    <div className="mt-4 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                        <p className="text-xs text-amber-400 font-bold mb-2 flex items-center gap-1.5">
                            <Shield className="w-3.5 h-3.5" />
                            Cloudflare Access (Zero Trust)
                        </p>
                        <p className="text-[10px] text-slate-500 mb-3">Required if the endpoint is behind Cloudflare Access. Create a service token in your CF Zero Trust dashboard.</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <Field label="CF Access Client ID" hint="Service token Client ID">
                                <input
                                    type="text" value={cfClientId} onChange={e => setCfClientId(e.target.value)}
                                    placeholder="e.g. abc123.access"
                                    className={inputClass} disabled={isConnected}
                                />
                            </Field>
                            <Field label="CF Access Client Secret" hint="Service token Client Secret">
                                <div className="relative">
                                    <input
                                        type={showCfSecret ? 'text' : 'password'} value={cfClientSecret} onChange={e => setCfClientSecret(e.target.value)}
                                        placeholder="Service token secret"
                                        className={`${inputClass} pr-10`} disabled={isConnected}
                                    />
                                    <button onClick={() => setShowCfSecret(!showCfSecret)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                                        {showCfSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                            </Field>
                        </div>
                    </div>
                )}

                <div className="flex gap-3 mt-2">
                    {!isConnected ? (
                        <button onClick={handleConnect} disabled={connecting || !url || !token} className={btnPrimary}>
                            {connecting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                            {connecting ? 'Connecting...' : 'Connect'}
                        </button>
                    ) : (
                        <button onClick={handleDisconnect} className={btnDanger}>
                            <Unlink className="w-4 h-4" /> Disconnect
                        </button>
                    )}
                </div>
            </Section>

            {/* Section 2: Auth & Gateway (only when connected) */}
            {isConnected && (
                <Section title="Auth & Gateway" icon={Key} defaultOpen={true} badge={gatewayMode}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Field label="Gateway Auth Token" hint="Token used for gateway authentication (gateway.auth.token)">
                            <div className="relative">
                                <input
                                    type={showGatewayToken ? 'text' : 'password'}
                                    value={gatewayToken}
                                    onChange={e => {
                                        updateConfigField(['gateway', 'auth', 'token'], e.target.value)
                                        updateConfigField(['gateway', 'remote', 'token'], e.target.value)
                                    }}
                                    placeholder="Gateway token"
                                    className={`${inputClass} pr-10`}
                                />
                                <button onClick={() => setShowGatewayToken(!showGatewayToken)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                                    {showGatewayToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                        </Field>

                        <Field label="OpenRouter API Key" hint="Set via auth profile (auth.profiles.openrouter:default)">
                            <div className="relative">
                                <input
                                    type={showOpenRouterKey ? 'text' : 'password'}
                                    value={getConfigVal(['auth', 'profiles', 'openrouter:default', 'apiKey'], '')}
                                    onChange={e => updateConfigField(['auth', 'profiles', 'openrouter:default', 'apiKey'], e.target.value)}
                                    placeholder="sk-or-v1-..."
                                    className={`${inputClass} pr-10`}
                                />
                                <button onClick={() => setShowOpenRouterKey(!showOpenRouterKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                                    {showOpenRouterKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                        </Field>

                        <Field label="Gateway Mode">
                            <select value={gatewayMode} onChange={e => updateConfigField(['gateway', 'mode'], e.target.value)} className={inputClass}>
                                <option value="local">local</option>
                                <option value="remote">remote</option>
                            </select>
                        </Field>

                        <Field label="Auth Mode">
                            <select value={getConfigVal(['gateway', 'auth', 'mode'], 'token')} onChange={e => updateConfigField(['gateway', 'auth', 'mode'], e.target.value)} className={inputClass}>
                                <option value="token">token</option>
                                <option value="none">none</option>
                            </select>
                        </Field>
                    </div>
                </Section>
            )}

            {/* Section 3: Agent Configuration (only when connected) */}
            {isConnected && (
                <Section title="Agent Configuration" icon={Cpu} defaultOpen={true} badge={primaryModel.split('/').pop()}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Field label="Primary Model">
                            <div className="space-y-2">
                                <input
                                    type="text" value={modelSearch} onChange={e => setModelSearch(e.target.value)}
                                    placeholder="Search models..."
                                    className={inputClass}
                                />
                                <select
                                    value={primaryModel}
                                    onChange={e => updateConfigField(['agents', 'defaults', 'model', 'primary'], e.target.value)}
                                    className={`${inputClass} h-48`} size={8}
                                >
                                    {Object.entries(groupedModels).sort(([a], [b]) => a.localeCompare(b)).map(([provider, providerModels]) => (
                                        <optgroup key={provider} label={provider}>
                                            {providerModels.map(m => (
                                                <option key={m.id} value={m.id}>{m.name || m.id}</option>
                                            ))}
                                        </optgroup>
                                    ))}
                                </select>
                                <p className="text-[10px] text-slate-600">
                                    Current: <span className="text-primary font-mono">{primaryModel || 'none'}</span>
                                    {models.length > 0 && <span className="ml-2">({models.length} models available)</span>}
                                </p>
                            </div>
                        </Field>

                        <div className="space-y-4">
                            <Field label="Max Concurrent Agents">
                                <div className="flex items-center gap-3">
                                    <input
                                        type="range" min={1} max={16} value={maxConcurrent}
                                        onChange={e => updateConfigField(['agents', 'defaults', 'maxConcurrent'], parseInt(e.target.value))}
                                        className="flex-1 accent-primary"
                                    />
                                    <span className="text-sm font-mono text-primary w-8 text-center">{maxConcurrent}</span>
                                </div>
                            </Field>

                            <Field label="Max Concurrent Sub-agents">
                                <div className="flex items-center gap-3">
                                    <input
                                        type="range" min={1} max={32} value={maxSubagents}
                                        onChange={e => updateConfigField(['agents', 'defaults', 'subagents', 'maxConcurrent'], parseInt(e.target.value))}
                                        className="flex-1 accent-primary"
                                    />
                                    <span className="text-sm font-mono text-primary w-8 text-center">{maxSubagents}</span>
                                </div>
                            </Field>

                            <Field label="Compaction Mode" hint="Memory compaction strategy">
                                <select value={compactionMode} onChange={e => updateConfigField(['agents', 'defaults', 'compaction', 'mode'], e.target.value)} className={inputClass}>
                                    <option value="safeguard">safeguard</option>
                                    <option value="aggressive">aggressive</option>
                                    <option value="none">none</option>
                                </select>
                            </Field>

                            <Field label="Commands">
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <p className="text-[10px] text-slate-600 mb-1">Native</p>
                                        <select value={commandsNative} onChange={e => updateConfigField(['commands', 'native'], e.target.value)} className={inputClass}>
                                            <option value="auto">auto</option>
                                            <option value="enabled">enabled</option>
                                            <option value="disabled">disabled</option>
                                        </select>
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-slate-600 mb-1">Native Skills</p>
                                        <select value={commandsNativeSkills} onChange={e => updateConfigField(['commands', 'nativeSkills'], e.target.value)} className={inputClass}>
                                            <option value="auto">auto</option>
                                            <option value="enabled">enabled</option>
                                            <option value="disabled">disabled</option>
                                        </select>
                                    </div>
                                </div>
                            </Field>
                        </div>
                    </div>

                    {/* Model Aliases */}
                    <div className="mt-2 p-4 rounded-xl bg-slate-900/50 border border-border">
                        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-3">Model Aliases</p>
                        <div className="space-y-2">
                            {Object.entries(modelAliases).map(([modelId, aliasObj]: [string, any]) => (
                                <div key={modelId} className="flex items-center gap-2 text-xs group">
                                    <span className="font-mono text-slate-400 truncate flex-1">{modelId}</span>
                                    <span className="text-slate-600">&rarr;</span>
                                    <span className="font-bold text-primary min-w-[60px]">{aliasObj?.alias || '?'}</span>
                                    <button onClick={() => removeModelAlias(modelId)} className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 transition-all">
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            ))}
                            {Object.keys(modelAliases).length === 0 && (
                                <p className="text-xs text-slate-600">No aliases configured</p>
                            )}
                        </div>
                        <div className="flex gap-2 mt-3">
                            <input type="text" value={newAliasModel} onChange={e => setNewAliasModel(e.target.value)} placeholder="model id (e.g. openrouter/x-ai/grok-3)" className={`${inputClass} text-xs`} />
                            <input type="text" value={newAliasName} onChange={e => setNewAliasName(e.target.value)} placeholder="alias" className={`${inputClass} text-xs w-32`} />
                            <button onClick={addModelAlias} disabled={!newAliasModel || !newAliasName} className={btnSecondary}>
                                <Plus className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>

                    {/* Save / Reload */}
                    <div className="flex gap-3 pt-2">
                        <button onClick={handleSaveConfig} disabled={savingConfig} className={btnPrimary}>
                            {savingConfig ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            Save Configuration
                        </button>
                        <button onClick={loadConfig} className={btnSecondary}>
                            <RefreshCw className="w-4 h-4" /> Reload
                        </button>
                    </div>

                    {config && !config.valid && (
                        <div className="mt-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                            <p className="font-bold mb-1">Config validation issues:</p>
                            {config.issues.map((issue, i) => <p key={i}>- {issue}</p>)}
                        </div>
                    )}
                </Section>
            )}

            {/* Section 4: Create New Agent (only when connected) */}
            {isConnected && (
                <Section title="Create New Agent" icon={Plus} defaultOpen={false}>
                    <p className="text-xs text-slate-500 mb-4">
                        Create a new OpenClaw agent with one click. The agent gets its own workspace, model, and identity.
                        The gateway will restart automatically after creation.
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Field label="Agent ID" hint="Unique lowercase identifier (e.g. researcher, coder)">
                            <input
                                type="text" value={newAgentId}
                                onChange={e => setNewAgentId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                                placeholder="e.g. researcher"
                                className={inputClass} disabled={creatingAgent}
                            />
                        </Field>
                        <Field label="Display Name" hint="Human-readable name for the agent">
                            <input
                                type="text" value={newAgentName}
                                onChange={e => setNewAgentName(e.target.value)}
                                placeholder="e.g. Research Agent"
                                className={inputClass} disabled={creatingAgent}
                            />
                        </Field>
                        <Field label="Model (optional)" hint="LLM model — leave blank to use default">
                            <input
                                type="text" value={newAgentModel}
                                onChange={e => setNewAgentModel(e.target.value)}
                                placeholder="e.g. openrouter/anthropic/claude-sonnet-4"
                                className={inputClass} disabled={creatingAgent}
                            />
                        </Field>
                        <Field label="Emoji (optional)" hint="Emoji for agent identity in chats">
                            <input
                                type="text" value={newAgentEmoji}
                                onChange={e => setNewAgentEmoji(e.target.value)}
                                placeholder="e.g. 🔍"
                                className={inputClass} disabled={creatingAgent}
                                maxLength={4}
                            />
                        </Field>
                    </div>

                    <div className="flex items-center gap-3 mt-4">
                        <button
                            onClick={handleCreateAgent}
                            disabled={creatingAgent || !newAgentId || !newAgentName}
                            className={btnPrimary}
                        >
                            {creatingAgent ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                            {creatingAgent ? 'Creating...' : 'Create Agent'}
                        </button>
                        {newAgentId && (
                            <span className="text-[10px] text-slate-500">
                                Workspace: <span className="font-mono text-slate-400">~/.openclaw/workspace-{newAgentId}</span>
                            </span>
                        )}
                    </div>

                    {/* Show existing agents from config */}
                    {(() => {
                        const agentsList = getConfigVal(['agents', 'list'], [])
                        if (!Array.isArray(agentsList) || agentsList.length === 0) return null
                        return (
                            <div className="mt-4 p-3 rounded-lg bg-slate-800/50 border border-border">
                                <p className="text-xs font-bold text-slate-400 mb-2">Existing Agents ({agentsList.length})</p>
                                <div className="space-y-1">
                                    {agentsList.map((a: any, i: number) => (
                                        <div key={i} className="flex items-center gap-2 text-xs text-slate-400">
                                            <Cpu className="w-3 h-3 text-primary/60" />
                                            <span className="font-mono text-slate-300">{a.id}</span>
                                            {a.name && <span className="text-slate-500">— {a.name}</span>}
                                            {a.model && <span className="text-slate-600 text-[10px]">({typeof a.model === 'string' ? a.model.split('/').pop() : 'custom'})</span>}
                                            {a.default && <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-bold">default</span>}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )
                    })()}
                </Section>
            )}

            {/* Section 5: Telegram (optional, only when connected) */}
            {isConnected && (
                <Section title="Telegram Channel" icon={Send} defaultOpen={false} badge={telegramEnabled ? 'enabled' : 'disabled'}>
                    <p className="text-xs text-slate-500 mb-3">
                        Optional — configure Telegram bot integration. Leave disabled if not needed.
                    </p>

                    <Toggle
                        checked={telegramEnabled}
                        onChange={v => updateConfigField(['plugins', 'entries', 'telegram', 'enabled'], v)}
                        label="Enable Telegram Plugin"
                    />

                    {telegramEnabled && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                            <Field label="DM Policy" hint="Who can DM the bot">
                                <select value={telegramDmPolicy} onChange={e => updateConfigField(['channels', 'telegram', 'dmPolicy'], e.target.value)} className={inputClass}>
                                    <option value="allowlist">allowlist</option>
                                    <option value="open">open</option>
                                    <option value="disabled">disabled</option>
                                </select>
                            </Field>

                            <Field label="Group Policy" hint="How the bot behaves in groups">
                                <select value={telegramGroupPolicy} onChange={e => updateConfigField(['channels', 'telegram', 'groupPolicy'], e.target.value)} className={inputClass}>
                                    <option value="disabled">disabled</option>
                                    <option value="mentions">mentions</option>
                                    <option value="all">all</option>
                                </select>
                            </Field>

                            <Field label="Stream Mode">
                                <select value={telegramStreamMode} onChange={e => updateConfigField(['channels', 'telegram', 'streamMode'], e.target.value)} className={inputClass}>
                                    <option value="partial">partial</option>
                                    <option value="full">full</option>
                                    <option value="none">none</option>
                                </select>
                            </Field>

                            <Field label="Media Max MB">
                                <input type="number" value={telegramMediaMaxMb} onChange={e => updateConfigField(['channels', 'telegram', 'mediaMaxMb'], parseInt(e.target.value) || 50)} className={inputClass} min={1} max={200} />
                            </Field>

                            <Field label="Allowed Telegram IDs" hint="User IDs allowed to DM the bot">
                                <div className="space-y-2">
                                    {telegramAllowFrom.map((id: string) => (
                                        <div key={id} className="flex items-center gap-2 text-xs group">
                                            <span className="font-mono text-slate-300 flex-1">{id}</span>
                                            <button onClick={() => removeTelegramAllowFrom(id)} className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300">
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                    <div className="flex gap-2">
                                        <input type="text" value={newTelegramId} onChange={e => setNewTelegramId(e.target.value)} placeholder="Telegram user ID" className={`${inputClass} text-xs`} />
                                        <button onClick={addTelegramAllowFrom} disabled={!newTelegramId} className={btnSecondary}>
                                            <Plus className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </div>
                            </Field>
                        </div>
                    )}

                    {telegramEnabled && (
                        <div className="flex gap-3 pt-2">
                            <button onClick={handleSaveConfig} disabled={savingConfig} className={btnPrimary}>
                                {savingConfig ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                Save Telegram Config
                            </button>
                        </div>
                    )}
                </Section>
            )}

            {/* Section 6: Agent Persona Files (only when connected) */}
            {isConnected && (
                <Section title="Agent Persona Files" icon={FileText} defaultOpen={false}>
                    <p className="text-xs text-slate-500 mb-3">
                        These markdown files define the agent's identity, personality, tools, and behavior.
                        Edit them to customize how the remote Jason agent operates.
                    </p>

                    {/* File tabs */}
                    <div className="flex flex-wrap gap-1 mb-3">
                        {PERSONA_FILES.map(name => {
                            const fileInfo = agentFiles.find(f => f.name === name)
                            const isMissing = fileInfo?.missing
                            return (
                                <button
                                    key={name}
                                    onClick={() => setActiveFile(name)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${activeFile === name
                                        ? 'bg-primary/20 text-primary border border-primary/30'
                                        : 'bg-slate-800 text-slate-400 hover:text-slate-200 border border-transparent'
                                        } ${isMissing ? 'opacity-50' : ''}`}
                                >
                                    {name.replace('.md', '')}
                                    {fileInfo && !isMissing && <span className="ml-1 text-[9px] text-slate-600">({Math.round((fileInfo.size || 0) / 1024 * 10) / 10}k)</span>}
                                </button>
                            )
                        })}
                    </div>

                    {/* File editor */}
                    <div className="relative">
                        {loadingFile && (
                            <div className="absolute inset-0 bg-slate-900/80 flex items-center justify-center rounded-xl z-10">
                                <RefreshCw className="w-5 h-5 text-primary animate-spin" />
                            </div>
                        )}
                        <textarea
                            value={fileContent}
                            onChange={e => setFileContent(e.target.value)}
                            placeholder={`Enter content for ${activeFile}...\n\nExample for IDENTITY.md:\n# Jason\nYou are Jason, an AI orchestrator agent...`}
                            className={`${inputClass} h-64 font-mono text-xs resize-y`}
                            spellCheck={false}
                        />
                    </div>

                    <div className="flex items-center gap-3">
                        <button onClick={handleSaveFile} disabled={savingFile || !fileHasChanges} className={btnPrimary}>
                            {savingFile ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            Save {activeFile}
                        </button>
                        <button onClick={() => loadFileContent(activeFile)} className={btnSecondary}>
                            <RefreshCw className="w-4 h-4" /> Reload
                        </button>
                        {fileHasChanges && (
                            <span className="text-[10px] text-amber-400 font-bold">Unsaved changes</span>
                        )}
                    </div>
                </Section>
            )}

            {/* Section 7: Server Info (only when connected) */}
            {isConnected && status?.server && (
                <Section title="Server Info" icon={Server} defaultOpen={false}>
                    <pre className="text-xs font-mono text-slate-400 bg-slate-900 rounded-xl p-4 overflow-auto max-h-48">
                        {JSON.stringify(status.server, null, 2)}
                    </pre>
                </Section>
            )}

            {/* Toast */}
            {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
        </motion.div>
    )
}
