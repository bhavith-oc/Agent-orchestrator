import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Check, BrainCircuit, UserPlus, AlertCircle } from 'lucide-react'
import { Mission } from '../api'

interface CreateMissionModalProps {
    isOpen: boolean
    onClose: () => void
    onSubmit: (mission: Omit<Mission, 'id'>) => Promise<void>
}

// Mock available agents for dropdown
const AVAILABLE_AGENTS = ['GPT-4', 'Claude 3.5', 'Llama 3', 'Mistral Large', 'Gemini Pro']

export default function CreateMissionModal({ isOpen, onClose, onSubmit }: CreateMissionModalProps) {
    const [title, setTitle] = useState('')
    const [description, setDescription] = useState('')
    const [priority, setPriority] = useState<'General' | 'Urgent'>('General')
    const [agentStrategy, setAgentStrategy] = useState<'existing' | 'spawn'>('existing')
    const [selectedAgent, setSelectedAgent] = useState(AVAILABLE_AGENTS[0])
    const [spawnAgentName, setSpawnAgentName] = useState('')
    const [status, setStatus] = useState<'Queue' | 'Active'>('Queue')
    const [loading, setLoading] = useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!title.trim()) return

        setLoading(true)
        try {
            const agents = agentStrategy === 'existing' ? [selectedAgent] : [spawnAgentName || 'New Agent']

            await onSubmit({
                title,
                description,
                priority,
                status,
                agents
            })

            // Reset form
            setTitle('')
            setDescription('')
            setPriority('General')
            setAgentStrategy('existing')
            setSpawnAgentName('')
            onClose()
        } catch (error) {
            console.error(error)
        } finally {
            setLoading(false)
        }
    }

    if (!isOpen) return null

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                    onClick={onClose}
                />

                <motion.div
                    initial={{ scale: 0.95, opacity: 0, y: 20 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ scale: 0.95, opacity: 0, y: 20 }}
                    className="relative bg-[#161a23] border border-border rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden"
                >
                    <div className="p-6 border-b border-border flex items-center justify-between bg-[#1a1e29]">
                        <div>
                            <h2 className="text-xl font-bold font-display text-slate-100">Initialize New Mission</h2>
                            <p className="text-xs text-slate-400">Define protocols and agent assignment.</p>
                        </div>
                        <button onClick={onClose} className="p-2 hover:bg-slate-700/50 rounded-lg text-slate-400 hover:text-white transition-colors">
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className="p-6 space-y-5">
                        {/* Title & Priority */}
                        <div className="grid grid-cols-3 gap-4">
                            <div className="col-span-2">
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Mission Title</label>
                                <input
                                    type="text"
                                    required
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    placeholder="e.g., Analyze Competitor Pricing"
                                    className="w-full bg-[#0a0c10] border border-border rounded-xl px-4 py-2.5 text-sm focus:border-primary/50 focus:outline-none transition-all placeholder:text-slate-700"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Priority</label>
                                <div className="flex bg-[#0a0c10] rounded-xl p-1 border border-border">
                                    <button
                                        type="button"
                                        onClick={() => setPriority('General')}
                                        className={`flex-1 text-xs font-bold py-1.5 rounded-lg transition-all ${priority === 'General' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                                    >General</button>
                                    <button
                                        type="button"
                                        onClick={() => setPriority('Urgent')}
                                        className={`flex-1 text-xs font-bold py-1.5 rounded-lg transition-all ${priority === 'Urgent' ? 'bg-red-500/20 text-red-500 border border-red-500/20' : 'text-slate-500 hover:text-slate-300'}`}
                                    >Urgent</button>
                                </div>
                            </div>
                        </div>

                        {/* Description */}
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Description</label>
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="Detailed operational parameters..."
                                className="w-full bg-[#0a0c10] border border-border rounded-xl px-4 py-3 text-sm focus:border-primary/50 focus:outline-none transition-all placeholder:text-slate-700 h-24 resize-none"
                            />
                        </div>

                        {/* Agent Assignment */}
                        <div className="bg-[#0a0c10] rounded-xl p-4 border border-border/50">
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-3">Agent Assignment Strategy</label>

                            <div className="flex gap-4 mb-4">
                                <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all flex-1 ${agentStrategy === 'existing' ? 'bg-primary/10 border-primary/40' : 'bg-[#161a23] border-border hover:border-slate-600'}`}>
                                    <input type="radio" name="strategy" className="hidden" checked={agentStrategy === 'existing'} onChange={() => setAgentStrategy('existing')} />
                                    <BrainCircuit className={`w-5 h-5 ${agentStrategy === 'existing' ? 'text-primary' : 'text-slate-500'}`} />
                                    <div>
                                        <div className={`text-sm font-bold ${agentStrategy === 'existing' ? 'text-white' : 'text-slate-400'}`}>Existing Agent</div>
                                        <div className="text-[10px] text-slate-500">Assign to active unit</div>
                                    </div>
                                </label>

                                <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all flex-1 ${agentStrategy === 'spawn' ? 'bg-purple-500/10 border-purple-500/40' : 'bg-[#161a23] border-border hover:border-slate-600'}`}>
                                    <input type="radio" name="strategy" className="hidden" checked={agentStrategy === 'spawn'} onChange={() => setAgentStrategy('spawn')} />
                                    <UserPlus className={`w-5 h-5 ${agentStrategy === 'spawn' ? 'text-purple-500' : 'text-slate-500'}`} />
                                    <div>
                                        <div className={`text-sm font-bold ${agentStrategy === 'spawn' ? 'text-white' : 'text-slate-400'}`}>Spawn New</div>
                                        <div className="text-[10px] text-slate-500">Deploy fresh instance</div>
                                    </div>
                                </label>
                            </div>

                            {agentStrategy === 'existing' ? (
                                <select
                                    value={selectedAgent}
                                    onChange={(e) => setSelectedAgent(e.target.value)}
                                    className="w-full bg-[#161a23] border border-border rounded-xl px-4 py-2 text-sm focus:border-primary/50 focus:outline-none text-slate-300"
                                >
                                    {AVAILABLE_AGENTS.map(agent => (
                                        <option key={agent} value={agent}>{agent}</option>
                                    ))}
                                </select>
                            ) : (
                                <div className="space-y-2">
                                    <input
                                        type="text"
                                        value={spawnAgentName}
                                        onChange={(e) => setSpawnAgentName(e.target.value)}
                                        placeholder="Name your new agent (e.g. DataScraper-X1)"
                                        className="w-full bg-[#161a23] border border-border rounded-xl px-4 py-2 text-sm focus:border-purple-500/50 focus:outline-none text-slate-300 placeholder:text-slate-600"
                                    />
                                    <div className="flex items-center gap-2 text-[10px] text-amber-500/80">
                                        <AlertCircle className="w-3 h-3" />
                                        <span>Spawning consumes additional system resources.</span>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="pt-2 flex gap-3">
                            <button
                                type="button"
                                onClick={onClose}
                                className="flex-1 bg-slate-800 text-slate-400 font-bold py-3 rounded-xl hover:bg-slate-700 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={loading}
                                className="flex-[2] bg-primary text-white font-bold py-3 rounded-xl hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                                {loading ? 'Initializing...' : (
                                    <>
                                        <Check className="w-4 h-4" />
                                        {agentStrategy === 'spawn' ? 'Spawn & Assign' : 'Initialize Mission'}
                                    </>
                                )}
                            </button>
                        </div>
                    </form>
                </motion.div>
            </div>
        </AnimatePresence>
    )
}
