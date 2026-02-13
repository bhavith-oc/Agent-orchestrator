import { useState } from 'react'
import {
    DndContext,
    DragOverlay,
    closestCorners,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragStartEvent,
    DragOverEvent,
    DragEndEvent,
} from '@dnd-kit/core'
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { motion } from 'framer-motion'
import { GripVertical, Trash2, Pencil, X, Check, Loader2, AlertTriangle, Send, CheckCircle2, Clock, MessageCircleWarning } from 'lucide-react'
import { Mission } from '../api'
import { useMissions } from '../context/MissionContext'

// --- Types ---
type Status = 'Queue' | 'Active' | 'Completed' | 'Failed'

// --- Sortable Item Component ---
function SortableItem({ mission, onDelete, onEdit }: { mission: Mission, onDelete: (id: string) => void, onEdit: (id: string) => void }) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: mission.id, data: { ...mission } })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    }

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`group p-4 mb-3 rounded-xl bg-[#1a1e29] border hover:border-primary/50 transition-all relative overflow-hidden flex flex-col ${isDragging ? 'opacity-50 ring-2 ring-primary z-50' : 'border-[#2d3748]'
                }`}
        >
            {/* Hover Glow */}
            <div className={`absolute top-0 right-0 w-24 h-24 blur-2xl rounded-full -mr-12 -mt-12 transition-colors pointer-events-none ${mission.priority === 'Urgent' ? 'bg-red-500/5 group-hover:bg-red-500/10' : 'bg-primary/5 group-hover:bg-primary/10'}`} />

            <div className="flex items-center justify-between mb-3 relative z-10">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[9px] font-bold text-primary tracking-widest uppercase">ID_{mission.id}</span>
                    {mission.priority === 'Urgent' && (
                        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/20">
                            <AlertTriangle className="w-2.5 h-2.5 text-red-500" />
                            <span className="text-[8px] font-bold text-red-400 uppercase tracking-wide">Urgent</span>
                        </div>
                    )}
                    {mission.source === 'telegram' && (
                        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-500/10 border border-purple-500/20">
                            <Send className="w-2.5 h-2.5 text-purple-400" />
                            <span className="text-[8px] font-bold text-purple-400 uppercase tracking-wide">Telegram</span>
                        </div>
                    )}
                    {mission.review_status === 'approved' && (
                        <span title="Approved"><CheckCircle2 className="w-3 h-3 text-green-400" /></span>
                    )}
                    {mission.review_status === 'pending_review' && (
                        <span title="Pending Review"><Clock className="w-3 h-3 text-yellow-400" /></span>
                    )}
                    {mission.review_status === 'changes_requested' && (
                        <span title="Changes Requested"><MessageCircleWarning className="w-3 h-3 text-orange-400" /></span>
                    )}
                </div>

                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => onEdit(mission.id)} className="p-1 hover:bg-slate-700/50 rounded text-slate-400 hover:text-white transition-colors">
                        <Pencil className="w-3 h-3" />
                    </button>
                    <button onClick={() => onDelete(mission.id)} className="p-1 hover:bg-red-500/20 rounded text-slate-400 hover:text-red-400 transition-colors">
                        <Trash2 className="w-3 h-3" />
                    </button>
                    <div {...attributes} {...listeners} className="p-1 hover:bg-slate-700/50 rounded text-slate-600 hover:text-slate-300 cursor-grab ml-1">
                        <GripVertical className="w-3.5 h-3.5" />
                    </div>
                </div>
                {/* Always show grip if not hovering (mobile friendly-ish) or just rely on the gap */}
                <div {...attributes} {...listeners} className="text-slate-600 group-hover:hidden cursor-grab absolute right-0">
                    <GripVertical className="w-3.5 h-3.5" />
                </div>
            </div>

            <h4 className="text-sm font-bold mb-1 group-hover:text-primary transition-colors">{mission.title}</h4>
            <p className="text-xs text-slate-400 mb-4 line-clamp-2 leading-relaxed">{mission.description}</p>

            <div className="mt-auto flex items-center justify-between">
                <div className="flex -space-x-2">
                    {mission.agents.map((agent, i) => (
                        <div key={i} className="w-6 h-6 rounded-full border-2 border-[#1a1e29] bg-slate-800 flex items-center justify-center text-[7px] font-bold ring-1 ring-slate-700" title={agent}>
                            {agent.charAt(0)}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}

// --- Column Component ---
interface ColumnProps {
    id: Status
    title: string
    missions: Mission[]
    onDelete: (id: string) => void
    onEdit: (id: string) => void
}

function Column({ id, title, missions, onDelete, onEdit }: ColumnProps) {
    const { setNodeRef } = useSortable({ id })

    return (
        <div ref={setNodeRef} className="flex flex-col h-full bg-[#161a23]/50 rounded-2xl p-4 border border-border min-h-[500px]">
            <div className="flex items-center justify-between mb-4 px-2">
                <div className="flex items-center gap-2">
                    <h3 className="font-bold text-sm tracking-wide text-slate-300 uppercase">{title}</h3>
                    <span className="bg-slate-800 text-slate-400 text-[10px] font-bold px-2 py-0.5 rounded-full">{missions.length}</span>
                </div>
            </div>
            <SortableContext items={missions.map(m => m.id)} strategy={verticalListSortingStrategy}>
                <div className="flex-1 overflow-y-auto scrollbar-hide">
                    {missions.map((mission) => (
                        <SortableItem key={mission.id} mission={mission} onDelete={onDelete} onEdit={onEdit} />
                    ))}
                </div>
            </SortableContext>
        </div>
    )
}

// --- Main Kanban Component ---
export default function Dashboard() {
    const { missions, loading, editMission, removeMission } = useMissions()

    // Local drag state
    const [activeId, setActiveId] = useState<string | null>(null)

    // Search filter
    const [filter, setFilter] = useState('')

    // Edit Modal State
    const [isEditing, setIsEditing] = useState(false)
    const [editingMission, setEditingMission] = useState<Mission | null>(null)
    const [editForm, setEditForm] = useState({ title: '', description: '' })

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    )

    // Handlers
    const handleDelete = async (id: string) => {
        if (window.confirm("Abort this mission? Data will be purged.")) {
            await removeMission(id)
        }
    }

    const handleEditStart = (id: string) => {
        const mission = missions.find(m => m.id === id)
        if (mission) {
            setEditingMission(mission)
            setEditForm({ title: mission.title, description: mission.description })
            setIsEditing(true)
        }
    }

    const handleEditSave = async () => {
        if (!editingMission) return
        await editMission(editingMission.id, editForm)
        setIsEditing(false)
        setEditingMission(null)
    }

    // Drag Handlers
    const handleDragStart = (event: DragStartEvent) => {
        setActiveId(event.active.id as string)
    }

    const handleDragOver = (event: DragOverEvent) => {
        // We really shouldn't allow reordering in this simple view if we aren't persisting order
        // But for visual feedback we can leave it. Context updates are tricky with optimistic UI + context.
        // For simplicity, we won't implement optimistic drag-over reordering in the global context 
        // because it would cause jitter. We will rely on DragEnd to trigger the status update.
    }

    const handleDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event
        setActiveId(null)
        if (!over) return

        const activeId = active.id
        const overId = over.id

        // Find current mission
        const mission = missions.find(m => m.id === activeId)
        if (!mission) return

        // If dropped on a column container
        if (['Queue', 'Active', 'Completed', 'Failed'].includes(overId as string)) {
            if (mission.status !== overId) {
                await editMission(activeId as string, { status: overId as any })
            }
            return
        }

        // If dropped on another item
        const overMission = missions.find(m => m.id === overId)
        if (overMission && mission.status !== overMission.status) {
            await editMission(activeId as string, { status: overMission.status })
        }
    }

    const getMissionsByStatus = (status: Status) => missions.filter(m => m.status === status && m.title.toLowerCase().includes(filter.toLowerCase()))
    const activeMission = activeId ? missions.find(m => m.id === activeId) : null

    if (loading) {
        return <div className="h-full flex items-center justify-center"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="h-full flex flex-col relative"
        >
            <div className="flex items-center justify-between mb-8">
                <h3 className="text-xl font-bold font-display">Mission Control</h3>
                <div className="flex gap-4">
                    <input
                        type="text"
                        placeholder="Filter missions..."
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        className="bg-[#1a1e29] border border-border rounded-xl px-4 py-1.5 text-xs focus:outline-none focus:border-primary/50 w-64 text-slate-300 placeholder:text-slate-600"
                    />
                    <span className="px-3 py-1 bg-primary/20 text-primary text-[10px] font-bold rounded-full border border-primary/20 uppercase tracking-wider flex items-center">
                        Total: {missions.length}
                    </span>
                </div>
            </div>

            <DndContext
                sensors={sensors}
                collisionDetection={closestCorners}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnd={handleDragEnd}
            >
                <div className="grid grid-cols-4 gap-5 h-full pb-4">
                    <Column id="Queue" title="Mission Queue" missions={getMissionsByStatus('Queue')} onDelete={handleDelete} onEdit={handleEditStart} />
                    <Column id="Active" title="Active Operations" missions={getMissionsByStatus('Active')} onDelete={handleDelete} onEdit={handleEditStart} />
                    <Column id="Completed" title="Mission Debrief" missions={getMissionsByStatus('Completed')} onDelete={handleDelete} onEdit={handleEditStart} />
                    <Column id="Failed" title="Failed" missions={getMissionsByStatus('Failed')} onDelete={handleDelete} onEdit={handleEditStart} />
                </div>

                <DragOverlay>
                    {activeMission ? <SortableItem mission={activeMission} onDelete={() => { }} onEdit={() => { }} /> : null}
                </DragOverlay>
            </DndContext>

            {/* Edit Modal - Kept local for simplicity since it's just title/desc */}
            {isEditing && (
                <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <motion.div
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="bg-[#161a23] border border-border p-6 rounded-2xl w-full max-w-md shadow-2xl"
                    >
                        <h3 className="text-lg font-bold mb-4 font-display">Edit Mission Protocols</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase">Title</label>
                                <input
                                    className="w-full bg-[#0a0c10] border border-border rounded-xl px-4 py-2 mt-1 text-sm focus:border-primary/50 focus:outline-none text-slate-300"
                                    value={editForm.title}
                                    onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase">Description</label>
                                <textarea
                                    className="w-full bg-[#0a0c10] border border-border rounded-xl px-4 py-2 mt-1 text-sm focus:border-primary/50 focus:outline-none h-24 resize-none text-slate-300"
                                    value={editForm.description}
                                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                                />
                            </div>
                            <div className="flex gap-2 pt-2">
                                <button onClick={handleEditSave} className="flex-1 bg-primary text-white font-bold py-2 rounded-xl hover:bg-primary/90 transition-colors flex items-center justify-center gap-2">
                                    <Check className="w-4 h-4" /> Save
                                </button>
                                <button onClick={() => setIsEditing(false)} className="flex-1 bg-slate-800 text-slate-400 font-bold py-2 rounded-xl hover:bg-slate-700 transition-colors flex items-center justify-center gap-2">
                                    <X className="w-4 h-4" /> Cancel
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </div>
            )}
        </motion.div>
    )
}
