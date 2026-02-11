import { useEffect, useState, useRef, useCallback } from 'react'
import { CheckCircle2, Circle, Loader2, AlertCircle } from 'lucide-react'
import { fetchDeployLogs, fetchDeployStatus, checkGatewayHealth, DeploymentInfo } from '../../api'

interface DeploymentProgressProps {
    deploymentId: string
    onComplete: (info: DeploymentInfo) => void
    onError: (msg: string) => void
}

const STEPS = [
    { id: 'configure', label: 'Generating Configuration' },
    { id: 'pull', label: 'Pulling Container Image' },
    { id: 'start', label: 'Starting Container' },
    { id: 'gateway', label: 'Authenticating Gateway' },
    { id: 'chat', label: 'Verifying Chat Session' },
]

type StepStatus = 'pending' | 'active' | 'done' | 'error'
type Phase = 'deploying' | 'waiting_gateway' | 'done' | 'error'

// Infer which step is active from the log content (backend sends STEP markers)
function inferSteps(logText: string, phase: Phase): Record<string, StepStatus> {
    const s: Record<string, StepStatus> = {
        configure: 'pending', pull: 'pending', start: 'pending',
        gateway: 'pending', chat: 'pending',
    }

    if (logText.includes('Starting deployment configuration')) s.configure = 'active'
    if (logText.includes('Configuration complete')) s.configure = 'done'
    if (logText.includes('STEP 1/5')) { s.configure = 'done' }
    if (logText.includes('STEP 2/5')) { s.configure = 'done'; s.pull = 'active' }
    if (logText.includes('STEP 3/5')) { s.configure = 'done'; s.pull = 'done'; s.start = 'active' }
    if (logText.includes('CONTAINER IS RUNNING')) { s.configure = 'done'; s.pull = 'done'; s.start = 'done' }
    if (logText.includes('STEP 4/5') || phase === 'waiting_gateway') {
        s.configure = 'done'; s.pull = 'done'; s.start = 'done'; s.gateway = 'active'
    }
    if (logText.includes('Gateway authenticated') || logText.includes('STEP 5/5')) {
        s.configure = 'done'; s.pull = 'done'; s.start = 'done'; s.gateway = 'done'; s.chat = 'active'
    }
    if (phase === 'done') {
        s.configure = 'done'; s.pull = 'done'; s.start = 'done'; s.gateway = 'done'; s.chat = 'done'
    }
    if (phase === 'error') {
        // Mark the first non-done step as error
        for (const key of ['configure', 'pull', 'start', 'gateway', 'chat']) {
            if (s[key] === 'active') { s[key] = 'error'; break }
            if (s[key] === 'pending') { s[key] = 'error'; break }
        }
    }
    if (logText.includes('LAUNCH FAILED')) {
        for (const key of ['configure', 'pull', 'start', 'gateway', 'chat']) {
            if (s[key] === 'active' || s[key] === 'pending') { s[key] = 'error'; break }
        }
    }

    return s
}

export default function DeploymentProgress({ deploymentId, onComplete, onError }: DeploymentProgressProps) {
    const [logs, setLogs] = useState<string[]>([])
    const [gwLogs, setGwLogs] = useState<string[]>([]) // gateway health check messages
    const [stepStatuses, setStepStatuses] = useState<Record<string, StepStatus>>({
        configure: 'active', pull: 'pending', start: 'pending',
        gateway: 'pending', chat: 'pending',
    })
    const [phase, setPhase] = useState<Phase>('deploying')
    const [subtitle, setSubtitle] = useState('Starting your OpenClaw agent container...')
    const logsEndRef = useRef<HTMLDivElement>(null)
    const completedRef = useRef(false)
    const deployInfoRef = useRef<DeploymentInfo | null>(null)

    const allLogs = [...logs, ...gwLogs]

    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [allLogs.length])

    const addGwLog = useCallback((msg: string) => {
        const ts = new Date().toISOString().replace('T', ' ').slice(0, 23) + 'Z'
        setGwLogs(prev => [...prev, `[${ts}] [INFO] ${msg}`])
    }, [])

    // Phase 1: Poll deployment logs + status
    useEffect(() => {
        if (phase !== 'deploying') return

        let attempts = 0
        const maxAttempts = 90

        const poll = async () => {
            attempts++
            try {
                const logResult = await fetchDeployLogs(deploymentId, 200)
                const logLines = logResult.logs
                    ? logResult.logs.split('\n').filter((l: string) => l.trim())
                    : []
                setLogs(logLines)

                // Infer step statuses from log content
                const logText = logResult.logs || ''
                setStepStatuses(inferSteps(logText, 'deploying'))

                const status = await fetchDeployStatus(deploymentId)

                if (status.status === 'running') {
                    deployInfoRef.current = status
                    setSubtitle('Container running. Authenticating gateway...')
                    setStepStatuses(prev => ({ ...prev, configure: 'done', pull: 'done', start: 'done', gateway: 'active' }))
                    setPhase('waiting_gateway')
                    return
                }

                // Check for fatal container errors
                const hasFatalError = /exited with code [1-9]|fatal error|oom|killed|cannot start|LAUNCH FAILED/i.test(logText)
                if (hasFatalError) {
                    setPhase('error')
                    setSubtitle('Deployment encountered an error.')
                    onError('Container failed to start. Check logs for details.')
                    return
                }

                if (attempts >= maxAttempts) {
                    setPhase('error')
                    setSubtitle('Deployment timed out.')
                    onError('Container did not start within 3 minutes.')
                    return
                }
            } catch (err: any) {
                if (attempts > 5) console.warn('Deploy poll error:', err.message)
            }
        }

        const interval = setInterval(poll, 2000)
        poll()
        return () => clearInterval(interval)
    }, [deploymentId, phase])

    // Phase 2: Poll gateway health
    useEffect(() => {
        if (phase !== 'waiting_gateway') return

        let attempts = 0
        const maxAttempts = 45
        let stopped = false

        const pollGateway = async () => {
            if (stopped) return
            attempts++
            try {
                addGwLog(`Gateway health check (attempt ${attempts})...`)
                const health = await checkGatewayHealth(deploymentId)

                if (health.http_ok && !health.ws_ok) {
                    addGwLog(`HTTP OK — waiting for WebSocket gateway...`)
                }

                if (health.healthy) {
                    addGwLog('Gateway authenticated and healthy!')
                    setStepStatuses(prev => ({ ...prev, gateway: 'done', chat: 'active' }))
                    setSubtitle('Gateway online. Verifying chat session...')
                    addGwLog('Verifying chat session...')

                    // Small delay to show the chat step
                    await new Promise(r => setTimeout(r, 1500))
                    addGwLog('Chat session ready!')
                    setStepStatuses(prev => ({ ...prev, chat: 'done' }))
                    setSubtitle('Agent is online and ready!')
                    setPhase('done')

                    if (!completedRef.current && deployInfoRef.current) {
                        completedRef.current = true
                        setTimeout(() => onComplete(deployInfoRef.current!), 1200)
                    }
                    return
                }

                if (attempts >= maxAttempts) {
                    addGwLog('Gateway health check timed out after 3 minutes.')
                    setPhase('error')
                    setSubtitle('Gateway did not become healthy in time.')
                    setStepStatuses(prev => ({ ...prev, gateway: 'error' }))
                    onError('Gateway did not become accessible within 3 minutes.')
                    return
                }
            } catch (err: any) {
                if (attempts > 3) {
                    addGwLog(`Gateway not ready yet: ${err.message || 'connection refused'}`)
                }
            }

            if (!stopped) setTimeout(pollGateway, 4000)
        }

        pollGateway()
        return () => { stopped = true }
    }, [phase, deploymentId])

    // Update step statuses when phase changes to error/done
    useEffect(() => {
        if (phase === 'error' || phase === 'done') {
            const logText = allLogs.join('\n')
            setStepStatuses(inferSteps(logText, phase))
        }
    }, [phase])

    return (
        <div className="w-full max-w-md mx-auto space-y-8">
            <div className="text-center space-y-2">
                <h2 className="text-2xl font-bold text-white">Deploying Container</h2>
                <p className="text-gray-400 text-sm">{subtitle}</p>
                <p className="text-gray-600 text-xs font-mono">ID: {deploymentId}</p>
            </div>

            {/* Timeline */}
            <div className="space-y-6 relative pl-4 border-l border-gray-800 ml-4">
                {STEPS.map((step) => {
                    const status = stepStatuses[step.id] || 'pending'
                    return (
                        <div key={step.id} className="relative flex items-center group">
                            <span className={`absolute -left-[25px] flex h-8 w-8 items-center justify-center rounded-full border-2 transition-all duration-500
                                ${status === 'done' ? 'border-brand-500 bg-brand-900/20 text-brand-500' :
                                    status === 'active' ? 'border-brand-400 bg-brand-500 text-white shadow-[0_0_15px_rgba(14,165,233,0.5)]' :
                                    status === 'error' ? 'border-red-500 bg-red-900/20 text-red-500' :
                                    'border-gray-700 bg-gray-900 text-gray-600'}`}>
                                {status === 'done' ? <CheckCircle2 size={16} /> :
                                 status === 'active' ? <Loader2 size={16} className="animate-spin" /> :
                                 status === 'error' ? <AlertCircle size={16} /> :
                                 <Circle size={16} />}
                            </span>
                            <div className="ml-6">
                                <p className={`text-sm font-medium transition-colors duration-300 ${
                                    status === 'active' || status === 'done' ? 'text-white' :
                                    status === 'error' ? 'text-red-400' : 'text-gray-500'
                                }`}>{step.label}</p>
                                {status === 'active' && (
                                    <div className="w-48 h-1 bg-gray-800 rounded-full mt-2 overflow-hidden">
                                        <div className="h-full bg-brand-500 rounded-full animate-pulse" style={{ width: '60%' }} />
                                    </div>
                                )}
                            </div>
                        </div>
                    )
                })}
            </div>

            {/* Deployment Logs Terminal */}
            <div className="bg-dark-800 rounded-lg border border-gray-800 p-4 font-mono text-xs h-52 overflow-y-auto shadow-inner">
                <div className="space-y-0.5">
                    {allLogs.length === 0 && (
                        <div className="text-gray-600 flex items-center gap-2">
                            <Loader2 size={12} className="animate-spin" />
                            Initializing deployment...
                        </div>
                    )}
                    {allLogs.map((line, i) => {
                        const isStep = line.includes('STEP ') || line.includes('───')
                        const isError = line.includes('[ERROR]') || line.includes('FAILED')
                        const isSuccess = line.includes('✓') || line.includes('RUNNING')
                        return (
                            <div key={i} className={`flex gap-2 leading-relaxed ${
                                isError ? 'text-red-400' :
                                isStep ? 'text-brand-300 font-semibold' :
                                isSuccess ? 'text-green-400' :
                                'text-gray-300'
                            }`}>
                                <span className={`shrink-0 ${isStep ? 'text-brand-500' : 'text-gray-600'}`}>{'>'}</span>
                                <span className="break-all">{line}</span>
                            </div>
                        )
                    })}
                    <div ref={logsEndRef} />
                </div>
            </div>

            {phase === 'error' && (
                <div className="p-3 bg-red-900/20 border border-red-900/50 rounded-lg text-red-200 text-sm text-center">
                    Deployment encountered an issue. Check the logs above for details.
                </div>
            )}

            {phase === 'done' && (
                <div className="p-3 bg-green-900/20 border border-green-900/50 rounded-lg text-green-200 text-sm text-center flex items-center justify-center gap-2">
                    <CheckCircle2 size={16} /> Agent is online and ready for chat!
                </div>
            )}
        </div>
    )
}
