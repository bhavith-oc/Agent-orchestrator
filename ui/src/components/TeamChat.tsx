import { useState, useEffect, useRef } from 'react'
import { MessageSquare, Send, Users, Bot, User, Cpu, RefreshCw } from 'lucide-react'
import {
    fetchTeamChatSessions,
    fetchTeamChatMessages,
    sendTeamChatMessage,
    fetchMissions,
    type TeamChatMessage,
    type TeamChatSession,
    type Mission,
} from '../api'

const SENDER_COLORS: Record<string, string> = {
    Jason: 'text-blue-400',
    Telegram: 'text-purple-400',
    User: 'text-emerald-400',
    System: 'text-slate-400',
}

function getSenderColor(name: string | null): string {
    if (!name) return 'text-slate-400'
    if (SENDER_COLORS[name]) return SENDER_COLORS[name]
    // Sub-agents get green shades
    if (name.includes('subtask') || name.includes('expert') || name.includes('-')) return 'text-green-400'
    return 'text-cyan-400'
}

function getSenderIcon(name: string | null, role: string) {
    if (role === 'system') return <Cpu className="w-4 h-4 text-slate-500" />
    if (role === 'user') return <User className="w-4 h-4 text-emerald-400" />
    if (name === 'Jason') return <Bot className="w-4 h-4 text-blue-400" />
    return <Bot className="w-4 h-4 text-green-400" />
}

function formatTime(iso: string): string {
    const d = new Date(iso)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function TeamChat() {
    const [sessions, setSessions] = useState<TeamChatSession[]>([])
    const [missions, setMissions] = useState<Mission[]>([])
    const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null)
    const [messages, setMessages] = useState<TeamChatMessage[]>([])
    const [input, setInput] = useState('')
    const [loading, setLoading] = useState(false)
    const [sending, setSending] = useState(false)
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

    // Load sessions and missions on mount
    useEffect(() => {
        loadSessions()
        loadMissions()
    }, [])

    // Poll messages for selected mission
    useEffect(() => {
        if (pollRef.current) clearInterval(pollRef.current)
        if (selectedMissionId) {
            loadMessages(selectedMissionId)
            pollRef.current = setInterval(() => loadMessages(selectedMissionId), 3000)
        }
        return () => {
            if (pollRef.current) clearInterval(pollRef.current)
        }
    }, [selectedMissionId])

    // Auto-scroll on new messages
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

    const loadSessions = async () => {
        try {
            const data = await fetchTeamChatSessions()
            setSessions(data)
        } catch (e) {
            console.error('Failed to load team chat sessions:', e)
        }
    }

    const loadMissions = async () => {
        try {
            const data = await fetchMissions()
            setMissions(data)
        } catch (e) {
            console.error('Failed to load missions:', e)
        }
    }

    const loadMessages = async (missionId: string) => {
        try {
            const data = await fetchTeamChatMessages(missionId)
            setMessages(data)
        } catch (e) {
            // Session may not exist yet — that's fine
        }
    }

    const handleSend = async () => {
        if (!input.trim() || !selectedMissionId || sending) return
        setSending(true)
        try {
            await sendTeamChatMessage(selectedMissionId, input.trim())
            setInput('')
            await loadMessages(selectedMissionId)
        } catch (e) {
            console.error('Failed to send message:', e)
        } finally {
            setSending(false)
        }
    }

    // Missions that have team chat sessions
    const sessionMissionIds = new Set(sessions.map(s => s.mission_id))
    const missionsWithChat = missions.filter(m => sessionMissionIds.has(m.id))
    // Also show active/queue missions without chat yet
    const activeMissions = missions.filter(m =>
        !sessionMissionIds.has(m.id) && (m.status === 'Active' || m.status === 'Queue')
    )
    const allMissions = [...missionsWithChat, ...activeMissions]

    const selectedMission = missions.find(m => m.id === selectedMissionId)

    return (
        <div className="flex h-[calc(100vh-12rem)] gap-4">
            {/* Left sidebar — mission list */}
            <div className="w-72 shrink-0 bg-card border border-border rounded-2xl flex flex-col overflow-hidden">
                <div className="p-4 border-b border-border flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-primary" />
                        <span className="text-sm font-bold">Team Chats</span>
                    </div>
                    <button
                        onClick={() => { loadSessions(); loadMissions() }}
                        className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
                        title="Refresh"
                    >
                        <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto scrollbar-hide">
                    {allMissions.length === 0 ? (
                        <div className="p-4 text-center text-slate-500 text-xs">
                            No missions with team chat yet.
                            <br />
                            Start an orchestration task to see team chat.
                        </div>
                    ) : (
                        allMissions.map(m => (
                            <button
                                key={m.id}
                                onClick={() => setSelectedMissionId(m.id)}
                                className={`w-full text-left px-4 py-3 border-b border-border/50 transition-colors ${
                                    selectedMissionId === m.id
                                        ? 'bg-primary/10 border-l-2 border-l-primary'
                                        : 'hover:bg-slate-800/50'
                                }`}
                            >
                                <div className="flex items-center gap-2 mb-1">
                                    {m.source === 'telegram' && (
                                        <span className="text-[10px] bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded font-bold">TG</span>
                                    )}
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                                        m.status === 'Active' ? 'bg-blue-500/20 text-blue-400' :
                                        m.status === 'Completed' ? 'bg-green-500/20 text-green-400' :
                                        m.status === 'Failed' ? 'bg-red-500/20 text-red-400' :
                                        'bg-slate-500/20 text-slate-400'
                                    }`}>
                                        {m.status}
                                    </span>
                                </div>
                                <p className="text-sm font-medium text-slate-200 truncate">{m.title}</p>
                                <p className="text-[10px] text-slate-500 mt-0.5">#{m.id}</p>
                            </button>
                        ))
                    )}
                </div>
            </div>

            {/* Right — chat area */}
            <div className="flex-1 bg-card border border-border rounded-2xl flex flex-col overflow-hidden">
                {!selectedMissionId ? (
                    <div className="flex-1 flex items-center justify-center text-slate-500">
                        <div className="text-center">
                            <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" />
                            <p className="text-sm font-medium">Select a mission to view team chat</p>
                            <p className="text-xs mt-1 opacity-60">Jason and sub-agents post updates here</p>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Chat header */}
                        <div className="p-4 border-b border-border">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
                                    <Users className="w-4 h-4 text-primary" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-slate-200">
                                        {selectedMission?.title || `Mission #${selectedMissionId}`}
                                    </h3>
                                    <p className="text-[10px] text-slate-500">
                                        Team Chat • {messages.length} message{messages.length !== 1 ? 's' : ''}
                                        {selectedMission?.source === 'telegram' && ' • via Telegram'}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Messages */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-hide">
                            {messages.length === 0 ? (
                                <div className="text-center text-slate-500 text-xs py-8">
                                    No messages yet. Orchestration updates will appear here.
                                </div>
                            ) : (
                                messages.map(msg => (
                                    <div key={msg.id} className="flex gap-3 group">
                                        <div className="w-7 h-7 rounded-lg bg-slate-800 flex items-center justify-center shrink-0 mt-0.5">
                                            {getSenderIcon(msg.sender_name, msg.role)}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-baseline gap-2 mb-0.5">
                                                <span className={`text-xs font-bold ${getSenderColor(msg.sender_name)}`}>
                                                    {msg.sender_name || msg.role}
                                                </span>
                                                <span className="text-[10px] text-slate-600">
                                                    {formatTime(msg.created_at)}
                                                </span>
                                            </div>
                                            <div className="text-sm text-slate-300 whitespace-pre-wrap break-words leading-relaxed">
                                                {msg.content}
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Input */}
                        <div className="p-4 border-t border-border">
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={input}
                                    onChange={e => setInput(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
                                    placeholder="Send a message to the team..."
                                    className="flex-1 bg-slate-800/50 border border-border rounded-xl px-4 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-primary/50 transition-colors"
                                />
                                <button
                                    onClick={handleSend}
                                    disabled={!input.trim() || sending}
                                    className="px-4 py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-white transition-colors"
                                >
                                    <Send className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}
