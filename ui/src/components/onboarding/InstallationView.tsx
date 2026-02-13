import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2, Layers, Shield, Cpu, Database, Sparkles } from 'lucide-react'

interface InstallationViewProps {
    onComplete: () => void
}

const STEPS = [
    { id: 'components', label: 'Loading Components', subtitle: 'Preparing the interface modules', icon: Layers },
    { id: 'system', label: 'Getting System Ready', subtitle: 'Initializing core services', icon: Cpu },
    { id: 'security', label: 'Setting Up Security', subtitle: 'Configuring authentication layer', icon: Shield },
    { id: 'database', label: 'Connecting Database', subtitle: 'Establishing data connections', icon: Database },
    { id: 'platform', label: 'Bringing Platform Up', subtitle: 'Finalizing your workspace', icon: Sparkles },
]

export default function InstallationView({ onComplete }: InstallationViewProps) {
    const [currentStepIdx, setCurrentStepIdx] = useState(0)
    const [progress, setProgress] = useState(0)

    useEffect(() => {
        const stepDuration = 1200
        const tickInterval = 40
        let elapsed = 0
        const totalDuration = STEPS.length * stepDuration

        const interval = setInterval(() => {
            elapsed += tickInterval
            const pct = Math.min((elapsed / totalDuration) * 100, 100)
            setProgress(pct)

            const stepIdx = Math.min(Math.floor(elapsed / stepDuration), STEPS.length - 1)
            setCurrentStepIdx(stepIdx)

            if (elapsed >= totalDuration) {
                clearInterval(interval)
                setTimeout(onComplete, 600)
            }
        }, tickInterval)

        return () => clearInterval(interval)
    }, [onComplete])

    return (
        <div className="w-full max-w-lg mx-auto flex flex-col items-center justify-center space-y-10">
            {/* Header */}
            <div className="text-center space-y-3">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-brand-500/10 border border-brand-500/20 mb-2">
                    {(() => {
                        const StepIcon = STEPS[currentStepIdx].icon
                        return <StepIcon size={28} className="text-brand-400" />
                    })()}
                </div>
                <h2 className="text-2xl font-bold text-white tracking-tight">
                    {STEPS[currentStepIdx].label}
                </h2>
                <p className="text-gray-400 text-sm">
                    {STEPS[currentStepIdx].subtitle}
                </p>
            </div>

            {/* Progress bar */}
            <div className="w-full max-w-xs space-y-3">
                <div className="h-2 w-full bg-gray-800 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-gradient-to-r from-brand-600 to-brand-400 rounded-full transition-all duration-300 ease-out"
                        style={{ width: `${progress}%` }}
                    />
                </div>
                <p className="text-center text-xs text-gray-500 font-mono">{Math.round(progress)}%</p>
            </div>

            {/* Step indicators */}
            <div className="w-full max-w-sm space-y-3">
                {STEPS.map((step, idx) => {
                    const isCompleted = idx < currentStepIdx || progress >= 100
                    const isActive = idx === currentStepIdx && progress < 100
                    const isPending = idx > currentStepIdx

                    return (
                        <div
                            key={step.id}
                            className={`flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-500 ${
                                isActive ? 'bg-brand-500/10 border border-brand-500/20' :
                                isCompleted ? 'bg-gray-800/30 border border-transparent' :
                                'border border-transparent opacity-40'
                            }`}
                        >
                            <div className={`flex items-center justify-center w-7 h-7 rounded-lg shrink-0 transition-all duration-300 ${
                                isCompleted ? 'bg-emerald-500/20 text-emerald-400' :
                                isActive ? 'bg-brand-500/20 text-brand-400' :
                                'bg-gray-800 text-gray-600'
                            }`}>
                                {isCompleted ? (
                                    <CheckCircle2 size={14} />
                                ) : isActive ? (
                                    <Loader2 size={14} className="animate-spin" />
                                ) : (
                                    <step.icon size={14} />
                                )}
                            </div>
                            <span className={`text-sm font-medium transition-colors duration-300 ${
                                isCompleted ? 'text-gray-400' :
                                isActive ? 'text-white' :
                                'text-gray-600'
                            }`}>
                                {step.label}
                            </span>
                            {isCompleted && (
                                <span className="ml-auto text-[10px] text-emerald-500 font-bold uppercase tracking-wider">Done</span>
                            )}
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
