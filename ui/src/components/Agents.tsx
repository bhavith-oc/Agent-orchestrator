import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Activity, Cpu, Clock, Loader2, RefreshCw, Rocket, Globe, Trash2 } from 'lucide-react'
import { fetchAgents, fetchDeployList, fetchRemoteStatus, deleteAgent, AgentInfo, DeploymentInfo, RemoteStatus } from '../api'

export default function Agents() {
    const [agents, setAgents] = useState<AgentInfo[]>([])
    const [deployments, setDeployments] = useState<DeploymentInfo[]>([])
    const [remoteStatus, setRemoteStatus] = useState<RemoteStatus>({ connected: false })
    const [loading, setLoading] = useState(true)
    const [showCompleted, setShowCompleted] = useState(false)

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

    useEffect(() => {
        loadAgents()
        loadDeployments()
        checkRemoteStatus()
        const interval = setInterval(loadAgents, 5000)
        const deployInterval = setInterval(loadDeployments, 10000)
        return () => { clearInterval(interval); clearInterval(deployInterval) }
    }, [])

    // Filter: show master (Jason) always, active/busy sub-agents by default
    const activeAgents = agents.filter(a => a.type === 'master' || a.status === 'active' || a.status === 'busy')
    const completedAgents = agents.filter(a => a.type !== 'master' && (a.status === 'completed' || a.status === 'failed' || a.status === 'offline'))
    const displayAgents = showCompleted ? agents : activeAgents

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
                    {completedAgents.length > 0 && (
                        <button
                            onClick={() => setShowCompleted(!showCompleted)}
                            className={`px-4 py-2 text-xs font-bold rounded-xl transition-all border ${showCompleted ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'}`}
                        >
                            {showCompleted ? 'Hide Completed' : 'Show All'}
                        </button>
                    )}
                    <button onClick={() => { loadAgents(); loadDeployments(); checkRemoteStatus() }} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-xl transition-all border border-slate-700">
                        <RefreshCw className="w-3.5 h-3.5 inline mr-1.5" />Refresh
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* Deployed containers */}
                {deployments.filter(d => d.status === 'running').map((d) => (
                    <div key={`deploy-${d.deployment_id}`} className="relative p-6 rounded-2xl bg-[#1a1e29] border border-primary/20 hover:border-primary/50 transition-all group overflow-hidden">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 blur-3xl rounded-full -mr-16 -mt-16 group-hover:bg-primary/10 transition-colors" />
                        <div className="flex justify-between items-start mb-6">
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 rounded-2xl flex items-center justify-center border bg-primary/10 border-primary/20 text-primary">
                                    <Rocket className="w-6 h-6" />
                                </div>
                                <div>
                                    <h4 className="font-bold text-sm tracking-tight">{d.name}</h4>
                                    <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">OpenClaw Container</p>
                                </div>
                            </div>
                            <div className="flex flex-col items-end gap-1">
                                <span className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">Local</span>
                                <div className="px-2 py-1 rounded-full text-[10px] font-bold border uppercase tracking-wide flex items-center gap-1.5 bg-emerald-500/10 border-emerald-500/20 text-emerald-400">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                    running
                                </div>
                            </div>
                        </div>
                        <div className="space-y-4">
                            <div className="bg-[#0f1117] rounded-xl p-3 border border-border">
                                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Connection</p>
                                <p className="text-xs text-slate-300">ws://localhost:{d.port}</p>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-[#0f1117] rounded-xl p-3 border border-border">
                                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Port</p>
                                    <span className="text-lg font-bold font-display leading-none">{d.port}</span>
                                </div>
                                <div className="bg-[#0f1117] rounded-xl p-3 border border-border">
                                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">ID</p>
                                    <span className="text-xs font-mono text-slate-300">{d.deployment_id.slice(0, 10)}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                ))}

                {/* Stopped containers */}
                {(showCompleted ? deployments.filter(d => d.status !== 'running') : []).map((d) => (
                    <div key={`deploy-${d.deployment_id}`} className="relative p-6 rounded-2xl bg-[#1a1e29] border border-[#2d3748] opacity-60 overflow-hidden">
                        <div className="flex justify-between items-start mb-6">
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 rounded-2xl flex items-center justify-center border bg-slate-700/30 border-slate-600/30 text-slate-400">
                                    <Rocket className="w-6 h-6" />
                                </div>
                                <div>
                                    <h4 className="font-bold text-sm tracking-tight">{d.name}</h4>
                                    <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">OpenClaw Container</p>
                                </div>
                            </div>
                            <div className="flex flex-col items-end gap-1">
                                <span className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-700/30 text-slate-500 border border-slate-600/30">Local</span>
                                <div className="px-2 py-1 rounded-full text-[10px] font-bold border uppercase tracking-wide flex items-center gap-1.5 bg-red-500/10 border-red-500/20 text-red-400">
                                    <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                                    {d.status}
                                </div>
                            </div>
                        </div>
                    </div>
                ))}

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
