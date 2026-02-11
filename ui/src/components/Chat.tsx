import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Send, Bot, User, Paperclip, Sparkles, Loader2, Globe, Rocket, Wifi, WifiOff, AlertTriangle, ChevronDown, Unplug } from 'lucide-react'
import {
    fetchAgents,
    fetchRemoteStatus, fetchRemoteHistory, sendRemoteMessage,
    fetchDeployList, connectDeployChat, disconnectDeployChat,
    fetchDeployChatStatus, fetchDeployChatHistory, sendDeployChatMessage,
    Message, AgentInfo, RemoteStatus, DeploymentInfo, DeployChatStatus
} from '../api'

type ChatMode = 'deployed' | 'remote'

export default function Chat() {
    const [messages, setMessages] = useState<Message[]>([])
    const [agents, setAgents] = useState<AgentInfo[]>([])
    const [input, setInput] = useState('')
    const [loading, setLoading] = useState(true)
    const [sending, setSending] = useState(false)
    const [mode, setMode] = useState<ChatMode>('deployed')
    const [remoteStatus, setRemoteStatus] = useState<RemoteStatus>({ connected: false })
    const [deployments, setDeployments] = useState<DeploymentInfo[]>([])
    const [deployChatStatus, setDeployChatStatus] = useState<DeployChatStatus>({ connected: false })
    const [selectedDeployment, setSelectedDeployment] = useState<string>('')
    const [connecting, setConnecting] = useState(false)
    const messagesEndRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        loadAgents()
        checkRemoteStatus()
        loadDeployments()
        checkDeployChatStatus()
        const agentInterval = setInterval(loadAgents, 5000)
        const remoteInterval = setInterval(checkRemoteStatus, 10000)
        const deployInterval = setInterval(loadDeployments, 10000)
        return () => { clearInterval(agentInterval); clearInterval(remoteInterval); clearInterval(deployInterval) }
    }, [])

    // Auto-switch to remote if no deployments are running and remote is connected
    useEffect(() => {
        const runningDeploys = deployments.filter(d => d.status === 'running')
        if (runningDeploys.length === 0 && remoteStatus.connected && mode === 'deployed') {
            setMode('remote')
        }
    }, [deployments, remoteStatus])

    // Auto-select first running deployment, or auto-connect from onboarding
    useEffect(() => {
        const running = deployments.filter(d => d.status === 'running')

        // Check if we were redirected from onboarding with a pending deployment
        const pendingDeploy = localStorage.getItem('aether_pending_deploy')
        if (pendingDeploy && running.some(d => d.deployment_id === pendingDeploy)) {
            localStorage.removeItem('aether_pending_deploy')
            setSelectedDeployment(pendingDeploy)
            setMode('deployed')
            // Auto-connect after a short delay to let state settle
            setTimeout(async () => {
                try {
                    setConnecting(true)
                    const result = await connectDeployChat(pendingDeploy)
                    setDeployChatStatus({
                        connected: true,
                        deployment_id: result.deployment_id,
                        session_name: result.session_name,
                        port: result.port,
                    })
                    setMessages([])
                    setLoading(true)
                    await loadHistory()
                } catch (err) {
                    console.error('Auto-connect failed:', err)
                } finally {
                    setConnecting(false)
                }
            }, 500)
            return
        }

        if (running.length > 0 && !selectedDeployment) {
            setSelectedDeployment(running[0].deployment_id)
        }
    }, [deployments])

    useEffect(() => {
        setLoading(true)
        setMessages([])
        loadHistory()
    }, [mode, deployChatStatus.connected])

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

    const checkRemoteStatus = async () => {
        try {
            const status = await fetchRemoteStatus()
            setRemoteStatus(status)
        } catch {
            setRemoteStatus({ connected: false })
        }
    }

    const loadDeployments = async () => {
        try {
            const list = await fetchDeployList()
            setDeployments(list)
        } catch {
            setDeployments([])
        }
    }

    const checkDeployChatStatus = async () => {
        try {
            const status = await fetchDeployChatStatus()
            setDeployChatStatus(status)
            if (status.connected && status.deployment_id) {
                setSelectedDeployment(status.deployment_id)
            }
        } catch {
            setDeployChatStatus({ connected: false })
        }
    }

    const handleConnectDeployment = async () => {
        if (!selectedDeployment || connecting) return
        setConnecting(true)
        try {
            const result = await connectDeployChat(selectedDeployment)
            setDeployChatStatus({
                connected: true,
                deployment_id: result.deployment_id,
                session_name: result.session_name,
                port: result.port,
            })
            setMessages([])
            setLoading(true)
            loadHistory()
        } catch (error: any) {
            const detail = error?.response?.data?.detail || error.message || 'Connection failed'
            setMessages([{ role: 'agent', name: 'System', content: `Failed to connect: ${detail}` }])
        } finally {
            setConnecting(false)
        }
    }

    const handleDisconnectDeployment = async () => {
        await disconnectDeployChat()
        setDeployChatStatus({ connected: false })
        setMessages([])
    }

    const loadHistory = async () => {
        try {
            if (mode === 'remote') {
                const history = await fetchRemoteHistory()
                setMessages(history)
            } else if (mode === 'deployed' && deployChatStatus.connected) {
                const history = await fetchDeployChatHistory()
                setMessages(history)
            }
        } catch (error) {
            console.error("Failed to load chat history", error)
        } finally {
            setLoading(false)
        }
    }

    const loadAgents = async () => {
        try {
            const data = await fetchAgents()
            setAgents(data)
        } catch (error) {
            console.error("Failed to load agents", error)
        }
    }

    const handleSend = async () => {
        if (!input.trim() || sending) return

        const userContent = input
        const newMessage: Message = { role: 'user', content: userContent }
        setMessages(prev => [...prev, newMessage])
        setInput('')
        setSending(true)

        try {
            if (mode === 'remote') {
                const response = await sendRemoteMessage(userContent)
                setMessages(prev => [...prev, response])
            } else if (mode === 'deployed') {
                const response = await sendDeployChatMessage(userContent)
                setMessages(prev => [...prev, response])
            }
        } catch (error: any) {
            console.error("Failed to send message", error)
            const detail = error?.response?.data?.detail || error.message || 'Unknown error'
            const errorMsg = mode === 'remote'
                ? `Failed to reach remote Jason: ${detail}`
                : `Failed to reach deployed agent: ${detail}`
            setMessages(prev => [...prev, {
                role: 'agent',
                name: 'System',
                content: errorMsg
            }])
        } finally {
            setSending(false)
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSend()
        }
    }

    const getAgentDotColor = (status: string) => {
        switch (status) {
            case 'active': return 'bg-emerald-500 animate-pulse'
            case 'busy': return 'bg-amber-500 animate-pulse'
            case 'completed': return 'bg-blue-500'
            case 'failed':
            case 'offline': return 'bg-red-500'
            default: return 'bg-slate-500'
        }
    }

    const runningDeployments = deployments.filter(d => d.status === 'running')
    const agentLabel = mode === 'remote' ? 'Remote Jason' : (deployChatStatus.session_name || 'Deployed Jason')
    const hasJasonMention = mode === 'remote' && /\b@jason\b/i.test(input)
    const canSend = mode === 'remote' ? remoteStatus.connected : deployChatStatus.connected

    if (loading) {
        return <div className="h-full flex items-center justify-center"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>
    }

    return (
        <div className="flex h-full gap-6">
            {/* Left Sidebar */}
            <div className="w-80 flex flex-col gap-4 shrink-0">
                {/* Mode Toggle */}
                <div className="p-3 rounded-2xl bg-[#1a1e29] border border-border">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3 px-1">Orchestrator</p>
                    <div className="flex gap-2">
                        <button
                            onClick={() => runningDeployments.length > 0 && setMode('deployed')}
                            disabled={runningDeployments.length === 0}
                            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold transition-all ${mode === 'deployed'
                                ? 'bg-primary/20 text-primary border border-primary/30'
                                : runningDeployments.length > 0
                                    ? 'bg-slate-800/50 text-slate-400 border border-transparent hover:border-slate-700'
                                    : 'bg-slate-800/30 text-slate-600 border border-transparent cursor-not-allowed'
                            }`}
                            title={runningDeployments.length === 0 ? 'Deploy an agent first via Deploy Agent page' : ''}
                        >
                            <Rocket className="w-3.5 h-3.5" />
                            Deployed
                            {runningDeployments.length > 0 && <span className="text-[8px] ml-0.5">({runningDeployments.length})</span>}
                        </button>
                        <button
                            onClick={() => remoteStatus.connected && setMode('remote')}
                            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold transition-all ${mode === 'remote'
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                : remoteStatus.connected
                                    ? 'bg-slate-800/50 text-slate-400 border border-transparent hover:border-slate-700'
                                    : 'bg-slate-800/30 text-slate-600 border border-transparent cursor-not-allowed'
                            }`}
                            disabled={!remoteStatus.connected}
                        >
                            <Globe className="w-3.5 h-3.5" />
                            Remote
                        </button>
                    </div>

                    {/* Deployed mode — deployment selector */}
                    {mode === 'deployed' && (
                        <div className="mt-3 space-y-2">
                            <div className="relative">
                                <select
                                    value={selectedDeployment}
                                    onChange={(e) => setSelectedDeployment(e.target.value)}
                                    className="w-full bg-slate-900/50 border border-border rounded-xl py-2 px-3 pr-8 text-xs text-slate-300 appearance-none focus:outline-none focus:border-primary/50"
                                >
                                    <option value="">Select deployment...</option>
                                    {runningDeployments.map(d => (
                                        <option key={d.deployment_id} value={d.deployment_id}>
                                            {d.name} — port {d.port}
                                        </option>
                                    ))}
                                </select>
                                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
                            </div>
                            {deployChatStatus.connected && deployChatStatus.deployment_id === selectedDeployment ? (
                                <div className="flex items-center gap-2">
                                    <div className="flex-1 flex items-center gap-2 px-2">
                                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                        <span className="text-[10px] text-emerald-400 font-bold truncate">{deployChatStatus.session_name}</span>
                                    </div>
                                    <button
                                        onClick={handleDisconnectDeployment}
                                        className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                                        title="Disconnect"
                                    >
                                        <Unplug className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            ) : (
                                <button
                                    onClick={handleConnectDeployment}
                                    disabled={!selectedDeployment || connecting}
                                    className="w-full py-2 px-3 rounded-xl text-xs font-bold bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    {connecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wifi className="w-3.5 h-3.5" />}
                                    {connecting ? 'Connecting...' : 'Connect'}
                                </button>
                            )}
                        </div>
                    )}

                    {/* Remote status indicator */}
                    {mode === 'remote' && (
                        <div className="flex items-center gap-2 mt-3 px-1">
                            {remoteStatus.connected ? (
                                <>
                                    <Wifi className="w-3 h-3 text-emerald-500" />
                                    <span className="text-[10px] text-emerald-500 font-medium">OpenClaw connected</span>
                                </>
                            ) : (
                                <>
                                    <WifiOff className="w-3 h-3 text-slate-600" />
                                    <span className="text-[10px] text-slate-600 font-medium">Remote not configured</span>
                                </>
                            )}
                        </div>
                    )}
                </div>

                {/* Neural Links — deployed containers + agents */}
                <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest px-2">Neural Links</h3>
                <div className="flex flex-col gap-2">
                    {/* Deployed containers */}
                    {runningDeployments.map((d) => (
                        <button
                            key={`deploy-${d.deployment_id}`}
                            onClick={() => { setMode('deployed'); setSelectedDeployment(d.deployment_id) }}
                            className={`p-4 rounded-2xl border text-left transition-all ${deployChatStatus.connected && deployChatStatus.deployment_id === d.deployment_id
                                ? 'bg-primary/10 border-primary/20 ring-1 ring-primary/10'
                                : 'bg-card/50 border-border hover:border-slate-700'
                            }`}
                        >
                            <div className="flex items-center gap-3 mb-1">
                                <div className={`w-2 h-2 rounded-full ${deployChatStatus.connected && deployChatStatus.deployment_id === d.deployment_id ? 'bg-emerald-500 animate-pulse' : 'bg-blue-500'}`} />
                                <span className="font-bold text-sm tracking-tight">{d.name}</span>
                                <span className="ml-auto text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">Local</span>
                            </div>
                            <p className="text-[10px] text-slate-500 font-medium">
                                {deployChatStatus.connected && deployChatStatus.deployment_id === d.deployment_id
                                    ? `Connected · ${deployChatStatus.session_name}`
                                    : `Port ${d.port} · Running`}
                            </p>
                        </button>
                    ))}

                    {/* Remote Jason */}
                    {remoteStatus.connected && (
                        <button
                            onClick={() => setMode('remote')}
                            className={`p-4 rounded-2xl border text-left transition-all ${mode === 'remote'
                                ? 'bg-emerald-500/10 border-emerald-500/20 ring-1 ring-emerald-500/10'
                                : 'bg-card/50 border-border hover:border-slate-700'
                            }`}
                        >
                            <div className="flex items-center gap-3 mb-1">
                                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                <span className="font-bold text-sm tracking-tight">Jason</span>
                                <span className="ml-auto text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Remote</span>
                            </div>
                            <p className="text-[10px] text-slate-500 font-medium">{remoteStatus.url || 'OpenClaw Gateway'}</p>
                        </button>
                    )}

                    {/* Local orchestrator agents */}
                    {agents
                        .filter(a => a.type === 'master' || a.status === 'active' || a.status === 'busy')
                        .map((agent) => (
                        <button key={agent.id} className={`p-4 rounded-2xl border text-left transition-all ${agent.type === 'master' ? 'bg-primary/10 border-primary/20 ring-1 ring-primary/10' : 'bg-card/50 border-border hover:border-slate-700'
                            }`}>
                            <div className="flex items-center gap-3 mb-1">
                                <div className={`w-2 h-2 rounded-full ${getAgentDotColor(agent.status)}`} />
                                <span className="font-bold text-sm tracking-tight">{agent.name}</span>
                            </div>
                            <p className="text-[10px] text-slate-500 font-medium">{agent.current_task || agent.status}</p>
                        </button>
                    ))}

                    {runningDeployments.length === 0 && !remoteStatus.connected && agents.filter(a => a.type === 'master' || a.status === 'active' || a.status === 'busy').length === 0 && (
                        <p className="text-xs text-slate-600 px-2">No agents online.</p>
                    )}
                </div>
            </div>

            {/* Main Chat Area */}
            <div className="flex-1 flex flex-col bg-[#1a1e29] border border-border rounded-3xl overflow-hidden relative">
                <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent ${mode === 'remote' ? 'via-emerald-500/50' : 'via-primary/50'} to-transparent opacity-50`} />

                {/* Mode indicator bar — Deployed */}
                {mode === 'deployed' && deployChatStatus.connected && (
                    <div className="px-6 py-2 bg-primary/5 border-b border-primary/10 flex items-center gap-2">
                        <Rocket className="w-3.5 h-3.5 text-primary" />
                        <span className="text-[11px] font-bold text-primary">{deployChatStatus.session_name}</span>
                        <span className="text-[10px] text-slate-500 ml-1">via deployment {deployChatStatus.deployment_id?.slice(0, 8)} on port {deployChatStatus.port}</span>
                    </div>
                )}

                {/* Mode indicator bar — Remote */}
                {mode === 'remote' && remoteStatus.connected && (
                    <div className="px-6 py-2 bg-emerald-500/5 border-b border-emerald-500/10 flex items-center gap-2">
                        <Globe className="w-3.5 h-3.5 text-emerald-500" />
                        <span className="text-[11px] font-bold text-emerald-400">Remote Jason</span>
                        <span className="text-[10px] text-slate-500 ml-1">via OpenClaw at {remoteStatus.url}</span>
                    </div>
                )}

                {/* Deployed mode — not connected warning */}
                {mode === 'deployed' && !deployChatStatus.connected && (
                    <div className="px-6 py-3 bg-amber-500/5 border-b border-amber-500/10 flex items-center gap-3">
                        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                        <div className="flex-1">
                            <span className="text-[11px] font-bold text-amber-400">Not connected to a deployment</span>
                            <p className="text-[10px] text-slate-500 mt-0.5">
                                Select a running deployment from the sidebar and click Connect to start chatting.
                            </p>
                        </div>
                    </div>
                )}

                {/* Remote mode not connected warning */}
                {mode === 'remote' && !remoteStatus.connected && (
                    <div className="px-6 py-3 bg-red-500/5 border-b border-red-500/10 flex items-center gap-3">
                        <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                        <div className="flex-1">
                            <span className="text-[11px] font-bold text-red-400">Remote Jason not connected</span>
                            <p className="text-[10px] text-slate-500 mt-0.5">Connect via Settings → Remote OpenClaw Configuration first.</p>
                        </div>
                    </div>
                )}

                {/* Messages Stream */}
                <div className="flex-1 overflow-y-auto p-8 space-y-6">
                    {messages.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-4">
                            <Bot className="w-12 h-12 text-primary/30" />
                            <p className="text-sm text-center max-w-md">
                                {mode === 'remote'
                                    ? 'This is the team chat. Tag @jason to assign a task — he\'ll create a plan, delegate to sub-agents, and track it in Mission Control.'
                                    : deployChatStatus.connected
                                        ? `Connected to deployment. Send a message to start chatting with Jason.`
                                        : 'Select a running deployment from the sidebar and click Connect to start chatting.'}
                            </p>
                            {mode === 'remote' && (
                                <code className="text-[11px] text-emerald-400/60 bg-emerald-500/5 border border-emerald-500/10 px-3 py-1.5 rounded-lg">
                                    @jason build a login page with email and password
                                </code>
                            )}
                            {mode === 'deployed' && deployChatStatus.connected && deployChatStatus.session_name && (
                                <span className="text-[10px] text-primary/60">
                                    Session: {deployChatStatus.session_name} · Port: {deployChatStatus.port}
                                </span>
                            )}
                        </div>
                    )}
                    {messages.map((msg, i) => (
                        <motion.div
                            key={i}
                            initial={{ opacity: 0, x: msg.role === 'user' ? 20 : -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
                        >
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-slate-700' : msg.name === 'System' ? 'bg-slate-600' : mode === 'remote' ? 'bg-emerald-600' : 'bg-primary'
                                }`}>
                                {msg.role === 'user' ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5 text-white" />}
                            </div>
                            <div className={`flex flex-col gap-2 max-w-[80%] ${msg.role === 'user' ? 'items-end' : ''}`}>
                                {msg.role !== 'user' && <span className={`text-[10px] font-bold uppercase tracking-widest px-1 ${msg.name === 'System' ? 'text-slate-400' : mode === 'remote' ? 'text-emerald-400' : 'text-primary'}`}>{msg.name || agentLabel}</span>}
                                <div className={`p-4 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${msg.role === 'user' ? 'bg-slate-800 text-slate-100 rounded-tr-none' : 'bg-card text-slate-300 rounded-tl-none border border-border'
                                    }`}>
                                    {msg.content}
                                </div>
                                {msg.files?.map((f) => (
                                    <div key={f.name} className="flex items-center gap-3 p-3 bg-slate-800/50 border border-slate-700 rounded-xl w-64 hover:bg-slate-800 transition-colors cursor-pointer group">
                                        <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                                            <Sparkles className="w-5 h-5 text-primary" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-bold truncate">{f.name}</p>
                                            <p className="text-[10px] text-slate-500">{f.size}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </motion.div>
                    ))}
                    {sending && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="flex gap-4"
                        >
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${mode === 'remote' ? 'bg-emerald-600' : 'bg-primary'}`}>
                                <Bot className="w-5 h-5 text-white" />
                            </div>
                            <div className="flex flex-col gap-2">
                                <span className={`text-[10px] font-bold uppercase tracking-widest px-1 ${mode === 'remote' ? 'text-emerald-400' : 'text-primary'}`}>{agentLabel}</span>
                                <div className="p-4 rounded-2xl rounded-tl-none bg-card border border-border flex items-center gap-2">
                                    <Loader2 className="w-4 h-4 text-primary animate-spin" />
                                    <span className="text-sm text-slate-400">Processing...</span>
                                </div>
                            </div>
                        </motion.div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {/* Input Area */}
                <div className="p-6 border-t border-border bg-background/50">
                    <div className="relative flex items-center">
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={!canSend ? 'Connect to a deployment or remote first...' : mode === 'remote' ? 'Type @jason to assign a task, or chat with the team...' : 'Send a message to your deployed agent...'}
                            disabled={sending || !canSend}
                            className={`w-full bg-slate-900/50 border rounded-2xl py-4 pl-12 pr-12 text-sm focus:outline-none transition-all placeholder:text-slate-600 disabled:opacity-50 ${hasJasonMention ? 'border-emerald-500/50 ring-1 ring-emerald-500/20' : 'border-border focus:border-primary/50'}`}
                        />
                        <Paperclip className="absolute left-4 w-5 h-5 text-slate-500 hover:text-slate-100 cursor-pointer transition-colors" />
                        <button
                            onClick={handleSend}
                            disabled={!input.trim() || sending}
                            className="absolute right-3 p-2 bg-primary rounded-xl text-white hover:bg-primary/80 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        </button>
                    </div>
                    <p className="mt-4 text-[10px] text-center text-slate-600 font-medium">
                        {mode === 'remote'
                            ? hasJasonMention
                                ? '🎯 @jason detected — this message will be sent as a task. Jason will plan, delegate, and track it.'
                                : '💬 Team chat — messages without @jason are not forwarded to Jason.'
                            : deployChatStatus.connected
                                ? `💬 Chatting with deployed agent (${deployChatStatus.session_name}). Responses may take a moment.`
                                : 'Select and connect to a deployment to start chatting.'}
                    </p>
                </div>
            </div>
        </div>
    )
}
