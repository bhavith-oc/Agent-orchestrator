import { useState } from 'react'
import { motion } from 'framer-motion'
import { Shield, Lock, User, Loader2 } from 'lucide-react'
import { login } from '../api'

interface LoginProps {
    onLogin: () => void
}

export default function Login({ onLogin }: LoginProps) {
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError('')
        setLoading(true)
        try {
            await login(username, password)
            onLogin()
        } catch (err: any) {
            const msg = err?.response?.data?.detail || 'Invalid credentials. Access denied.'
            setError(msg)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="flex items-center justify-center min-h-screen bg-[#0f1117] relative overflow-hidden font-sans text-slate-100">
            {/* Background Effects */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-primary/5 blur-[120px] rounded-full" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-emerald-500/5 blur-[120px] rounded-full" />
            </div>

            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5 }}
                className="w-full max-w-md p-8 bg-[#161a23]/80 backdrop-blur-xl border border-border rounded-3xl shadow-2xl relative z-10"
            >
                <div className="flex flex-col items-center mb-8">
                    <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-4 border border-primary/20 shadow-[0_0_20px_rgba(6,87,249,0.2)]">
                        <Shield className="w-8 h-8 text-primary" />
                    </div>
                    <h1 className="text-3xl font-bold font-display tracking-tight text-white">AETHER</h1>
                    <p className="text-[10px] text-primary font-bold tracking-[0.3em] uppercase mt-1">Orchestrator Access</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block ml-1">Identity</label>
                        <div className="relative">
                            <User className="absolute left-4 top-3.5 w-5 h-5 text-slate-500" />
                            <input
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                className="w-full bg-[#0a0c10] border border-border rounded-xl py-3 pl-12 pr-4 text-sm focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all placeholder:text-slate-600"
                                placeholder="Username"
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block ml-1">Passcode</label>
                        <div className="relative">
                            <Lock className="absolute left-4 top-3.5 w-5 h-5 text-slate-500" />
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full bg-[#0a0c10] border border-border rounded-xl py-3 pl-12 pr-4 text-sm focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all placeholder:text-slate-600"
                                placeholder="Password"
                            />
                        </div>
                    </div>

                    {error && (
                        <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="text-red-400 text-xs font-medium text-center bg-red-500/10 py-2 rounded-lg border border-red-500/20"
                        >
                            {error}
                        </motion.div>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-primary hover:bg-primary/90 text-white font-bold py-3.5 rounded-xl transition-all shadow-[0_0_20px_rgba(6,87,249,0.3)] hover:shadow-[0_0_30px_rgba(6,87,249,0.5)] active:scale-[0.98] disabled:opacity-50"
                    >
                        {loading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'Authenticate'}
                    </button>

                    <p className="text-[10px] text-center text-slate-600 font-medium pt-4">
                        Secure Connection via Quantum-Resistant Layer (QRL)
                    </p>
                </form>
            </motion.div>
        </div>
    )
}
