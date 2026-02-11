import { motion } from 'framer-motion'
import { Rocket, Hammer, ShieldAlert } from 'lucide-react'

export default function ComingSoon({ title, description }: { title: string, description: string }) {
    return (
        <div className="flex flex-col items-center justify-center h-full text-slate-500 text-center space-y-6 relative overflow-hidden">

            {/* Background Effects */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
                <div className="absolute top-[20%] right-[20%] w-[40%] h-[40%] bg-primary/5 blur-[100px] rounded-full" />
            </div>

            <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="relative z-10 flex flex-col items-center"
            >
                <div className="w-24 h-24 rounded-3xl border border-dashed border-slate-700 flex items-center justify-center mb-6 bg-[#0f1117]">
                    <Rocket className="w-10 h-10 text-primary animate-pulse" />
                </div>

                <div className="space-y-2">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-[10px] font-bold uppercase tracking-widest">
                        <Hammer className="w-3 h-3" />
                        Under Construction
                    </div>
                    <h1 className="text-4xl font-bold font-display text-slate-200 tracking-tight">{title}</h1>
                    <p className="text-sm max-w-md mx-auto leading-relaxed">{description}</p>
                </div>

                <div className="mt-8 flex gap-4">
                    <button className="px-6 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition-all border border-slate-700">
                        Notify Me
                    </button>
                    <button className="px-6 py-2.5 rounded-xl bg-transparent hover:bg-slate-800/50 text-slate-500 text-xs font-bold transition-all border border-border">
                        Return Home
                    </button>
                </div>
            </motion.div>
        </div>
    )
}
