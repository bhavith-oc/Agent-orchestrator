import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
    Activity, Cpu, Clock, Loader2, RefreshCw, Rocket, Globe, Trash2,
    ChevronDown, ChevronRight, RotateCw, Save, X, Pencil, Eye, EyeOff
} from 'lucide-react'
import {
    fetchAgents, fetchDeployList, fetchRemoteStatus, deleteAgent,
    fetchDeployInfo, restartDeploy, removeDeploy, updateDeployEnv,
    AgentInfo, DeploymentInfo, DeployDetailInfo, RemoteStatus
} from '../api'

export default function Agents() {
    const [agents, setAgents] = useState<AgentInfo[]>([])
    const [deployments, setDeployments] = useState<DeploymentInfo[]>([])
    const [remoteStatus, setRemoteStatus] = useState<RemoteStatus>({ connected: false })
    const [loading, setLoading] = useState(true)
    const [showCompleted, setShowCompleted] = useState(false)
    const [refreshing, setRefreshing] = useState(false)

    // Expanded card state
    const [expandedDeploy, setExpandedDeploy] = useState<string | null>(null)
    const [deployDetail, setDeployDetail] = useState<DeployDetailInfo | null>(null)
    const [detailLoading, setDetailLoading] = useState(false)

    // Action states
    const [actionLoading, setActionLoading] = useState<Record<string, string>>({}) // id -> action name
    const [actionMessage, setActionMessage] = useState<{ id: string; msg: string; type: 'success' | 'error' } | null>(null)

    // Edit env state
    const [editingEnv, setEditingEnv] = useState(false)
    const [envEdits, setEnvEdits] = useState<Record<string, string>>({})
    const [showSensitive, setShowSensitive] = useState<Record<string, boolean>>({})

    const SENSITIVE_KEYS = new Set(['OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENCLAW_GATEWAY_TOKEN', 'TELEGRAM_BOT_TOKEN'])

    const loadAgents = async () => {
        try {
            const data = await fetchAgents()
            setAgents(data)
        } catch (error) {
            console.error("Failed to load agents", error)
        } finally {
            setLoading(false)
        }
    }

    const loadDeployments = async () => {
        try {
            const list = await fetchDeployList()
            setDeployments(list)
        } catch { setDeployments([]) }
    }

    const checkRemoteStatus = async () => {
        try {
            const status = await fetchRemoteStatus()
            setRemoteStatus(status)
        } catch { setRemoteStatus({ connected: false }) }
    }

    const refreshAll = async () => {
        setRefreshing(true)
        await Promise.all([loadAgents(), loadDeployments(), checkRemoteStatus()])
        setRefreshing(false)
    }

    useEffect(() => {
        loadAgents()
        loadDeployments()
        checkRemoteStatus()
        const interval = setInterval(loadAgents, 5000)
        const deployInterval = setInterval(loadDeployments, 10000)
        return () => { clearInterval(interval); clearInterval(deployInterval) }
    }, [])

    // Load detail when a card is expanded
    const toggleExpand = async (deployId: string) => {
        if (expandedDeploy === deployId) {
            setExpandedDeploy(null)
            setDeployDetail(null)
            setEditingEnv(false)
            setEnvEdits({})
            return
        }
        setExpandedDeploy(deployId)
        setDetailLoading(true)
        setEditingEnv(false)
        setEnvEdits({})
        try {
            const info = await fetchDeployInfo(deployId)
            setDeployDetail(info)
        } catch (err) {
            console.error('Failed to load deploy info', err)
            setDeployDetail(null)
        } finally {
            setDetailLoading(false)
        }
    }

    const handleRestart = async (deployId: string) => {
        setActionLoading(prev => ({ ...prev, [deployId]: 'restarting' }))
        setActionMessage(null)
        try {
            await restartDeploy(deployId)
            setActionMessage({ id: deployId, msg: 'Container restarted successfully', type: 'success' })
            await loadDeployments()
        } catch (err: any) {
            setActionMessage({ id: deployId, msg: err?.response?.data?.detail || 'Restart failed', type: 'error' })
        } finally {
            setActionLoading(prev => { const n = { ...prev }; delete n[deployId]; return n })
        }
    }

    const handleRemove = async (deployId: string, name: string) => {
        if (!confirm(`Remove deployment "${name}"?\n\nThis will stop the container and delete all deployment files. This action cannot be undone.`)) return
        setActionLoading(prev => ({ ...prev, [deployId]: 'removing' }))
        const startTime = Date.now()
        try {
            await removeDeploy(deployId)
            const elapsed = Math.round((Date.now() - startTime) / 1000)
            // Don't show action message banner, the in-card banner handles it
            if (expandedDeploy === deployId) {
                setExpandedDeploy(null)
                setDeployDetail(null)
            }
            // Auto-refresh to remove from UI
            await loadDeployments()
        } catch (err: any) {
            setActionMessage({ id: deployId, msg: err?.response?.data?.detail || 'Remove failed', type: 'error' })
        } finally {
            setActionLoading(prev => { const n = { ...prev }; delete n[deployId]; return n })
        }
    }

    const startEditEnv = () => {
        if (!deployDetail) return
        setEditingEnv(true)
        setEnvEdits({ ...(deployDetail.env_config_full || deployDetail.env_config) })
    }

    const cancelEditEnv = () => {
        setEditingEnv(false)
        setEnvEdits({})
    }

    const saveEnvAndRestart = async () => {
        if (!deployDetail || !expandedDeploy) return
        // Find changed keys
        const changes: Record<string, string> = {}
        const fullConfig = deployDetail.env_config_full || deployDetail.env_config
        for (const [key, val] of Object.entries(envEdits)) {
            if (val !== fullConfig[key]) {
                changes[key] = val
            }
        }
        if (Object.keys(changes).length === 0) {
            setEditingEnv(false)
            return
        }
        setActionLoading(prev => ({ ...prev, [expandedDeploy]: 'saving' }))
        try {
            await updateDeployEnv(expandedDeploy, changes)
            await restartDeploy(expandedDeploy)
            setActionMessage({ id: expandedDeploy, msg: `Updated ${Object.keys(changes).length} key(s) and restarted`, type: 'success' })
            // Reload detail
            const info = await fetchDeployInfo(expandedDeploy)
            setDeployDetail(info)
            setEditingEnv(false)
            setEnvEdits({})
            await loadDeployments()
        } catch (err: any) {
            setActionMessage({ id: expandedDeploy, msg: err?.response?.data?.detail || 'Save failed', type: 'error' })
        } finally {
            setActionLoading(prev => { const n = { ...prev }; delete n[expandedDeploy!]; return n })
        }
    }

    // Filter: exclude master (Jason) — shown via deployments
    const nonMasterAgents = agents.filter(a => a.type !== 'master')
    const activeAgents = nonMasterAgents.filter(a => a.status === 'active' || a.status === 'busy')
    const completedAgents = nonMasterAgents.filter(a => a.status === 'completed' || a.status === 'failed' || a.status === 'offline')
    const displayAgents = showCompleted ? nonMasterAgents : activeAgents

    const getStatusStyle = (status: string) => {
        switch (status) {
            case 'active': return 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
            case 'busy': return 'bg-amber-500/10 border-amber-500/20 text-amber-400'
            case 'failed':
            case 'offline': return 'bg-red-500/10 border-red-500/20 text-red-400'
            case 'completed': return 'bg-blue-500/10 border-blue-500/20 text-blue-400'
            default: return 'bg-slate-700/30 border-slate-600/30 text-slate-400'
        }
    }

    const getDotStyle = (status: string) => {
        switch (status) {
            case 'active': return 'bg-emerald-500 animate-pulse'
            case 'busy': return 'bg-amber-500 animate-pulse'
            case 'failed':
            case 'offline': return 'bg-red-500'
            case 'completed': return 'bg-blue-500'
            default: return 'bg-slate-400'
        }
    }

    if (loading) {
        return <div className="h-full flex items-center justify-center"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>
    }

    const allDeployments = showCompleted ? deployments : deployments.filter(d => d.status === 'running')
    const stoppedDeployments = deployments.filter(d => d.status !== 'running')

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-8"
        >
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-xl font-bold font-display">Neural Agent Pool</h3>
                    <p className="text-xs text-slate-500 mt-1">
                        {deployments.filter(d => d.status === 'running').length} deployed · {remoteStatus.connected ? '1 remote · ' : ''}{activeAgents.length} orchestrator{completedAgents.length > 0 && ` · ${completedAgents.length} completed`}
                    </p>
                </div>
                <div className="flex gap-2">
                    {(completedAgents.length > 0 || stoppedDeployments.length > 0) && (
                        <button
                            onClick={() => setShowCompleted(!showCompleted)}
                            className={`px-4 py-2 text-xs font-bold rounded-xl transition-all border ${showCompleted ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'}`}
                        >
                            {showCompleted ? 'Hide Stopped' : `Show All (${stoppedDeployments.length} stopped)`}
                        </button>
                    )}
                    <button
                        onClick={refreshAll}
                        disabled={refreshing}
                        className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-xl transition-all border border-slate-700 disabled:opacity-50"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 inline mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />Refresh All
                    </button>
                </div>
            </div>

            {/* Action message toast */}
            <AnimatePresence>
                {actionMessage && (
                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className={`px-4 py-2.5 rounded-xl text-xs font-bold border flex items-center justify-between ${actionMessage.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}
                    >
                        <span>{actionMessage.msg}</span>
                        <button onClick={() => setActionMessage(null)} className="ml-4 hover:opacity-70"><X className="w-3.5 h-3.5" /></button>
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* Deployed containers — clickable expandable cards */}
                {allDeployments.map((d) => {
                    const isExpanded = expandedDeploy === d.deployment_id
                    const isRunning = d.status === 'running'
                    const isActioning = !!actionLoading[d.deployment_id]
                    const borderColor = isRunning
                        ? (isExpanded ? 'border-primary/50 ring-1 ring-primary/20' : 'border-primary/20 hover:border-primary/50')
                        : 'border-[#2d3748] opacity-70'

                    return (
                        <div
                            key={`deploy-${d.deployment_id}`}
                            className={`relative rounded-2xl bg-[#1a1e29] border transition-all overflow-hidden ${borderColor} ${isExpanded ? 'col-span-1 md:col-span-2 lg:col-span-3' : ''}`}
                        >
                            {/* Card Header — always visible, clickable */}
                            <button
                                onClick={() => toggleExpand(d.deployment_id)}
                                className="w-full p-6 text-left group"
                            >
                                <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 blur-3xl rounded-full -mr-16 -mt-16 group-hover:bg-primary/10 transition-colors pointer-events-none" />
                                <div className="flex justify-between items-start">
                                    <div className="flex items-center gap-3">
                                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center border ${isRunning ? 'bg-primary/10 border-primary/20 text-primary' : 'bg-slate-700/30 border-slate-600/30 text-slate-400'}`}>
                                            <Rocket className="w-6 h-6" />
                                        </div>
                                        <div>
                                            <h4 className="font-bold text-sm tracking-tight">{d.name}</h4>
                                            <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">OpenClaw Container · {d.deployment_id.slice(0, 10)}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <div className={`px-2 py-1 rounded-full text-[10px] font-bold border uppercase tracking-wide flex items-center gap-1.5 ${isRunning ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
                                            <span className={`w-1.5 h-1.5 rounded-full ${isRunning ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                                            {d.status}
                                        </div>
                                        <span className="text-slate-500">
                                            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                        </span>
                                    </div>
                                </div>
                                {/* Summary row */}
                                {!isExpanded && (
                                    <div className="mt-4">
                                        <div className="bg-[#0f1117] rounded-xl px-4 py-2.5 border border-border text-sm text-slate-400 inline-block">
                                            Port: <span className="font-bold text-slate-200">{d.port}</span>
                                        </div>
                                    </div>
                                )}
                            </button>

                            {/* Expanded Detail Panel */}
                            <AnimatePresence>
                                {isExpanded && (
                                    <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        transition={{ duration: 0.2 }}
                                        className="overflow-hidden"
                                    >
                                        <div className="px-6 pb-6 border-t border-border pt-4 space-y-5">
                                            {/* Action buttons */}
                                            <div className="flex gap-2 flex-wrap">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleRestart(d.deployment_id) }}
                                                    disabled={isActioning}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 transition-all disabled:opacity-50"
                                                >
                                                    <RotateCw className={`w-3 h-3 ${actionLoading[d.deployment_id] === 'restarting' ? 'animate-spin' : ''}`} />
                                                    {actionLoading[d.deployment_id] === 'restarting' ? 'Restarting...' : 'Restart'}
                                                </button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleRemove(d.deployment_id, d.name) }}
                                                    disabled={isActioning}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all disabled:opacity-50"
                                                >
                                                    <Trash2 className="w-3 h-3" />
                                                    {actionLoading[d.deployment_id] === 'removing' ? 'Removing...' : 'Remove'}
                                                </button>
                                                {!editingEnv && deployDetail && (
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); startEditEnv() }}
                                                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 transition-all"
                                                    >
                                                        <Pencil className="w-3 h-3" /> Edit Config
                                                    </button>
                                                )}
                                            </div>

                                            {/* Detail loading */}
                                            {detailLoading && (
                                                <div className="flex items-center gap-2 text-slate-500 text-xs">
                                                    <Loader2 className="w-4 h-4 animate-spin" /> Loading configuration...
                                                </div>
                                            )}

                                            {/* Detail info */}
                                            {deployDetail && !detailLoading && (
                                                <div className="space-y-4">
                                                    {/* Removal progress banner */}
                                                    {actionLoading[d.deployment_id] === 'removing' && (
                                                        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-center gap-3">
                                                            <Loader2 className="w-5 h-5 text-amber-400 animate-spin shrink-0" />
                                                            <div>
                                                                <p className="text-sm font-bold text-amber-400">Removal in Progress</p>
                                                                <p className="text-xs text-amber-300/70 mt-0.5">Stopping container and cleaning up files... This may take 10-30 seconds.</p>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Connection info */}
                                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                                        <div className="bg-[#0f1117] rounded-xl p-3 border border-border">
                                                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Port</p>
                                                            <span className="text-lg font-bold font-display leading-none">{deployDetail.port}</span>
                                                        </div>
                                                        <div className="bg-[#0f1117] rounded-xl p-3 border border-border">
                                                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Deployment ID</p>
                                                            <p className="text-xs text-slate-300 font-mono">{deployDetail.deployment_id}</p>
                                                        </div>
                                                        <a
                                                            href={`http://72.61.254.5:${deployDetail.port}/?token=${deployDetail.gateway_token}`}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="bg-[#0f1117] rounded-xl p-3 border border-primary/20 hover:border-primary/50 transition-all group/link"
                                                        >
                                                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">OpenClaw UI</p>
                                                            <p className="text-xs text-primary font-bold group-hover/link:underline">Open in Browser &rarr;</p>
                                                        </a>
                                                    </div>

                                                    {/* Environment Configuration */}
                                                    <div className="bg-[#0f1117] rounded-xl border border-border overflow-hidden">
                                                        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                                                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Environment Configuration</p>
                                                            {editingEnv && (
                                                                <div className="flex gap-2">
                                                                    <button
                                                                        onClick={saveEnvAndRestart}
                                                                        disabled={isActioning}
                                                                        className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50"
                                                                    >
                                                                        <Save className="w-3 h-3" />
                                                                        {actionLoading[d.deployment_id] === 'saving' ? 'Saving...' : 'Save & Restart'}
                                                                    </button>
                                                                    <button
                                                                        onClick={cancelEditEnv}
                                                                        className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold rounded-lg bg-slate-700/50 border border-slate-600/30 text-slate-400 hover:bg-slate-700"
                                                                    >
                                                                        <X className="w-3 h-3" /> Cancel
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="divide-y divide-border">
                                                            {Object.entries(editingEnv ? envEdits : (deployDetail.env_config_full || deployDetail.env_config)).map(([key, val]) => {
                                                                const isSensitive = SENSITIVE_KEYS.has(key)
                                                                const isShown = showSensitive[key]
                                                                const displayVal = editingEnv ? val : (isSensitive && !isShown ? '••••••••' : val || '(empty)')
                                                                return (
                                                                    <div key={key} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-800/30 transition-colors">
                                                                        <span className="text-[11px] font-mono font-bold text-slate-400 w-56 shrink-0 truncate" title={key}>{key}</span>
                                                                        {editingEnv ? (
                                                                            <input
                                                                                type={isSensitive && !isShown ? 'password' : 'text'}
                                                                                value={val}
                                                                                onChange={(e) => setEnvEdits(prev => ({ ...prev, [key]: e.target.value }))}
                                                                                className="flex-1 bg-[#0a0c10] border border-border rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-300 focus:outline-none focus:border-primary/50"
                                                                            />
                                                                        ) : (
                                                                            <span className="flex-1 text-xs font-mono text-slate-300 truncate" title={isSensitive && !isShown ? '' : val}>
                                                                                {displayVal}
                                                                            </span>
                                                                        )}
                                                                        {isSensitive && (
                                                                            <button
                                                                                onClick={() => setShowSensitive(prev => ({ ...prev, [key]: !prev[key] }))}
                                                                                className="p-1 text-slate-600 hover:text-slate-400 transition-colors shrink-0"
                                                                                title={isShown ? 'Hide' : 'Show'}
                                                                            >
                                                                                {isShown ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                )
                                                            })}
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    )
                })}

                {/* Remote Jason */}
                {remoteStatus.connected && (
                    <div className="relative p-6 rounded-2xl bg-[#1a1e29] border border-emerald-500/20 hover:border-emerald-500/50 transition-all group overflow-hidden">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 blur-3xl rounded-full -mr-16 -mt-16 group-hover:bg-emerald-500/10 transition-colors" />
                        <div className="flex justify-between items-start mb-6">
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 rounded-2xl flex items-center justify-center border bg-emerald-500/10 border-emerald-500/20 text-emerald-400">
                                    <Globe className="w-6 h-6" />
                                </div>
                                <div>
                                    <h4 className="font-bold text-sm tracking-tight">Jason</h4>
                                    <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Remote OpenClaw Gateway</p>
                                </div>
                            </div>
                            <div className="flex flex-col items-end gap-1">
                                <span className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Remote</span>
                                <div className="px-2 py-1 rounded-full text-[10px] font-bold border uppercase tracking-wide flex items-center gap-1.5 bg-emerald-500/10 border-emerald-500/20 text-emerald-400">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                    connected
                                </div>
                            </div>
                        </div>
                        <div className="space-y-4">
                            <div className="bg-[#0f1117] rounded-xl p-3 border border-border">
                                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Connection</p>
                                <p className="text-xs text-slate-300">{remoteStatus.url}</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Orchestrator sub-agents */}
                {displayAgents.map((agent) => (
                    <div key={agent.id} className="relative p-6 rounded-2xl bg-[#1a1e29] border border-[#2d3748] hover:border-primary/50 transition-all group overflow-hidden">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 blur-3xl rounded-full -mr-16 -mt-16 group-hover:bg-primary/10 transition-colors" />
                        <div className="flex justify-between items-start mb-6">
                            <div className="flex items-center gap-3">
                                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center border ${getStatusStyle(agent.status)}`}>
                                    <Cpu className="w-6 h-6" />
                                </div>
                                <div>
                                    <h4 className="font-bold text-sm tracking-tight">{agent.name}</h4>
                                    <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">{agent.type === 'master' ? 'Master Orchestrator' : agent.model || 'Sub-Agent'}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className={`px-2 py-1 rounded-full text-[10px] font-bold border uppercase tracking-wide flex items-center gap-1.5 ${getStatusStyle(agent.status)}`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${getDotStyle(agent.status)}`} />
                                    {agent.status}
                                </div>
                                {agent.type !== 'master' && (
                                    <button
                                        onClick={async (e) => {
                                            e.stopPropagation()
                                            if (confirm(`Remove agent "${agent.name}"?`)) {
                                                try {
                                                    await deleteAgent(agent.id)
                                                    loadAgents()
                                                } catch (err) {
                                                    console.error('Failed to delete agent', err)
                                                }
                                            }
                                        }}
                                        className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors opacity-0 group-hover:opacity-100"
                                        title="Remove agent"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="space-y-4">
                            <div className="bg-[#0f1117] rounded-xl p-3 border border-border">
                                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Current Task</p>
                                <p className="text-xs text-slate-300 truncate">{agent.current_task || 'Idle'}</p>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-[#0f1117] rounded-xl p-3 border border-border">
                                    <div className="flex items-center gap-2 mb-1">
                                        <Activity className="w-3 h-3 text-primary" />
                                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Load</p>
                                    </div>
                                    <div className="flex items-end gap-1">
                                        <span className="text-lg font-bold font-display leading-none">{agent.load ?? 0}%</span>
                                        <div className="flex-1 h-1 bg-slate-800 rounded-full mb-1 ml-2">
                                            <div
                                                className="h-full bg-primary rounded-full transition-all duration-500"
                                                style={{ width: `${agent.load ?? 0}%` }}
                                            />
                                        </div>
                                    </div>
                                </div>
                                <div className="bg-[#0f1117] rounded-xl p-3 border border-border">
                                    <div className="flex items-center gap-2 mb-1">
                                        <Clock className="w-3 h-3 text-slate-400" />
                                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Type</p>
                                    </div>
                                    <span className="text-lg font-bold font-display leading-none text-slate-300 capitalize">{agent.type}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </motion.div>
    )
}
