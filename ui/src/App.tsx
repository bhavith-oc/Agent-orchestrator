import { useState, useEffect } from 'react'
import { LayoutDashboard, MessageSquare, MessagesSquare, Shield, Settings, Users, Activity, Menu, LogOut, Plus, Rocket, Zap, FileText } from 'lucide-react'
import { GoogleOAuthProvider } from '@react-oauth/google'
import Login from './components/Login'
import OnboardingFlow from './components/onboarding/OnboardingFlow'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { motion, AnimatePresence } from 'framer-motion'
import Dashboard from './components/Dashboard'
import Chat from './components/Chat'
import Agents from './components/Agents'
import RemoteConfig from './components/RemoteConfig'
import DeployAgent from './components/DeployAgent'
import OrchestratePanel from './components/OrchestratePanel'
import TeamChat from './components/TeamChat'
import CreateMissionModal from './components/CreateMissionModal'
import { MissionProvider, useMissions } from './context/MissionContext'
import { logout as apiLogout } from './api'

const LEGACY_LOGIN = import.meta.env.VITE_LEGACY_LOGIN === 'true'
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

const NavItem = ({ icon: Icon, label, active, onClick, collapsed }: { icon: any, label: string, active?: boolean, onClick: () => void, collapsed: boolean }) => (
    <button
        onClick={onClick}
        className={cn(
            "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group w-full relative",
            active
                ? "bg-primary/10 text-primary border border-primary/20 shadow-[0_0_15px_rgba(6,87,249,0.1)]"
                : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/50",
            collapsed ? "justify-center" : "text-left"
        )}
        title={collapsed ? label : undefined}
    >
        <Icon className={cn("w-5 h-5 transition-colors shrink-0", active ? "text-primary" : "group-hover:text-slate-100")} />
        {!collapsed && (
            <motion.span
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="font-bold text-sm tracking-tight whitespace-nowrap"
            >
                {label}
            </motion.span>
        )}
    </button>
)

// Browser flag: set window.__AETHER_LEGACY_LOGIN__ = true in DevTools console
// then reload to switch from the new Onboarding UI to the classic Login form.
declare global {
    interface Window {
        __AETHER_LEGACY_LOGIN__?: boolean
    }
}

function AppContent() {
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [activeTab, setActiveTab] = useState('deploy')
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
    const [pendingDeploymentId, setPendingDeploymentId] = useState<string | null>(null)

    // Get addMission from context
    const { addMission } = useMissions()

    // Check for existing token on mount
    useEffect(() => {
        const token = localStorage.getItem('aether_token')
        if (token) {
            setIsAuthenticated(true)
            // Always start on Deploy Agent page after login
            setActiveTab('deploy')
            localStorage.removeItem('aether_active_tab')
        }
    }, [])

    // Auto-navigate to Chat when a deployment completes from onboarding
    useEffect(() => {
        if (isAuthenticated && pendingDeploymentId) {
            setActiveTab('hub')
            // Store the deployment ID so Chat component can auto-connect
            localStorage.setItem('aether_pending_deploy', pendingDeploymentId)
            setPendingDeploymentId(null)
        }
    }, [isAuthenticated, pendingDeploymentId])

    const handleLogout = () => {
        apiLogout()
        setIsAuthenticated(false)
    }

    const handleOnboardingComplete = (deploymentId?: string) => {
        if (deploymentId) {
            setPendingDeploymentId(deploymentId)
        }
        setIsAuthenticated(true)
    }

    if (!isAuthenticated) {
        if (LEGACY_LOGIN || window.__AETHER_LEGACY_LOGIN__) {
            return <Login onLogin={() => setIsAuthenticated(true)} />
        }
        return <OnboardingFlow onComplete={handleOnboardingComplete} />
    }

    return (
        <div className="flex h-screen bg-background overflow-hidden text-slate-100 font-sans">
            {/* Sidebar */}
            <motion.aside
                initial={false}
                animate={{ width: isSidebarCollapsed ? 80 : 288 }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="border-r border-border bg-[#0f1117] flex flex-col p-4 gap-4 shrink-0 relative z-20"
            >
                <div className={cn("flex items-center gap-4 px-2 py-4", isSidebarCollapsed && "justify-center")}>
                    <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center shadow-[0_0_30px_rgba(6,87,249,0.5)] shrink-0">
                        <Shield className="text-white w-6 h-6" />
                    </div>
                    {!isSidebarCollapsed && (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="whitespace-nowrap">
                            <h1 className="text-xl font-bold font-display tracking-tightest leading-none">AETHER</h1>
                            <p className="text-[9px] text-primary font-bold tracking-[0.3em] uppercase mt-1">Orchestrator</p>
                        </motion.div>
                    )}
                </div>

                <nav className="flex flex-col gap-2 flex-1 mt-4 overflow-y-auto scrollbar-hide min-h-0">
                    <NavItem icon={Rocket} label="Deploy Agent" active={activeTab === 'deploy'} onClick={() => setActiveTab('deploy')} collapsed={isSidebarCollapsed} />
                    <NavItem icon={LayoutDashboard} label="Mission Board" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} collapsed={isSidebarCollapsed} />
                    <NavItem icon={Zap} label="Orchestrate" active={activeTab === 'orchestrate'} onClick={() => setActiveTab('orchestrate')} collapsed={isSidebarCollapsed} />
                    <NavItem icon={MessageSquare} label="Agent Hub" active={activeTab === 'hub'} onClick={() => setActiveTab('hub')} collapsed={isSidebarCollapsed} />
                    <NavItem icon={Users} label="Agents Pool" active={activeTab === 'agents'} onClick={() => setActiveTab('agents')} collapsed={isSidebarCollapsed} />
                    <NavItem icon={MessagesSquare} label="Team Chat" active={activeTab === 'teamchat'} onClick={() => setActiveTab('teamchat')} collapsed={isSidebarCollapsed} />
                </nav>

                <div className="shrink-0 pt-4 border-t border-border space-y-3">
                    <NavItem icon={Settings} label="Master Node" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} collapsed={isSidebarCollapsed} />
                    <button
                        onClick={handleLogout}
                        className={cn("flex items-center gap-3 px-4 py-3 text-red-400 hover:bg-red-500/10 rounded-xl transition-all w-full", isSidebarCollapsed ? "justify-center" : "text-left")}
                        title={isSidebarCollapsed ? "Logout" : undefined}
                    >
                        <LogOut className="w-5 h-5 shrink-0" />
                        {!isSidebarCollapsed && <span className="font-bold text-sm tracking-tight whitespace-nowrap">Logout</span>}
                    </button>
                    <a
                        href="/docs.html"
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn(
                            "flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-bold transition-all border border-border",
                            isSidebarCollapsed ? "justify-center" : ""
                        )}
                        title={isSidebarCollapsed ? "Documentation" : undefined}
                    >
                        <FileText className="w-4 h-4 shrink-0" />
                        {!isSidebarCollapsed && <span>Docs</span>}
                    </a>
                </div>
            </motion.aside>

            {/* Main Content */}
            <main className="flex-1 flex flex-col relative overflow-hidden bg-[#0a0c10]">
                {/* Decorative elements */}
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary/5 blur-[150px] rounded-full -mr-48 -mt-48 pointer-events-none" />

                {/* Header */}
                <header className="h-24 border-b border-border flex items-center justify-between px-10 bg-[#0f1117]/80 backdrop-blur-xl sticky top-0 z-10 shrink-0">
                    <div className="flex items-center gap-6">
                        {/* Hamburger Menu Toggle */}
                        <button
                            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                            className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
                        >
                            <Menu className="w-6 h-6" />
                        </button>

                        <div>
                            <div className="flex items-center gap-3 text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-1">
                                <span className="w-2 h-2 rounded-full bg-primary" />
                                Live Interface
                            </div>
                            <h2 className="text-3xl font-bold font-display capitalize tracking-tight">
                                {activeTab === 'dashboard' ? 'Strategic Overview' : activeTab === 'hub' ? 'Agent Hub' : activeTab === 'agents' ? 'Agents Pool' : activeTab === 'deploy' ? 'Deploy Agent' : activeTab === 'orchestrate' ? 'Orchestrate' : activeTab === 'teamchat' ? 'Team Chat' : activeTab === 'settings' ? 'Master Node Deployment' : activeTab}
                            </h2>
                        </div>
                    </div>

                    <div className="flex items-center gap-6">

                        <div className="flex items-center gap-3">
                            <div className="text-right hidden sm:block">
                                <p className="text-sm font-bold">Bhavith</p>
                                <p className="text-[10px] text-slate-500 font-medium">Session: 00427-A</p>
                            </div>
                            <div className="w-12 h-12 rounded-2xl border border-border bg-card flex items-center justify-center group cursor-pointer hover:border-primary/50 transition-all">
                                <span className="text-sm font-black group-hover:text-primary transition-colors">AD</span>
                            </div>
                        </div>
                    </div>
                </header>

                {/* Content Area */}
                <div className="flex-1 overflow-y-auto p-10 scrollbar-hide relative z-0">
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={activeTab}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.2 }}
                            className="h-full"
                        >
                            {activeTab === 'dashboard' && <Dashboard />}
                            {activeTab === 'hub' && <Chat />}
                            {activeTab === 'agents' && <Agents />}
                            {activeTab === 'deploy' && <DeployAgent />}
                            {activeTab === 'orchestrate' && <OrchestratePanel />}
                            {activeTab === 'teamchat' && <TeamChat />}
                            {activeTab === 'settings' && <RemoteConfig />}
                        </motion.div>
                    </AnimatePresence>
                </div>
            </main>

            <CreateMissionModal
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
                onSubmit={addMission}
            />
        </div>
    )
}

export default function App() {
    const content = (
        <MissionProvider>
            <AppContent />
        </MissionProvider>
    )

    // Only wrap with GoogleOAuthProvider when a client ID is configured
    if (GOOGLE_CLIENT_ID) {
        return (
            <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
                {content}
            </GoogleOAuthProvider>
        )
    }

    return content
}
