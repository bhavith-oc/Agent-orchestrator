import { useEffect, useState, useRef } from 'react'
import { CheckCircle2, Circle, Loader2, Terminal, ShieldCheck, Database, Cpu } from 'lucide-react'

interface LogEntry {
    id: string
    message: string
    timestamp: number
}

interface InstallationState {
    progress: number
    currentStep: string
    logs: LogEntry[]
}

interface InstallationViewProps {
    onComplete: () => void
}

const STEPS = [
    { id: 'init', label: 'Initializing Environment', icon: Terminal },
    { id: 'auth', label: 'Verifying Credentials', icon: ShieldCheck },
    { id: 'core', label: 'Installing OpenClaw Core', icon: Cpu },
    { id: 'db', label: 'Provisioning Database', icon: Database },
]

export default function InstallationView({ onComplete }: InstallationViewProps) {
    const [state, setState] = useState<InstallationState>({
        progress: 0,
        currentStep: 'init',
        logs: [],
    })
    const logsEndRef = useRef<HTMLDivElement>(null)
    const stepsTriggered = useRef<Set<string>>(new Set())

    const addLog = (message: string) => {
        setState(prev => ({
            ...prev,
            logs: [...prev.logs, {
                id: Math.random().toString(36).substr(2, 9),
                message,
                timestamp: Date.now(),
            }],
        }))
    }

    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [state.logs])

    useEffect(() => {
        let progress = 0
        const interval = setInterval(() => {
            progress += Math.random() * 5

            if (progress < 25) {
                if (!stepsTriggered.current.has('init')) {
                    stepsTriggered.current.add('init')
                    setState(s => ({ ...s, currentStep: 'init' }))
                    addLog('Checking system requirements...')
                    setTimeout(() => addLog('Allocating memory heap...'), 300)
                }
            } else if (progress < 50) {
                if (!stepsTriggered.current.has('auth')) {
                    stepsTriggered.current.add('auth')
                    setState(s => ({ ...s, currentStep: 'auth' }))
                    addLog('Authenticating with OAuth provider...')
                    setTimeout(() => addLog('Token received. Verifying signature...'), 400)
                }
            } else if (progress < 75) {
                if (!stepsTriggered.current.has('core')) {
                    stepsTriggered.current.add('core')
                    setState(s => ({ ...s, currentStep: 'core' }))
                    addLog('Downloading core binaries (v2.4.0)...')
                    setTimeout(() => addLog('Unpacking dependencies...'), 350)
                }
            } else if (progress < 95) {
                if (!stepsTriggered.current.has('db')) {
                    stepsTriggered.current.add('db')
                    setState(s => ({ ...s, currentStep: 'db' }))
                    addLog('Migrating schema...')
                    setTimeout(() => addLog('Indexing vectors...'), 300)
                }
            }

            if (progress >= 100) {
                progress = 100
                clearInterval(interval)
                addLog('Installation Complete.')
                setTimeout(onComplete, 800)
            }

            setState(prev => ({ ...prev, progress }))
        }, 200)

        return () => clearInterval(interval)
    }, [])

    return (
        <div className="w-full max-w-md mx-auto space-y-8">
            <div className="text-center space-y-2">
                <h2 className="text-2xl font-bold text-white">System Provisioning</h2>
                <p className="text-gray-400 text-sm">Please wait while we configure your instance.</p>
            </div>

            {/* Timeline */}
            <div className="space-y-6 relative pl-4 border-l border-gray-800 ml-4">
                {STEPS.map((step, idx) => {
                    const isActive = state.currentStep === step.id
                    const isCompleted = STEPS.findIndex(s => s.id === state.currentStep) > idx || state.progress >= 100

                    return (
                        <div key={step.id} className="relative flex items-center group">
                            <span className={`absolute -left-[25px] flex h-8 w-8 items-center justify-center rounded-full border-2 transition-all duration-300
                                ${isCompleted ? 'border-brand-500 bg-brand-900/20 text-brand-500' :
                                    isActive ? 'border-brand-400 bg-brand-500 text-white shadow-[0_0_15px_rgba(14,165,233,0.5)]' :
                                    'border-gray-700 bg-gray-900 text-gray-600'}`}>
                                {isCompleted ? <CheckCircle2 size={16} /> : isActive ? <Loader2 size={16} className="animate-spin" /> : <Circle size={16} />}
                            </span>
                            <div className="ml-6">
                                <p className={`text-sm font-medium transition-colors ${isActive || isCompleted ? 'text-white' : 'text-gray-500'}`}>{step.label}</p>
                                {isActive && (
                                    <div className="w-48 h-1 bg-gray-800 rounded-full mt-2 overflow-hidden">
                                        <div className="h-full bg-brand-500 animate-pulse" style={{ width: '60%' }} />
                                    </div>
                                )}
                            </div>
                        </div>
                    )
                })}
            </div>

            {/* Terminal Output */}
            <div className="bg-dark-800 rounded-lg border border-gray-800 p-4 font-mono text-xs h-48 overflow-y-auto shadow-inner">
                <div className="space-y-1">
                    {state.logs.map((log) => (
                        <div key={log.id} className="flex gap-2 text-gray-300">
                            <span className="text-gray-600">[{new Date(log.timestamp).toLocaleTimeString().split(' ')[0]}]</span>
                            <span className="text-brand-400">{'>'}</span>
                            <span>{log.message}</span>
                        </div>
                    ))}
                    <div ref={logsEndRef} />
                </div>
            </div>
        </div>
    )
}
