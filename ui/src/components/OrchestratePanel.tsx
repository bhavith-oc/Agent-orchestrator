import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
    Loader2, Send, CheckCircle2, XCircle, Clock, Cpu, ChevronDown, ChevronRight,
    Zap, GitBranch, FileCode, ArrowRight, RefreshCw
} from 'lucide-react'
import {
    submitOrchestratorTask, fetchOrchestratorTask, fetchOrchestratorTasks,
    fetchAgentTemplates, fetchDeployList,
    OrchestratorTask, OrchestratorSubtask, AgentTemplate, DeploymentInfo
} from '../api'

const STATUS_STYLES: Record<string, { bg: string; text: string; icon: typeof Clock }> = {
    pending: { bg: 'bg-slate-500/10 border-slate-500/20', text: 'text-slate-400', icon: Clock },
    planning: { bg: 'bg-amber-500/10 border-amber-500/20', text: 'text-amber-400', icon: Zap },
    creating_agent: { bg: 'bg-blue-500/10 border-blue-500/20', text: 'text-blue-400', icon: Cpu },
    executing: { bg: 'bg-primary/10 border-primary/20', text: 'text-primary', icon: Loader2 },
    synthesizing: { bg: 'bg-purple-500/10 border-purple-500/20', text: 'text-purple-400', icon: GitBranch },
    completed: { bg: 'bg-emerald-500/10 border-emerald-500/20', text: 'text-emerald-400', icon: CheckCircle2 },
    failed: { bg: 'bg-red-500/10 border-red-500/20', text: 'text-red-400', icon: XCircle },
}

function StatusBadge({ status }: { status: string }) {
    const style = STATUS_STYLES[status] || STATUS_STYLES.pending
    const Icon = style.icon
    const isAnimated = status === 'executing' || status === 'planning' || status === 'synthesizing'
    return (
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${style.bg} ${style.text}`}>
            <Icon className={`w-3 h-3 ${isAnimated ? 'animate-spin' : ''}`} />
            {status}
        </span>
    )
}

function SubtaskCard({ subtask, expanded, onToggle }: { subtask: OrchestratorSubtask; expanded: boolean; onToggle: () => void }) {
    return (
        <div className="border border-border rounded-xl overflow-hidden bg-[#0f1117]">
            <button
                onClick={onToggle}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-800/30 transition-colors"
            >
                {expanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{subtask.agent_type}</span>
                        <StatusBadge status={subtask.status} />
                    </div>
                    <p className="text-xs text-slate-300 truncate">{subtask.description}</p>
                </div>
            </button>
            <AnimatePresence>
                {expanded && subtask.result && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                    >
                        <div className="px-4 pb-3 border-t border-border">
                            <pre className="text-[11px] text-slate-400 whitespace-pre-wrap mt-2 max-h-60 overflow-y-auto font-mono leading-relaxed">
                                {subtask.result}
                            </pre>
                        </div>
                    </motion.div>
                )}
                {expanded && subtask.error && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                    >
                        <div className="px-4 pb-3 border-t border-red-500/10">
                            <p className="text-[11px] text-red-400 mt-2 font-mono">{subtask.error}</p>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}

function TaskDetail({ task, onBack }: { task: OrchestratorTask; onBack: () => void }) {
    const [expandedSubtask, setExpandedSubtask] = useState<string | null>(null)
    const [liveTask, setLiveTask] = useState(task)
    const logsEndRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        setLiveTask(task)
    }, [task])

    // Poll for updates if task is still running
    useEffect(() => {
        if (['completed', 'failed'].includes(liveTask.status)) return
        const interval = setInterval(async () => {
            try {
                const updated = await fetchOrchestratorTask(liveTask.id)
                setLiveTask(updated)
            } catch { /* ignore */ }
        }, 2000)
        return () => clearInterval(interval)
    }, [liveTask.id, liveTask.status])

    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [liveTask.logs])

    const completedCount = liveTask.subtasks.filter(s => s.status === 'completed').length
    const totalCount = liveTask.subtasks.length

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="px-6 py-4 border-b border-border bg-[#0f1117]/50 shrink-0">
                <div className="flex items-center gap-3 mb-2">
                    <button onClick={onBack} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
                        &larr; All Tasks
                    </button>
                    <StatusBadge status={liveTask.status} />
                </div>
                <p className="text-sm font-bold text-slate-200 line-clamp-2">{liveTask.description}</p>
                {totalCount > 0 && (
                    <div className="mt-3">
                        <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Progress</span>
                            <span className="text-[10px] font-bold text-slate-400">{completedCount}/{totalCount}</span>
                        </div>
                        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                            <motion.div
                                className="h-full bg-primary rounded-full"
                                initial={{ width: 0 }}
                                animate={{ width: totalCount > 0 ? `${(completedCount / totalCount) * 100}%` : '0%' }}
                                transition={{ duration: 0.5 }}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Content — scrollable */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {/* Subtasks */}
                {liveTask.subtasks.length > 0 && (
                    <div>
                        <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Subtasks</h4>
                        <div className="space-y-2">
                            {liveTask.subtasks.map(st => (
                                <SubtaskCard
                                    key={st.id}
                                    subtask={st}
                                    expanded={expandedSubtask === st.id}
                                    onToggle={() => setExpandedSubtask(expandedSubtask === st.id ? null : st.id)}
                                />
                            ))}
                        </div>
                    </div>
                )}

                {/* Final Result */}
                {liveTask.final_result && (
                    <div>
                        <h4 className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest mb-3">Final Result</h4>
                        <div className="bg-[#0f1117] border border-emerald-500/20 rounded-xl p-4">
                            <pre className="text-[12px] text-slate-300 whitespace-pre-wrap font-mono leading-relaxed max-h-96 overflow-y-auto">
                                {liveTask.final_result}
                            </pre>
                        </div>
                    </div>
                )}

                {/* Error */}
                {liveTask.error && (
                    <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4">
                        <p className="text-xs text-red-400 font-mono">{liveTask.error}</p>
                    </div>
                )}

                {/* Logs */}
                {liveTask.logs.length > 0 && (
                    <div>
                        <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Logs</h4>
                        <div className="bg-[#0a0c10] border border-border rounded-xl p-3 max-h-48 overflow-y-auto">
                            {liveTask.logs.map((log, i) => (
                                <p key={i} className="text-[10px] font-mono text-slate-500 leading-relaxed">{log}</p>
                            ))}
                            <div ref={logsEndRef} />
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

export default function OrchestratePanel() {
    const [tasks, setTasks] = useState<OrchestratorTask[]>([])
    const [templates, setTemplates] = useState<AgentTemplate[]>([])
    const [deployments, setDeployments] = useState<DeploymentInfo[]>([])
    const [selectedTask, setSelectedTask] = useState<OrchestratorTask | null>(null)
    const [input, setInput] = useState('')
    const [selectedDeployment, setSelectedDeployment] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        loadData()
    }, [])

    // Poll tasks for status updates
    useEffect(() => {
        const hasRunning = tasks.some(t => !['completed', 'failed'].includes(t.status))
        if (!hasRunning) return
        const interval = setInterval(loadTasks, 3000)
        return () => clearInterval(interval)
    }, [tasks])

    const loadData = async () => {
        try {
            const [taskList, templateList, deployList] = await Promise.all([
                fetchOrchestratorTasks(),
                fetchAgentTemplates(),
                fetchDeployList(),
            ])
            setTasks(taskList)
            setTemplates(templateList)
            setDeployments(deployList)
            const running = deployList.filter(d => d.status === 'running')
            if (running.length > 0 && !selectedDeployment) {
                setSelectedDeployment(running[0].deployment_id)
            }
        } catch (err) {
            console.error('Failed to load orchestration data', err)
        } finally {
            setLoading(false)
        }
    }

    const loadTasks = async () => {
        try {
            const taskList = await fetchOrchestratorTasks()
            setTasks(taskList)
            // Update selected task if viewing one
            if (selectedTask) {
                const updated = taskList.find(t => t.id === selectedTask.id)
                if (updated) setSelectedTask(updated)
            }
        } catch { /* ignore */ }
    }

    const handleSubmit = async () => {
        if (!input.trim() || !selectedDeployment || submitting) return
        setSubmitting(true)
        try {
            const task = await submitOrchestratorTask(input.trim(), selectedDeployment)
            setTasks(prev => [task, ...prev])
            setSelectedTask(task)
            setInput('')
        } catch (err: any) {
            console.error('Failed to submit task', err)
        } finally {
            setSubmitting(false)
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSubmit()
        }
    }

    const runningDeployments = deployments.filter(d => d.status === 'running')

    if (loading) {
        return <div className="h-full flex items-center justify-center"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>
    }

    // Task detail view
    if (selectedTask) {
        return (
            <div className="flex h-full gap-6">
                <div className="flex-1 flex flex-col bg-[#1a1e29] border border-border rounded-3xl overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-purple-500/50 to-transparent opacity-50" />
                    <TaskDetail task={selectedTask} onBack={() => setSelectedTask(null)} />
                </div>
            </div>
        )
    }

    // Main view — task list + submit form
    return (
        <div className="flex h-full gap-6">
            {/* Left — Agent Templates */}
            <div className="w-80 flex flex-col gap-4 shrink-0">
                <div className="p-3 rounded-2xl bg-[#1a1e29] border border-border">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3 px-1">Expert Agents</p>
                    <p className="text-[10px] text-slate-600 px-1 mb-3">Jason will automatically select the right experts for your task.</p>
                    <div className="space-y-1.5">
                        {templates.map(t => (
                            <div key={t.type} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-[#0f1117] border border-border">
                                <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                                    <Cpu className="w-4 h-4 text-primary" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[11px] font-bold text-slate-300 truncate">{t.name}</p>
                                    <p className="text-[9px] text-slate-600 truncate">{t.tags.slice(0, 4).join(' · ')}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Recent Tasks */}
                {tasks.length > 0 && (
                    <div className="flex-1 overflow-y-auto">
                        <div className="flex items-center justify-between px-2 mb-2">
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Recent Tasks</p>
                            <button onClick={loadTasks} className="p-1 hover:bg-slate-800 rounded-lg transition-colors">
                                <RefreshCw className="w-3 h-3 text-slate-600" />
                            </button>
                        </div>
                        <div className="space-y-2">
                            {tasks.map(t => (
                                <button
                                    key={t.id}
                                    onClick={() => setSelectedTask(t)}
                                    className="w-full p-3 rounded-xl bg-[#1a1e29] border border-border hover:border-primary/30 text-left transition-all"
                                >
                                    <div className="flex items-center gap-2 mb-1">
                                        <StatusBadge status={t.status} />
                                        <span className="text-[9px] text-slate-600 ml-auto">{t.subtasks.length} subtasks</span>
                                    </div>
                                    <p className="text-[11px] text-slate-300 line-clamp-2">{t.description}</p>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Main — Submit Task */}
            <div className="flex-1 flex flex-col bg-[#1a1e29] border border-border rounded-3xl overflow-hidden relative">
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-purple-500/50 to-transparent opacity-50" />

                {/* Hero */}
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                    <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-6">
                        <Zap className="w-8 h-8 text-primary" />
                    </div>
                    <h3 className="text-xl font-bold mb-2">Orchestrate a Coding Task</h3>
                    <p className="text-sm text-slate-500 max-w-md mb-6">
                        Describe a complex coding task. Jason will decompose it into subtasks, delegate to domain-specific expert agents, and synthesize the results.
                    </p>

                    {/* How it works */}
                    <div className="flex items-center gap-3 text-[10px] text-slate-600 mb-8">
                        <span className="px-2 py-1 rounded-lg bg-amber-500/10 text-amber-400 font-bold">Plan</span>
                        <ArrowRight className="w-3 h-3" />
                        <span className="px-2 py-1 rounded-lg bg-primary/10 text-primary font-bold">Execute</span>
                        <ArrowRight className="w-3 h-3" />
                        <span className="px-2 py-1 rounded-lg bg-purple-500/10 text-purple-400 font-bold">Synthesize</span>
                        <ArrowRight className="w-3 h-3" />
                        <span className="px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 font-bold">Result</span>
                    </div>

                    {/* Deployment selector */}
                    {runningDeployments.length === 0 ? (
                        <div className="px-4 py-3 rounded-xl bg-amber-500/5 border border-amber-500/20 text-xs text-amber-400 max-w-md">
                            No running deployments. Deploy an agent first via the Deploy Agent page.
                        </div>
                    ) : (
                        <div className="w-full max-w-md">
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-2 text-left">Master Container</label>
                            <div className="relative mb-4">
                                <select
                                    value={selectedDeployment}
                                    onChange={(e) => setSelectedDeployment(e.target.value)}
                                    className="w-full bg-[#0f1117] border border-border rounded-xl py-2.5 px-3 pr-8 text-xs text-slate-300 appearance-none focus:outline-none focus:border-primary/50"
                                >
                                    {runningDeployments.map(d => (
                                        <option key={d.deployment_id} value={d.deployment_id}>
                                            {d.name} — port {d.port}
                                        </option>
                                    ))}
                                </select>
                                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
                            </div>
                        </div>
                    )}
                </div>

                {/* Input Area */}
                <div className="p-6 border-t border-border bg-background/50">
                    <div className="relative flex items-center">
                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Describe a coding task... e.g. 'Build a REST API for user management with CRUD endpoints, database models, and unit tests'"
                            disabled={submitting || runningDeployments.length === 0}
                            rows={2}
                            className="w-full bg-slate-900/50 border border-border rounded-2xl py-4 pl-5 pr-14 text-sm focus:outline-none focus:border-primary/50 transition-all placeholder:text-slate-600 disabled:opacity-50 resize-none"
                        />
                        <button
                            onClick={handleSubmit}
                            disabled={!input.trim() || submitting || runningDeployments.length === 0}
                            className="absolute right-3 bottom-3 p-2.5 bg-primary rounded-xl text-white hover:bg-primary/80 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        </button>
                    </div>
                    <p className="mt-3 text-[10px] text-center text-slate-600 font-medium">
                        Jason will analyze your task, create a plan, and delegate to expert agents (Python, React, Database, DevOps, etc.)
                    </p>
                </div>
            </div>
        </div>
    )
}
