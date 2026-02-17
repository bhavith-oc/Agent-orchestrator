import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
    Rocket, Key, Eye, EyeOff, RefreshCw, CheckCircle2, AlertCircle,
    Server, Square, Play, ScrollText, Copy, Check, MessageCircle, Phone,
    Cpu, Zap, ChevronDown, ChevronRight
} from 'lucide-react'
import {
    configureDeploy, launchDeploy, stopDeploy,
    fetchDeployStatus, fetchDeployLogs, fetchDeployList,
    type DeployResult, type DeploymentInfo
} from '../api'

// --- Toast ---
function Toast({ message, type, onClose }: { message: string; type: 'success' | 'error'; onClose: () => void }) {
    useEffect(() => { const t = setTimeout(onClose, 5000); return () => clearTimeout(t) }, [onClose])
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-bold shadow-lg ${type === 'success' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'}`}
        >
            {type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {message}
        </motion.div>
    )
}

// --- Section ---
function Section({ title, icon: Icon, children, defaultOpen = true, badge }: {
    title: string; icon: any; children: React.ReactNode; defaultOpen?: boolean; badge?: string
}) {
    const [open, setOpen] = useState(defaultOpen)
    return (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-3 px-5 py-4 hover:bg-slate-800/50 transition-colors">
                <Icon className="w-5 h-5 text-primary" />
                <span className="font-bold text-sm flex-1 text-left">{title}</span>
                {badge && <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-bold">{badge}</span>}
                {open ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
            </button>
            {open && <div className="px-5 pb-5 border-t border-border pt-4">{children}</div>}
        </div>
    )
}

// --- Field ---
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
    return (
        <div>
            <label className="block text-xs font-bold text-slate-300 mb-1.5">{label}</label>
            {children}
            {hint && <p className="text-[10px] text-slate-600 mt-1">{hint}</p>}
        </div>
    )
}

// --- Styles ---
const inputClass = "w-full px-3 py-2 rounded-xl bg-slate-900 border border-border text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50 transition-all disabled:opacity-50"
const btnPrimary = "flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-white text-sm font-bold shadow-[0_0_15px_rgba(6,87,249,0.3)] hover:shadow-[0_0_25px_rgba(6,87,249,0.5)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
const btnDanger = "flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-400 text-sm font-bold border border-red-500/30 transition-all disabled:opacity-50"
const btnSecondary = "flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-bold border border-border transition-all"

export default function DeployAgent() {
    // LLM Provider selection
    const [llmProvider, setLlmProvider] = useState<'openrouter' | 'runpod' | 'custom'>('openrouter')
    
    // Form state — OpenRouter
    const [openrouterKey, setOpenrouterKey] = useState('')
    const [showOpenrouterKey, setShowOpenrouterKey] = useState(false)

    // Form state — RunPod
    const [runpodApiKey, setRunpodApiKey] = useState('')
    const [showRunpodApiKey, setShowRunpodApiKey] = useState(false)
    const [runpodEndpointId, setRunpodEndpointId] = useState('')
    const [runpodModelName, setRunpodModelName] = useState('')

    // Form state — Custom
    const [customBaseUrl, setCustomBaseUrl] = useState('')
    const [customApiKey, setCustomApiKey] = useState('')
    const [showCustomApiKey, setShowCustomApiKey] = useState(false)
    const [customModelName, setCustomModelName] = useState('')

    // Form state — Optional LLM (fallback keys)
    const [anthropicKey, setAnthropicKey] = useState('')
    const [showAnthropicKey, setShowAnthropicKey] = useState(false)
    const [openaiKey, setOpenaiKey] = useState('')
    const [showOpenaiKey, setShowOpenaiKey] = useState(false)

    // Form state — Optional Telegram
    const [telegramToken, setTelegramToken] = useState('')
    const [showTelegramToken, setShowTelegramToken] = useState(false)
    const [telegramUserId, setTelegramUserId] = useState('')

    // Form state — Optional WhatsApp
    const [whatsappNumber, setWhatsappNumber] = useState('')

    // Deploy state
    const [configuring, setConfiguring] = useState(false)
    const [launching, setLaunching] = useState(false)
    const [stopping, setStopping] = useState(false)
    const [deployResult, setDeployResult] = useState<DeployResult | null>(null)
    const [deployments, setDeployments] = useState<DeploymentInfo[]>([])
    const [logs, setLogs] = useState<string>('')
    const [showLogs, setShowLogs] = useState(false)
    const [copied, setCopied] = useState<string | null>(null)

    // Toast
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

    // Load existing deployments on mount
    useEffect(() => {
        loadDeployments()
    }, [])

    const loadDeployments = async () => {
        try {
            const list = await fetchDeployList()
            setDeployments(list)
        } catch { /* ignore */ }
    }

    const copyToClipboard = (text: string, label: string) => {
        navigator.clipboard.writeText(text)
        setCopied(label)
        setTimeout(() => setCopied(null), 2000)
    }

    // --- Configure + Launch (two-step) ---
    const handleDeploy = async () => {
        // Validate based on selected provider
        if (llmProvider === 'openrouter' && !openrouterKey) {
            setToast({ message: 'OpenRouter API key is required', type: 'error' })
            return
        }
        if (llmProvider === 'runpod' && (!runpodApiKey || !runpodEndpointId || !runpodModelName)) {
            setToast({ message: 'RunPod API Key, Endpoint ID, and Model Name are required', type: 'error' })
            return
        }
        if (llmProvider === 'custom' && (!customBaseUrl || !customApiKey || !customModelName)) {
            setToast({ message: 'Custom Base URL, API Key, and Model Name are required', type: 'error' })
            return
        }
        if (telegramToken && !telegramUserId) {
            setToast({ message: 'Telegram User ID is required when Bot Token is set', type: 'error' })
            return
        }

        // Step 1: Configure
        setConfiguring(true)
        try {
            const configPayload: any = {
                telegram_bot_token: telegramToken || undefined,
                telegram_user_id: telegramUserId || undefined,
                whatsapp_number: whatsappNumber || undefined,
            }

            // Add provider-specific keys
            if (llmProvider === 'openrouter') {
                configPayload.openrouter_api_key = openrouterKey
                configPayload.anthropic_api_key = anthropicKey || undefined
                configPayload.openai_api_key = openaiKey || undefined
            } else if (llmProvider === 'runpod') {
                configPayload.runpod_api_key = runpodApiKey
                configPayload.runpod_endpoint_id = runpodEndpointId
                configPayload.runpod_model_name = runpodModelName
            } else if (llmProvider === 'custom') {
                configPayload.custom_llm_base_url = customBaseUrl
                configPayload.custom_llm_api_key = customApiKey
                configPayload.custom_llm_model_name = customModelName
            }

            const result = await configureDeploy(configPayload)
            setDeployResult(result)
            setToast({ message: `Configured! Port: ${result.port}. Launching...`, type: 'success' })

            // Step 2: Launch
            setConfiguring(false)
            setLaunching(true)
            const launchResult = await launchDeploy(result.deployment_id)
            setDeployResult(launchResult)
            setToast({ message: launchResult.message, type: 'success' })
            await loadDeployments()
        } catch (e: any) {
            setToast({ message: `Deploy failed: ${e.response?.data?.detail || e.message}`, type: 'error' })
        } finally {
            setConfiguring(false)
            setLaunching(false)
        }
    }

    const handleStop = async (deploymentId: string) => {
        setStopping(true)
        try {
            await stopDeploy(deploymentId)
            setToast({ message: 'Container stopped', type: 'success' })
            if (deployResult?.deployment_id === deploymentId) {
                setDeployResult(prev => prev ? { ...prev, status: 'stopped' } : null)
            }
            await loadDeployments()
        } catch (e: any) {
            setToast({ message: `Stop failed: ${e.response?.data?.detail || e.message}`, type: 'error' })
        } finally {
            setStopping(false)
        }
    }

    const handleViewLogs = async (deploymentId: string) => {
        try {
            const result = await fetchDeployLogs(deploymentId, 80)
            setLogs(result.logs)
            setShowLogs(true)
        } catch (e: any) {
            setToast({ message: `Failed to fetch logs: ${e.response?.data?.detail || e.message}`, type: 'error' })
        }
    }

    const isDeploying = configuring || launching

    return (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6 max-w-4xl">
            {/* Header */}
            <div>
                <h3 className="text-xl font-bold font-display">Deploy OpenClaw Agent</h3>
                <p className="text-xs text-slate-500 mt-1">
                    One-click deployment. Fill in your API keys, click Deploy — a Docker container launches with your configured OpenClaw agent.
                    <span className="text-slate-600 ml-1">PORT and Gateway Token are auto-generated.</span>
                </p>
            </div>

            {/* Section 1: LLM Configuration with Provider Selection */}
            <Section title="LLM Configuration" icon={Key} defaultOpen={true} badge="required">
                <div className="space-y-4">
                    {/* Provider selector tabs */}
                    <div className="flex gap-2 flex-wrap">
                        <button
                            onClick={() => setLlmProvider('openrouter')}
                            disabled={isDeploying}
                            className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all ${
                                llmProvider === 'openrouter'
                                    ? 'bg-primary/10 border-primary/40 text-primary shadow-[0_0_10px_rgba(6,87,249,0.2)]'
                                    : 'bg-slate-900 border-border text-slate-400 hover:border-slate-600'
                            }`}
                        >
                            OpenRouter
                        </button>
                        <button
                            onClick={() => setLlmProvider('runpod')}
                            disabled={isDeploying}
                            className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all ${
                                llmProvider === 'runpod'
                                    ? 'bg-primary/10 border-primary/40 text-primary shadow-[0_0_10px_rgba(6,87,249,0.2)]'
                                    : 'bg-slate-900 border-border text-slate-400 hover:border-slate-600'
                            }`}
                        >
                            RunPod Serverless
                        </button>
                        <button
                            onClick={() => setLlmProvider('custom')}
                            disabled={isDeploying}
                            className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all ${
                                llmProvider === 'custom'
                                    ? 'bg-primary/10 border-primary/40 text-primary shadow-[0_0_10px_rgba(6,87,249,0.2)]'
                                    : 'bg-slate-900 border-border text-slate-400 hover:border-slate-600'
                            }`}
                        >
                            Custom / Ollama
                        </button>
                    </div>

                    {/* OpenRouter fields */}
                    {llmProvider === 'openrouter' && (
                        <>
                            <Field label="OpenRouter API Key" hint="Required. Get one at openrouter.ai/keys">
                                <div className="relative">
                                    <input
                                        type={showOpenrouterKey ? 'text' : 'password'}
                                        value={openrouterKey}
                                        onChange={e => setOpenrouterKey(e.target.value)}
                                        placeholder="sk-or-v1-..."
                                        className={inputClass}
                                        disabled={isDeploying}
                                    />
                                    <button
                                        onClick={() => setShowOpenrouterKey(!showOpenrouterKey)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                                    >
                                        {showOpenrouterKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                            </Field>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <Field label="Anthropic API Key" hint="Optional — enables Claude as fallback">
                                    <div className="relative">
                                        <input
                                            type={showAnthropicKey ? 'text' : 'password'}
                                            value={anthropicKey}
                                            onChange={e => setAnthropicKey(e.target.value)}
                                            placeholder="sk-ant-..."
                                            className={inputClass}
                                            disabled={isDeploying}
                                        />
                                        <button
                                            onClick={() => setShowAnthropicKey(!showAnthropicKey)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                                        >
                                            {showAnthropicKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                        </button>
                                    </div>
                        </Field>
                        <Field label="OpenAI API Key" hint="Optional — enables GPT as fallback model">
                            <div className="relative">
                                <input
                                    type={showOpenaiKey ? 'text' : 'password'}
                                    value={openaiKey}
                                    onChange={e => setOpenaiKey(e.target.value)}
                                    placeholder="sk-..."
                                    className={inputClass}
                                    disabled={isDeploying}
                                />
                                <button
                                    onClick={() => setShowOpenaiKey(!showOpenaiKey)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                                >
                                    {showOpenaiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                </button>
                            </div>
                        </Field>
                    </div>
                        </>
                    )}

                    {/* RunPod fields */}
                    {llmProvider === 'runpod' && (
                        <>
                            <div className="text-[11px] text-slate-400 bg-slate-900/50 rounded-xl px-4 py-3 border border-border space-y-1">
                                <p className="font-bold text-slate-300">RunPod Setup:</p>
                                <p>1. Create a Serverless Endpoint at <a href="https://www.runpod.io/console/serverless" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">runpod.io/console/serverless</a></p>
                                <p>2. Use the vLLM Worker template with your chosen model</p>
                                <p>3. Copy the Endpoint ID from the dashboard</p>
                                <p>4. Get your API Key from <a href="https://www.runpod.io/console/user/settings" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Settings → API Keys</a></p>
                            </div>

                            <Field label="RunPod API Key" hint="Required. Get from RunPod Settings → API Keys">
                                <div className="relative">
                                    <input
                                        type={showRunpodApiKey ? 'text' : 'password'}
                                        value={runpodApiKey}
                                        onChange={e => setRunpodApiKey(e.target.value)}
                                        placeholder="rpa_..."
                                        className={inputClass}
                                        disabled={isDeploying}
                                    />
                                    <button
                                        onClick={() => setShowRunpodApiKey(!showRunpodApiKey)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                                    >
                                        {showRunpodApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                            </Field>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <Field label="Endpoint ID" hint="From your RunPod dashboard URL">
                                    <input
                                        type="text"
                                        value={runpodEndpointId}
                                        onChange={e => setRunpodEndpointId(e.target.value)}
                                        placeholder="abc123def456"
                                        className={inputClass}
                                        disabled={isDeploying}
                                    />
                                </Field>
                                <Field label="Model Name" hint="HuggingFace model ID">
                                    <input
                                        type="text"
                                        value={runpodModelName}
                                        onChange={e => setRunpodModelName(e.target.value)}
                                        placeholder="mistralai/Mistral-7B-Instruct-v0.2"
                                        className={inputClass}
                                        disabled={isDeploying}
                                    />
                                </Field>
                            </div>
                        </>
                    )}

                    {/* Custom provider fields */}
                    {llmProvider === 'custom' && (
                        <>
                            <div className="text-[11px] text-slate-400 bg-slate-900/50 rounded-xl px-4 py-3 border border-border">
                                <p className="font-bold text-slate-300 mb-1">Custom OpenAI-Compatible Endpoint</p>
                                <p>Works with Ollama (http://localhost:11434/v1), LM Studio, Together AI, Groq, or any vLLM server.</p>
                            </div>

                            <Field label="Base URL" hint="OpenAI-compatible endpoint URL">
                                <input
                                    type="text"
                                    value={customBaseUrl}
                                    onChange={e => setCustomBaseUrl(e.target.value)}
                                    placeholder="http://localhost:11434/v1"
                                    className={inputClass}
                                    disabled={isDeploying}
                                />
                            </Field>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <Field label="API Key" hint="Your API key (use 'ollama' for Ollama)">
                                    <div className="relative">
                                        <input
                                            type={showCustomApiKey ? 'text' : 'password'}
                                            value={customApiKey}
                                            onChange={e => setCustomApiKey(e.target.value)}
                                            placeholder="your-api-key"
                                            className={inputClass}
                                            disabled={isDeploying}
                                        />
                                        <button
                                            onClick={() => setShowCustomApiKey(!showCustomApiKey)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                                        >
                                            {showCustomApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                        </button>
                                    </div>
                                </Field>
                                <Field label="Model Name" hint="Model identifier">
                                    <input
                                        type="text"
                                        value={customModelName}
                                        onChange={e => setCustomModelName(e.target.value)}
                                        placeholder="llama3"
                                        className={inputClass}
                                        disabled={isDeploying}
                                    />
                                </Field>
                            </div>
                        </>
                    )}
                </div>
            </Section>

            {/* Section 2: Optional — Telegram */}
            <Section title="Telegram Integration" icon={MessageCircle} defaultOpen={false} badge="optional">
                <p className="text-xs text-slate-500 mb-3">
                    Connect a Telegram bot to chat with your agent. Leave blank to skip.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Field label="Telegram Bot Token" hint="From @BotFather">
                        <div className="relative">
                            <input
                                type={showTelegramToken ? 'text' : 'password'}
                                value={telegramToken}
                                onChange={e => setTelegramToken(e.target.value)}
                                placeholder="123456789:AABBcc..."
                                className={inputClass}
                                disabled={isDeploying}
                            />
                            <button
                                onClick={() => setShowTelegramToken(!showTelegramToken)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                            >
                                {showTelegramToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                        </div>
                    </Field>
                    <Field label="Telegram User ID" hint={telegramToken ? 'Required when bot token is set' : 'Your numeric Telegram user ID'}>
                        <input
                            type="text"
                            value={telegramUserId}
                            onChange={e => setTelegramUserId(e.target.value.replace(/\D/g, ''))}
                            placeholder="123456789"
                            className={inputClass}
                            disabled={isDeploying}
                        />
                    </Field>
                </div>
            </Section>

            {/* Section 3: Optional — WhatsApp */}
            <Section title="WhatsApp Integration" icon={Phone} defaultOpen={false} badge="optional">
                <p className="text-xs text-slate-500 mb-3">
                    Connect WhatsApp to chat with your agent. Leave blank to skip.
                </p>
                <Field label="WhatsApp Number" hint="International format with country code">
                    <input
                        type="text"
                        value={whatsappNumber}
                        onChange={e => setWhatsappNumber(e.target.value)}
                        placeholder="+1234567890"
                        className={inputClass}
                        disabled={isDeploying}
                    />
                </Field>
            </Section>

            {/* Deploy Button */}
            <div className="flex items-center gap-4">
                <button
                    onClick={handleDeploy}
                    disabled={isDeploying || !openrouterKey}
                    className={btnPrimary + " text-base px-8 py-3"}
                >
                    {configuring ? (
                        <><RefreshCw className="w-5 h-5 animate-spin" /> Configuring...</>
                    ) : launching ? (
                        <><RefreshCw className="w-5 h-5 animate-spin" /> Launching Container...</>
                    ) : (
                        <><Rocket className="w-5 h-5" /> Deploy Agent</>
                    )}
                </button>
                <div className="text-[10px] text-slate-600">
                    <Zap className="w-3 h-3 inline mr-1" />
                    Auto-generates: random port + secure gateway token
                </div>
            </div>

            {/* Deploy Result */}
            {deployResult && (
                <Section title="Deployment Info" icon={Server} defaultOpen={true} badge={deployResult.status}>
                    <div className="space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="p-3 rounded-lg bg-slate-900 border border-border">
                                <p className="text-[10px] text-slate-500 mb-1">Deployment ID</p>
                                <div className="flex items-center gap-2">
                                    <code className="text-sm text-slate-300 font-mono">{deployResult.deployment_id}</code>
                                    <button onClick={() => copyToClipboard(deployResult.deployment_id, 'id')} className="text-slate-500 hover:text-slate-300">
                                        {copied === 'id' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                    </button>
                                </div>
                            </div>
                            <div className="p-3 rounded-lg bg-slate-900 border border-border">
                                <p className="text-[10px] text-slate-500 mb-1">Port</p>
                                <code className="text-sm text-emerald-400 font-mono">{deployResult.port}</code>
                            </div>
                            <div className="p-3 rounded-lg bg-slate-900 border border-border">
                                <p className="text-[10px] text-slate-500 mb-1">Gateway Token</p>
                                <div className="flex items-center gap-2">
                                    <code className="text-sm text-amber-400 font-mono truncate max-w-[200px]">{deployResult.gateway_token}</code>
                                    <button onClick={() => copyToClipboard(deployResult.gateway_token, 'token')} className="text-slate-500 hover:text-slate-300">
                                        {copied === 'token' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                    </button>
                                </div>
                            </div>
                            <div className="p-3 rounded-lg bg-slate-900 border border-border">
                                <p className="text-[10px] text-slate-500 mb-1">Connect URL</p>
                                <div className="flex items-center gap-2">
                                    <code className="text-sm text-primary font-mono">ws://localhost:{deployResult.port}</code>
                                    <button onClick={() => copyToClipboard(`ws://localhost:${deployResult.port}`, 'url')} className="text-slate-500 hover:text-slate-300">
                                        {copied === 'url' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                    </button>
                                </div>
                            </div>
                        </div>

                        <p className="text-xs text-slate-500">
                            Go to <span className="text-primary font-bold">Remote Config</span> and connect using the URL and token above.
                        </p>

                        <div className="flex gap-3 pt-1">
                            {deployResult.status === 'running' && (
                                <button onClick={() => handleStop(deployResult.deployment_id)} disabled={stopping} className={btnDanger}>
                                    {stopping ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4" />}
                                    Stop
                                </button>
                            )}
                            <button onClick={() => handleViewLogs(deployResult.deployment_id)} className={btnSecondary}>
                                <ScrollText className="w-4 h-4" /> Logs
                            </button>
                        </div>
                    </div>
                </Section>
            )}

            {/* Logs Panel */}
            {showLogs && logs && (
                <div className="rounded-2xl border border-border bg-card overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                        <div className="flex items-center gap-2">
                            <ScrollText className="w-4 h-4 text-primary" />
                            <span className="text-sm font-bold">Container Logs</span>
                        </div>
                        <button onClick={() => setShowLogs(false)} className="text-xs text-slate-500 hover:text-slate-300">Close</button>
                    </div>
                    <pre className="p-4 text-[11px] font-mono text-slate-400 bg-slate-950 overflow-auto max-h-64 whitespace-pre-wrap">
                        {logs}
                    </pre>
                </div>
            )}

            {/* Active Deployments (running only) */}
            {deployments.filter(d => d.status === 'running').length > 0 && (
                <Section title="Active Deployments" icon={Cpu} defaultOpen={true} badge={String(deployments.filter(d => d.status === 'running').length)}>
                    <div className="space-y-2">
                        {deployments.filter(d => d.status === 'running').map(d => (
                            <div key={d.deployment_id} className="flex items-center gap-3 p-3 rounded-lg bg-slate-900 border border-emerald-500/20">
                                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                                <code className="text-xs font-mono text-slate-300">{d.deployment_id}</code>
                                <span className="text-[10px] text-slate-500">port {d.port}</span>
                                <span className="text-[10px] font-bold text-emerald-400">running</span>
                                <div className="flex-1" />
                                <button onClick={() => handleStop(d.deployment_id)} className="text-xs text-red-400 hover:text-red-300">Stop</button>
                                <button onClick={() => handleViewLogs(d.deployment_id)} className="text-xs text-slate-400 hover:text-slate-300">Logs</button>
                            </div>
                        ))}
                    </div>
                </Section>
            )}

            {/* Inactive Deployments (stopped/failed/configured) */}
            {deployments.filter(d => d.status !== 'running').length > 0 && (
                <Section title="Inactive Deployments" icon={Server} defaultOpen={false} badge={String(deployments.filter(d => d.status !== 'running').length)}>
                    <div className="space-y-2">
                        {deployments.filter(d => d.status !== 'running').map(d => (
                            <div key={d.deployment_id} className="flex items-center gap-3 p-3 rounded-lg bg-slate-900/50 border border-border opacity-70">
                                <div className={`w-2 h-2 rounded-full ${d.status === 'stopped' ? 'bg-slate-500' : d.status === 'failed' ? 'bg-red-500' : 'bg-amber-400'}`} />
                                <code className="text-xs font-mono text-slate-400">{d.deployment_id}</code>
                                <span className="text-[10px] text-slate-600">port {d.port}</span>
                                <span className={`text-[10px] font-bold ${d.status === 'failed' ? 'text-red-400' : 'text-slate-500'}`}>{d.status}</span>
                                <div className="flex-1" />
                                <button onClick={() => handleViewLogs(d.deployment_id)} className="text-xs text-slate-500 hover:text-slate-300">Logs</button>
                            </div>
                        ))}
                    </div>
                </Section>
            )}

            {/* Toast */}
            {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
        </motion.div>
    )
}
