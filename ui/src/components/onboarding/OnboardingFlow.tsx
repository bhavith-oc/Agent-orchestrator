import { useState, lazy, Suspense } from 'react'
import { ArrowRight, Bot, Check, Terminal, Loader2, MessageSquare } from 'lucide-react'
import Visuals from './Visuals'
import InstallationView from './InstallationView'
import ConfigForm, { BotConfig } from './ConfigForm'
import DeploymentProgress from './DeploymentProgress'
import { configureDeploy, launchDeploy, googleLogin, DeploymentInfo } from '../../api'

const HAS_GOOGLE = !!(import.meta.env.VITE_GOOGLE_CLIENT_ID)

// Lazy-load GoogleAuthButton so @react-oauth/google is never imported when no provider exists
const LazyGoogleAuthButton = lazy(() => import('./GoogleAuthButton'))

enum SetupPhase {
    AUTH = 'AUTH',
    INSTALLING = 'INSTALLING',
    CONFIGURATION = 'CONFIGURATION',
    DEPLOYING = 'DEPLOYING',
    COMPLETE = 'COMPLETE',
}

interface OnboardingFlowProps {
    onComplete: (deploymentId?: string) => void
}

export default function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
    // Skip AUTH phase when Google OAuth is not configured
    const [phase, setPhase] = useState<SetupPhase>(HAS_GOOGLE ? SetupPhase.AUTH : SetupPhase.INSTALLING)
    const [finalConfig, setFinalConfig] = useState<BotConfig | null>(null)
    const [deploymentId, setDeploymentId] = useState<string | null>(null)
    const [deployResult, setDeployResult] = useState<DeploymentInfo | null>(null)
    const [authLoading, setAuthLoading] = useState(false)
    const [authError, setAuthError] = useState<string | null>(null)
    const [deployError, setDeployError] = useState<string | null>(null)

    const handleGoogleSuccess = async (accessToken: string) => {
        setAuthLoading(true)
        setAuthError(null)
        try {
            await googleLogin(accessToken)
            setPhase(SetupPhase.INSTALLING)
        } catch (err: any) {
            const detail = err?.response?.data?.detail || err.message || 'Google authentication failed'
            setAuthError(detail)
        } finally {
            setAuthLoading(false)
        }
    }

    const handleInstallationComplete = () => {
        setPhase(SetupPhase.CONFIGURATION)
    }

    const handleConfigComplete = async (config: BotConfig) => {
        setFinalConfig(config)
        setDeployError(null)

        try {
            // Map config to DeployConfigureRequest format
            const deployReq = {
                openrouter_api_key: config.llmProvider === 'openrouter' ? config.apiKey : config.apiKey,
                openai_api_key: config.llmProvider === 'openai' ? config.apiKey : undefined,
                anthropic_api_key: config.llmProvider === 'anthropic' ? config.apiKey : undefined,
                telegram_bot_token: config.telegramToken || undefined,
                telegram_user_id: config.telegramUserId || undefined,
            }

            // Step 1: Configure deployment
            const configResult = await configureDeploy(deployReq)

            // Step 2: Launch deployment (async — container starts in background)
            await launchDeploy(configResult.deployment_id)

            // Step 3: Transition to DEPLOYING phase with real log polling
            setDeploymentId(configResult.deployment_id)
            setPhase(SetupPhase.DEPLOYING)
        } catch (err: any) {
            const detail = err?.response?.data?.detail || err.message || 'Deployment failed'
            setDeployError(detail)
            setPhase(SetupPhase.CONFIGURATION)
        }
    }

    const handleDeployComplete = (info: DeploymentInfo) => {
        setDeployResult(info)
        setPhase(SetupPhase.COMPLETE)
    }

    const handleDeployError = (msg: string) => {
        setDeployError(msg)
    }

    return (
        <div className="flex flex-col lg:flex-row h-screen w-full bg-black overflow-hidden font-sans">

            {/* Left Panel - Visuals */}
            <div className={`
                relative lg:w-1/2 w-full h-64 lg:h-full transition-all duration-1000 ease-in-out
                ${phase === SetupPhase.COMPLETE ? 'lg:w-full' : ''}
            `}>
                <Visuals />

                {/* Success Overlay for Complete State */}
                {phase === SetupPhase.COMPLETE && (
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-20 flex flex-col items-center justify-center">
                        <div className="w-24 h-24 bg-green-500/20 rounded-full flex items-center justify-center mb-6 shadow-[0_0_30px_rgba(34,197,94,0.4)]">
                            <Check size={48} className="text-green-500" />
                        </div>
                        <h2 className="text-4xl font-bold text-white mb-2">Agent Online</h2>
                        <p className="text-gray-400 mb-8">
                            Your autonomous agent is deployed and running
                            {finalConfig?.telegramToken ? ' on Telegram.' : '.'}
                        </p>

                        <div className="bg-dark-800 border border-gray-800 rounded-lg p-6 max-w-md w-full">
                            <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-800">
                                <div className="p-2 bg-brand-900/30 rounded text-brand-400">
                                    <Bot size={20} />
                                </div>
                                <div>
                                    <div className="text-sm font-medium text-white">Agent Status</div>
                                    <div className="text-xs text-green-400 flex items-center gap-1">
                                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                                        Active
                                    </div>
                                </div>
                            </div>
                            <div className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-gray-500">Provider</span>
                                    <span className="text-gray-300 font-mono uppercase">{finalConfig?.llmProvider}</span>
                                </div>
                                {deployResult?.port && (
                                    <div className="flex justify-between">
                                        <span className="text-gray-500">Port</span>
                                        <span className="text-gray-300 font-mono">{deployResult.port}</span>
                                    </div>
                                )}
                                {deployResult?.deployment_id && (
                                    <div className="flex justify-between">
                                        <span className="text-gray-500">ID</span>
                                        <span className="text-gray-300 font-mono text-xs">{deployResult.deployment_id}</span>
                                    </div>
                                )}
                                <div className="flex justify-between">
                                    <span className="text-gray-500">Telegram</span>
                                    <span className={`font-mono ${finalConfig?.telegramToken ? 'text-brand-400' : 'text-gray-600'}`}>
                                        {finalConfig?.telegramToken ? 'Connected' : 'Not configured'}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={() => onComplete(deploymentId || undefined)}
                            className="mt-8 bg-brand-600 hover:bg-brand-500 text-white font-medium px-6 py-3 rounded-lg flex items-center gap-2 transition-all transform hover:scale-[1.02] shadow-[0_0_20px_rgba(2,132,199,0.4)]"
                        >
                            <MessageSquare size={18} /> Open Chat Session
                        </button>
                        <button
                            onClick={() => onComplete()}
                            className="mt-3 text-gray-500 hover:text-white transition-colors text-sm flex items-center gap-2"
                        >
                            Go to Dashboard <ArrowRight size={14} />
                        </button>
                    </div>
                )}
            </div>

            {/* Right Panel - Logic */}
            {phase !== SetupPhase.COMPLETE && (
                <div className="lg:w-1/2 w-full h-full bg-dark-900 flex flex-col relative z-10 border-l border-gray-800 shadow-2xl">
                    {/* Header / Brand on mobile */}
                    <div className="p-6 lg:hidden">
                        <h1 className="text-xl font-bold text-white">Aether Orchestrator</h1>
                    </div>

                    <div className="flex-1 flex flex-col justify-center px-8 lg:px-20 py-12">

                        {/* View 1: Auth */}
                        {phase === SetupPhase.AUTH && (
                            <div className="space-y-8">
                                <div className="space-y-4">
                                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-900/30 border border-brand-500/30 text-brand-300 text-xs font-medium">
                                        <Terminal size={12} />
                                        <span>v1.0.0 Stable</span>
                                    </div>
                                    <h2 className="text-4xl font-bold text-white tracking-tight">Deploy your agent.</h2>
                                    <p className="text-gray-400 text-lg leading-relaxed">
                                        One-click infrastructure for autonomous AI agents.
                                        Securely authenticated via Google.
                                    </p>
                                </div>

                                <div className="space-y-4 pt-4">
                                    {authLoading ? (
                                        <div className="w-full h-12 rounded-lg flex items-center justify-center gap-3 bg-gray-800 border border-gray-700">
                                            <Loader2 size={20} className="animate-spin text-gray-400" />
                                            <span className="text-gray-400 text-sm">Authenticating...</span>
                                        </div>
                                    ) : (
                                        <Suspense fallback={<div className="w-full h-12 rounded-lg bg-gray-800 animate-pulse" />}>
                                            <LazyGoogleAuthButton
                                                onSuccess={handleGoogleSuccess}
                                                onError={(msg: string) => setAuthError(msg)}
                                            />
                                        </Suspense>
                                    )}

                                    {authError && (
                                        <div className="p-3 bg-red-900/20 border border-red-900/50 rounded-lg text-red-200 text-sm text-center">
                                            {authError}
                                        </div>
                                    )}

                                    <p className="text-xs text-center text-gray-500">
                                        By continuing, you agree to our Terms of Service.
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* View 2: Installation Progress */}
                        {phase === SetupPhase.INSTALLING && (
                            <InstallationView onComplete={handleInstallationComplete} />
                        )}

                        {/* View 3: Configuration */}
                        {phase === SetupPhase.CONFIGURATION && (
                            <div className="space-y-4">
                                <ConfigForm onComplete={handleConfigComplete} />
                                {deployError && (
                                    <div className="max-w-md mx-auto p-3 bg-red-900/20 border border-red-900/50 rounded-lg text-red-200 text-sm">
                                        Deployment failed: {deployError}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* View 4: Deploying — real container logs */}
                        {phase === SetupPhase.DEPLOYING && deploymentId && (
                            <DeploymentProgress
                                deploymentId={deploymentId}
                                onComplete={handleDeployComplete}
                                onError={handleDeployError}
                            />
                        )}
                    </div>

                    {/* Footer */}
                    <div className="p-6 border-t border-gray-800 flex items-center justify-between">
                        <div>
                            <p className="text-xs text-gray-600 font-mono">AETHER ORCHESTRATOR</p>
                            <p className="text-xs text-gray-700 font-mono mt-1">Powered by One Convergence Devices</p>
                        </div>
                        <a href="/docs.html" target="_blank" rel="noopener noreferrer" className="text-xs text-gray-600 hover:text-brand-400 font-mono transition-colors">
                            Docs
                        </a>
                    </div>
                </div>
            )}
        </div>
    )
}
