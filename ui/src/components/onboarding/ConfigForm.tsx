import { useState } from 'react'
import { Send, Key, Gift, ChevronRight, AlertCircle } from 'lucide-react'

export interface BotConfig {
    telegramToken: string
    telegramUserId: string
    llmProvider: 'openrouter' | 'openai' | 'anthropic'
    apiKey: string
}

interface ConfigFormProps {
    onComplete: (config: BotConfig) => void
}

export default function ConfigForm({ onComplete }: ConfigFormProps) {
    const [config, setConfig] = useState<BotConfig>({
        telegramToken: '',
        telegramUserId: '',
        llmProvider: 'openrouter',
        apiKey: '',
    })
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setError(null)

        if (!config.apiKey) {
            setError('API Key is required.')
            setLoading(false)
            return
        }

        if (config.telegramToken && !config.telegramUserId) {
            setError('Telegram User ID is required when Bot Token is provided.')
            setLoading(false)
            return
        }

        try {
            await new Promise(resolve => setTimeout(resolve, 800))
            onComplete(config)
        } catch (err: any) {
            setError(err.message || 'Configuration failed. Please check your keys.')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="w-full max-w-md mx-auto space-y-8">
            <div className="space-y-2">
                <h2 className="text-3xl font-bold text-white">Agent Configuration</h2>
                <p className="text-gray-400">Set up your LLM provider and optional Telegram bot.</p>
            </div>

            <div className="bg-gradient-to-r from-emerald-900/20 to-teal-900/20 border border-emerald-500/30 rounded-lg p-4 flex items-start gap-4">
                <div className="p-2 bg-emerald-500/10 rounded-full text-emerald-400 shrink-0">
                    <Gift size={20} />
                </div>
                <div>
                    <h4 className="text-emerald-400 font-medium text-sm">Setup Bonus Active</h4>
                    <p className="text-emerald-200/60 text-xs mt-1">
                        Your account has been credited with $1.00 worth of OpenRouter free credits to get started.
                    </p>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
                {/* LLM Provider */}
                <div className="space-y-3">
                    <label className="block text-sm font-medium text-gray-300">LLM Provider</label>
                    <div className="grid grid-cols-3 gap-2">
                        {(['openrouter', 'openai', 'anthropic'] as const).map(provider => (
                            <button
                                key={provider}
                                type="button"
                                onClick={() => setConfig({ ...config, llmProvider: provider })}
                                className={`py-2.5 px-4 rounded-lg text-sm font-medium border transition-all ${
                                    config.llmProvider === provider
                                        ? 'bg-brand-600/20 border-brand-500 text-white shadow-[0_0_10px_rgba(14,165,233,0.3)]'
                                        : 'bg-dark-800 border-gray-700 text-gray-400 hover:border-gray-600'
                                }`}
                            >
                                {provider === 'openrouter' ? 'OpenRouter' : provider === 'openai' ? 'OpenAI' : 'Anthropic'}
                            </button>
                        ))}
                    </div>
                </div>

                {/* API Key */}
                <div className="space-y-3">
                    <label className="block text-sm font-medium text-gray-300">
                        {config.llmProvider === 'openrouter' ? 'OpenRouter API Key' : config.llmProvider === 'openai' ? 'OpenAI API Key' : 'Anthropic API Key'}
                    </label>
                    <div className="relative group">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <Key size={16} className="text-gray-500 group-focus-within:text-brand-400 transition-colors" />
                        </div>
                        <input
                            type="password"
                            placeholder="sk-..."
                            className="w-full bg-dark-800 border border-gray-700 text-white rounded-lg py-3 pl-10 pr-4 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-all placeholder-gray-600"
                            value={config.apiKey}
                            onChange={e => setConfig({ ...config, apiKey: e.target.value })}
                        />
                    </div>
                </div>

                {/* Telegram Section */}
                <div className="space-y-3 pt-2 border-t border-gray-800">
                    <div className="flex items-center justify-between">
                        <label className="block text-sm font-medium text-gray-300">Telegram Bot <span className="text-gray-600 text-xs">(optional)</span></label>
                    </div>
                    <div className="relative group">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <Send size={16} className="text-gray-500 group-focus-within:text-brand-400 transition-colors" />
                        </div>
                        <input
                            type="text"
                            placeholder="Bot Token from @BotFather"
                            className="w-full bg-dark-800 border border-gray-700 text-white rounded-lg py-3 pl-10 pr-4 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-all placeholder-gray-600"
                            value={config.telegramToken}
                            onChange={e => setConfig({ ...config, telegramToken: e.target.value })}
                        />
                    </div>
                    {config.telegramToken && (
                        <input
                            type="text"
                            placeholder="Your Telegram User ID"
                            className="w-full bg-dark-800 border border-gray-700 text-white rounded-lg py-3 px-4 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-all placeholder-gray-600"
                            value={config.telegramUserId}
                            onChange={e => setConfig({ ...config, telegramUserId: e.target.value })}
                        />
                    )}
                    <p className="text-xs text-gray-500">
                        Talk to <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-brand-400 hover:underline">@BotFather</a> to get a bot token.
                    </p>
                </div>

                {error && (
                    <div className="p-3 bg-red-900/20 border border-red-900/50 rounded-lg flex items-center gap-2 text-red-200 text-sm">
                        <AlertCircle size={16} className="shrink-0" />
                        {error}
                    </div>
                )}

                <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-brand-600 hover:bg-brand-500 text-white font-medium py-3 rounded-lg flex items-center justify-center gap-2 transition-all transform hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(2,132,199,0.4)]"
                >
                    {loading ? (
                        <>
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Verifying...
                        </>
                    ) : (
                        <>
                            Complete Setup <ChevronRight size={18} />
                        </>
                    )}
                </button>
            </form>
        </div>
    )
}
