import { Suspense, lazy, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ConvertPage } from '@/components/ConvertPage'
import { DropOverlay } from '@/components/DropZone'
import { IconSettings } from '@/components/icons'
import { Popover, RoundButton, Segmented, Select, Toggle } from '@/components/ui'
import { useQueue } from '@/hooks/useQueue'
import { useWindowDrop } from '@/hooks/useWindowDrop'
import { FALLBACK_CONFIG, fetchConfig, type ServerConfig } from '@/lib/api'
import { INITIAL_LAB_STATE, type LabState } from '@/lib/labState'
import { useSettings, type ProcessingPreference, type Settings, type ThemePreference } from '@/lib/settings'
import { cn } from '@/lib/utils'
import { isActive } from '@/types'

const ColorLab = lazy(() => import('@/components/ColorLab').then((m) => ({ default: m.ColorLab })))

type Tab = 'convert' | 'lab'
type ServerState = 'checking' | 'ok' | 'error'
const TAB_KEY = 'convertisseur_tab'
const MB = 1024 * 1024

function App() {
    const [settings, updateSettings] = useSettings()
    const [config, setConfig] = useState<ServerConfig>(FALLBACK_CONFIG)
    const [serverState, setServerState] = useState<ServerState>('checking')
    const [tab, setTabState] = useState<Tab>(() => {
        try { return localStorage.getItem(TAB_KEY) === 'lab' ? 'lab' : 'convert' } catch { return 'convert' }
    })
    const [lab, setLab] = useState<LabState>(INITIAL_LAB_STATE)

    useEffect(() => {
        fetchConfig()
            .then((c) => { setConfig(c); setServerState('ok') })
            .catch(() => setServerState('error'))
    }, [])

    const setTab = (t: Tab) => {
        setTabState(t)
        try { localStorage.setItem(TAB_KEY, t) } catch { /* ignore */ }
    }

    const limitMbps = config.tunnel ? (settings.tunnelLimitMbps ?? config.tunnel_rate_limit_mbps) : 0
    const queue = useQueue(config, {
        rateLimit: limitMbps > 0 ? limitMbps * MB : 0,
        autoDownload: settings.autoDownload,
        exportMode: settings.exportMode,
        background: settings.background,
    })
    const { items } = queue

    const dragging = useWindowDrop((files) => { queue.add(files) })

    // Progress in the tab title, and a warning before closing mid-transfer.
    const summary = useMemo(() => {
        const running = items.filter((it) => isActive(it.status))
        const done = items.filter((it) => it.status === 'done').length
        const onServer = running.filter((it) => !it.local && it.jobId && it.status !== 'uploading').length
        // Uploads and in-browser conversions die with the tab. Server jobs
        // too, unless background mode keeps them going.
        const fragile = items.some((it) => it.status === 'uploading' || (it.local && it.status === 'processing'))
            || (!settings.background && onServer > 0)
        return { running: running.length, done, onServer, fragile }
    }, [items, settings.background])

    useEffect(() => {
        document.title = summary.running
            ? `(${summary.done}/${summary.done + summary.running}) Conversion… — Convertisseur`
            : 'Convertisseur Studio'
    }, [summary])

    useEffect(() => {
        if (!summary.fragile) return
        const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
        window.addEventListener('beforeunload', warn)
        return () => window.removeEventListener('beforeunload', warn)
    }, [summary.fragile])

    const labCount = items.filter((it) => (it.kind === 'image' || it.kind === 'video') && it.file).length

    return (
        <div className="min-h-screen bg-background text-foreground">
            <div className={cn('mx-auto px-4 pt-10 pb-28 sm:px-8 sm:pt-[72px]', tab === 'lab' && labCount > 0 ? 'max-w-[1440px]' : 'max-w-[860px]')}>
                <header className="mb-10 sm:mb-12">
                    <div className="mb-2 flex items-center justify-between gap-4">
                        <h1 className="text-[28px] leading-tight font-bold tracking-[-1px] sm:text-[34px]">
                            Convertisseur
                            <span className="ml-2 text-base font-normal tracking-normal text-muted-foreground">Studio</span>
                        </h1>
                        <SettingsMenu settings={settings} update={updateSettings} config={config} />
                    </div>
                    <p className="text-sm text-muted-foreground">
                        Vidéos, sons, images, documents et 3D — convertis, compressés ou étalonnés, dossiers compris.
                    </p>
                </header>

                <nav className="mb-6 flex flex-wrap gap-2" aria-label="Espaces">
                    <ModeTab active={tab === 'convert'} onClick={() => setTab('convert')}>
                        Convertir
                        {items.length > 0 && <Count n={items.length} />}
                    </ModeTab>
                    <ModeTab active={tab === 'lab'} onClick={() => setTab('lab')}>
                        Color Lab · étalonnage
                        {labCount > 0 && <Count n={labCount} />}
                    </ModeTab>
                </nav>

                <main className="space-y-7">
                    {tab === 'convert' ? (
                        <ConvertPage
                            queue={queue}
                            processing={settings.processing}
                            retentionHours={Math.round(config.retention_seconds / 3600)}
                            autoDownload={settings.autoDownload}
                            onAutoDownload={(v) => updateSettings({ autoDownload: v })}
                            exportMode={settings.exportMode}
                            background={settings.background}
                        />
                    ) : (
                        <Suspense fallback={<p className="py-16 text-center text-[13px] text-faint">Chargement du Color Lab…</p>}>
                            <ColorLab queue={queue} processing={settings.processing} lab={lab} setLab={setLab} />
                        </Suspense>
                    )}
                </main>
            </div>

            <StatusBadge
                state={serverState}
                version={config.version}
                tunnel={config.tunnel}
                limitMbps={limitMbps}
                onServer={summary.onServer}
                background={settings.background}
            />
            <DropOverlay visible={dragging} label={tab === 'lab' ? 'Dépose tes photos et vidéos' : 'Dépose tes fichiers'} />
        </div>
    )
}

/** Big outlined tab (mode-tab): the active one gets a brighter border and white text. */
function ModeTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-current={active ? 'page' : undefined}
            className={cn(
                'inline-flex items-center gap-2 rounded-[4px] border px-[18px] py-2.5 text-[13px] transition-colors',
                active ? 'border-input font-semibold text-foreground' : 'border-border font-medium text-faint hover:text-muted-foreground',
            )}
        >
            {children}
        </button>
    )
}

function Count({ n }: { n: number }) {
    return <span className="text-[11px] font-normal text-faint tabular-nums">{n}</span>
}

/** Fixed bottom-right pill (version-badge): server status, tunnel, background jobs. */
function StatusBadge({
    state,
    version,
    tunnel,
    limitMbps,
    onServer,
    background,
}: {
    state: ServerState
    version: string
    tunnel: boolean
    limitMbps: number
    onServer: number
    background: boolean
}) {
    let text: string
    if (state === 'checking') text = 'Connexion au serveur…'
    else if (state === 'error') text = 'Serveur injoignable'
    else if (onServer > 0) text = `${onServer} conversion${onServer > 1 ? 's' : ''} sur le serveur${background ? ' · continue si tu fermes' : ''}`
    else if (tunnel) text = `Tunnel Cloudflare · ${limitMbps > 0 ? `${limitMbps} Mo/s` : 'illimité'}`
    else text = `Serveur${version ? ` · ${version}` : ''}`

    return (
        <div
            className="fixed right-4 bottom-3.5 z-[5] flex items-center gap-1.5 rounded-[20px] border border-border bg-background/70 px-2.5 py-[5px] text-[11px] whitespace-nowrap text-faint backdrop-blur-sm"
            title={version ? `Version déployée : ${version}` : undefined}
            aria-live="polite"
        >
            <span
                className={cn(
                    'h-1.5 w-1.5 shrink-0 rounded-full',
                    state === 'checking' && 'pulse-dot bg-warning',
                    state === 'error' && 'bg-destructive',
                    state === 'ok' && (onServer > 0 ? 'pulse-dot bg-success' : 'bg-success'),
                )}
            />
            {text}
        </div>
    )
}

const PROCESSING_HELP: Record<ProcessingPreference, string> = {
    auto: "Les images que le navigateur sait traiter restent sur ton appareil (rien n'est envoyé). Tout le reste passe par le serveur.",
    server: 'Tout est converti par le serveur (FFmpeg, Pillow, LibreOffice). Le plus fiable.',
    browser: "Essaie aussi les vidéos dans le navigateur (lent, fichiers < 700 Mo). Bascule sur le serveur en cas d'échec.",
}

function MenuGroup({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div className="space-y-2 border-b border-border px-4 py-3.5 last:border-b-0">
            <p className="text-[10px] font-bold tracking-[0.1em] text-faint uppercase">{title}</p>
            {children}
        </div>
    )
}

function SettingsMenu({ settings, update, config }: { settings: Settings; update: (p: Partial<Settings>) => void; config: ServerConfig }) {
    const rateValue = settings.tunnelLimitMbps === null ? 'default' : String(settings.tunnelLimitMbps)
    return (
        <Popover
            className="max-h-[80vh] w-[min(92vw,340px)] overflow-y-auto scroll-thin"
            trigger={({ open, toggle }) => (
                <RoundButton onClick={toggle} aria-label="Réglages" aria-expanded={open} title="Réglages">
                    <IconSettings size={16} />
                </RoundButton>
            )}
        >
            <MenuGroup title="Où convertir">
                <Segmented<ProcessingPreference>
                    size="sm"
                    value={settings.processing}
                    onChange={(v) => update({ processing: v })}
                    options={[
                        { value: 'auto', label: 'Auto' },
                        { value: 'server', label: 'Serveur' },
                        { value: 'browser', label: 'Navigateur' },
                    ]}
                />
                <p className="text-[11px] leading-relaxed text-faint">{PROCESSING_HELP[settings.processing]}</p>
            </MenuGroup>

            <MenuGroup title="Téléchargements">
                <Toggle
                    checked={settings.autoDownload}
                    onChange={(v) => update({ autoDownload: v })}
                    label="Télécharger automatiquement"
                    description="Dès qu'un lot est terminé."
                />
                <div className="space-y-1.5 pt-1">
                    <span className="text-[13px]">Plusieurs fichiers</span>
                    <Segmented<'zip' | 'files'>
                        size="sm"
                        value={settings.exportMode}
                        onChange={(v) => update({ exportMode: v })}
                        options={[
                            { value: 'zip', label: 'Un ZIP' },
                            { value: 'files', label: 'Fichiers séparés' },
                        ]}
                    />
                    <p className="text-[11px] leading-relaxed text-faint">
                        {settings.exportMode === 'zip'
                            ? 'Un seul .zip qui garde les dossiers et sous-dossiers de départ.'
                            : 'Chaque fichier est téléchargé à part (le navigateur peut demander une autorisation).'}
                    </p>
                </div>
            </MenuGroup>

            <MenuGroup title="Arrière-plan">
                <Toggle
                    checked={settings.background}
                    onChange={(v) => update({ background: v })}
                    label="Continuer en arrière-plan"
                    description="Les conversions serveur continuent si tu fermes l'onglet, et reviennent quand tu rouvres la page."
                />
            </MenuGroup>

            <MenuGroup title="Tunnel Cloudflare">
                <p className="text-[11px] leading-relaxed text-faint">
                    {config.tunnel
                        ? 'Connexion via le tunnel détectée : envois en morceaux avec reprise automatique.'
                        : "Connexion directe : aucune limite. Ce réglage s'applique quand tu passes par le tunnel."}
                </p>
                <Select
                    size="sm"
                    className="w-full"
                    value={rateValue}
                    ariaLabel="Débit maximum via le tunnel"
                    onChange={(v) => update({ tunnelLimitMbps: v === 'default' ? null : parseFloat(v) })}
                    options={[
                        { value: 'default', label: `Débit par défaut (${config.tunnel_rate_limit_mbps} Mo/s)` },
                        { value: '1', label: '1 Mo/s' },
                        { value: '2', label: '2 Mo/s' },
                        { value: '5', label: '5 Mo/s' },
                        { value: '10', label: '10 Mo/s' },
                        { value: '20', label: '20 Mo/s' },
                        { value: '50', label: '50 Mo/s' },
                        { value: '0', label: 'Illimité' },
                    ]}
                />
            </MenuGroup>

            <MenuGroup title="Thème">
                <Segmented<ThemePreference>
                    size="sm"
                    value={settings.theme}
                    onChange={(v) => update({ theme: v })}
                    options={[
                        { value: 'dark', label: 'Sombre' },
                        { value: 'light', label: 'Clair' },
                        { value: 'system', label: 'Système' },
                    ]}
                />
            </MenuGroup>

            <p className="px-4 py-3 text-[11px] text-faint">
                Version : <span className="font-mono text-muted-foreground">{config.version || 'inconnue'}</span>
            </p>
        </Popover>
    )
}

export default App
