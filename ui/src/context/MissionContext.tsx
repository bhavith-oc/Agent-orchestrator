import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { Mission, fetchMissions, createMission, updateMission, deleteMission } from '../api'

interface MissionContextValue {
    missions: Mission[]
    loading: boolean
    addMission: (mission: Omit<Mission, 'id'>) => Promise<void>
    editMission: (id: string, updates: Partial<Mission>) => Promise<void>
    removeMission: (id: string) => Promise<void>
    refresh: () => Promise<void>
}

const MissionContext = createContext<MissionContextValue | null>(null)

export function MissionProvider({ children }: { children: ReactNode }) {
    const [missions, setMissions] = useState<Mission[]>([])
    const [loading, setLoading] = useState(true)

    const refresh = useCallback(async () => {
        try {
            const data = await fetchMissions()
            setMissions(data)
        } catch (err) {
            console.error('Failed to fetch missions:', err)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        const token = localStorage.getItem('aether_token')
        if (token) {
            refresh()
            // Poll every 5s for real-time kanban updates from orchestration
            const interval = setInterval(refresh, 5000)
            return () => clearInterval(interval)
        } else {
            setLoading(false)
        }
    }, [refresh])

    const addMission = useCallback(async (mission: Omit<Mission, 'id'>) => {
        const created = await createMission(mission)
        setMissions(prev => [...prev, created])
    }, [])

    const editMission = useCallback(async (id: string, updates: Partial<Mission>) => {
        const updated = await updateMission(id, updates)
        setMissions(prev => prev.map(m => (m.id === id ? updated : m)))
    }, [])

    const removeMission = useCallback(async (id: string) => {
        await deleteMission(id)
        setMissions(prev => prev.filter(m => m.id !== id))
    }, [])

    return (
        <MissionContext.Provider value={{ missions, loading, addMission, editMission, removeMission, refresh }}>
            {children}
        </MissionContext.Provider>
    )
}

export function useMissions(): MissionContextValue {
    const ctx = useContext(MissionContext)
    if (!ctx) {
        throw new Error('useMissions must be used within a MissionProvider')
    }
    return ctx
}
