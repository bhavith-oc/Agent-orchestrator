import { useEffect, useState } from 'react'

export default function Visuals() {
    const [mounted, setMounted] = useState(false)
    useEffect(() => { setMounted(true) }, [])

    return (
        <div className="relative w-full h-full overflow-hidden bg-black">
            {/* Background Gradients */}
            <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-brand-900/40 via-black to-black opacity-80" />
            <div className="absolute bottom-0 right-0 w-full h-full bg-[radial-gradient(ellipse_at_bottom_left,_var(--tw-gradient-stops))] from-purple-900/30 via-black to-black opacity-80" />

            {/* Grid Overlay */}
            <div className="absolute inset-0"
                style={{
                    backgroundImage: 'linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px)',
                    backgroundSize: '40px 40px'
                }}
            />

            {/* Animated Elements */}
            <div className="absolute inset-0 flex items-center justify-center">
                <div className={`relative w-96 h-96 animate-float transition-opacity duration-1000 ${mounted ? 'opacity-100' : 'opacity-0'}`}>
                    {/* Central Orb */}
                    <div className="absolute inset-0 m-auto w-48 h-48 rounded-full bg-brand-500/10 blur-3xl animate-pulse-slow" />
                    <div className="absolute inset-0 m-auto w-32 h-32 rounded-full bg-brand-400/20 blur-xl" />

                    {/* Orbiting Rings */}
                    <svg className="absolute inset-0 w-full h-full animate-[spin_10s_linear_infinite] opacity-40" viewBox="0 0 100 100">
                        <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="0.5" className="text-brand-500" strokeDasharray="10 20" />
                    </svg>
                    <svg className="absolute inset-0 w-full h-full animate-[spin_15s_linear_infinite_reverse] opacity-30" viewBox="0 0 100 100">
                        <circle cx="50" cy="50" r="35" fill="none" stroke="currentColor" strokeWidth="0.5" className="text-purple-500" strokeDasharray="5 15" />
                    </svg>

                    {/* Floating Data Points */}
                    <div className="absolute top-1/4 left-1/4 w-2 h-2 bg-white rounded-full shadow-[0_0_10px_rgba(255,255,255,0.8)] animate-pulse" />
                    <div className="absolute bottom-1/3 right-1/4 w-1.5 h-1.5 bg-brand-400 rounded-full shadow-[0_0_10px_rgba(56,189,248,0.8)] animate-pulse" style={{ animationDelay: '75ms' }} />
                    <div className="absolute top-1/2 right-0 w-1 h-1 bg-purple-400 rounded-full shadow-[0_0_10px_rgba(192,132,252,0.8)] animate-pulse" style={{ animationDelay: '150ms' }} />
                </div>
            </div>

            {/* Scanline */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-10">
                <div className="w-full h-2 bg-white blur-md animate-scan" />
            </div>

            {/* Text Overlay */}
            <div className="absolute bottom-12 left-12 z-10">
                <h1 className="text-4xl font-bold text-white tracking-tighter mb-2">Aether Orchestrator</h1>
                <p className="text-brand-200/60 font-mono text-sm tracking-widest uppercase">Autonomous Agent Infrastructure</p>
            </div>
        </div>
    )
}
