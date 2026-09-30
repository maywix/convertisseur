import { Suspense, lazy, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ConvertPage } from '@/components/ConvertPage'
import { DropOverlay } from '@/components/DropZone'
import { IconCloud, IconSettings, IconWand } from '@/components/icons'
import { Button, Popover, Segmented, Select, Toggle } from '@/components/ui'
import { useQueue } from '@/hooks/useQueue'
import { useWindowDrop } from '@/hooks/useWindowDrop'
import { FALLBACK_CONFIG, fetchConfig, type ServerConfig } from '@/lib/api'
import { INITIAL_LAB_STATE, type LabState } from '@/lib/labState'
import { useSettings, type ProcessingPreference, type Settings, type ThemePreference } from '@/lib/settings'
import { cn } from '@/lib/utils'
import { isActive } from '@/types'

const ColorLab = lazy(() => import('@/components/ColorLab').then((m) => ({ default: m.ColorLab })))

type Tab = 'convert' | 'lab'
const TAB_KEY = 'convertisseur_tab'
const MB = 1024 * 1024

function App() {
    const [settings, updateSettings] = useSettings()
    const [config, setConfig] = useState<ServerConfig>(FALLBACK_CONFIG)
    const [tab, setTabState] = useState<Tab>(() => {
        try { return localStorage.getItem(TAB_KEY) === 'lab' ? 'lab' : 'convert' } catch { return 'convert' }
    })
    const [lab, setLab] = useState<LabState>(INITIAL_LAB_STATE)

    useEffect(() => {
        fetchConfig().then(setConfig).catch(() => undefined)
    }, [])

    const setTab = (t: Tab) => {
        setTabState(t)
        try { localStorage.setItem(TAB_KEY, t) } catch { /* ignore */ }
    }

    const limitMbps = config.tunnel ? (settings.tunnelLimitMbps ?? config.tunnel_rate_limit_mbps) : 0
    const queue = useQueue(config, limitMbps > 0 ? limitMbps * MB : 0, settings.autoDownload)
    const { items } = queue

    const dragging = useWindowDrop((files) => { queue.add(files) })

    // Progress in the tab title, and a warning before closing mid-transfer.
    const summary = useMemo(() => {
        const running = items.filter((it) => isActive(it.status))
        const done = items.filter((it) => it.status === 'done').length
        const inBrowser = items.some((it) => it.status === 'uploading' || (it.local && it.status === 'processing'))
        return { running: running.length, done, inBrowser }
    }, [items])

    useEffect(() => {
        document.title = summary.running
            ? `(${summary.done}/${summary.done + summary.running}) Conversion… — Convertisseur`
            : 'Convertisseur Studio'
    }, [summary])

    useEffect(() => {
        if (!summary.inBrowser) return
        const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
        window.addEventListener('beforeunload', warn)
        return () => window.removeEventListener('beforeunload', warn)
    }, [summary.inBrowser])

    const labCount = items.filter((it) => (it.kind === 'image' || it.kind === 'video') && it.file).length

    return (
        <div className="min-h-screen bg-background text-foreground">
            <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-xl">
                <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-4 lg:px-6">
                    <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground shadow-sm">C</div>
                        <span className="hidden text-[15px] font-semibold tracking-tight sm:inline">Convertisseur</span>
                    </div>

                    <nav className="ml-1 flex items-center gap-1 rounded-xl bg-muted p-1 sm:ml-4" aria-label="Espaces">
                        <TabButton active={tab === 'convert'} onClick={() => setTab('convert')}>
                            Convertir
                            {items.length > 0 && <Count n={items.length} active={tab === 'convert'} />}
                        </TabButton>
                        <TabButton active={tab === 'lab'} onClick={() => setTab('lab')}>
                            <IconWand size={14} className="hidden sm:block" />
                            Color Lab
                            {labCount > 0 && <Count n={labCount} active={tab === 'lab'} />}
                        </TabButton>
                    </nav>

                    <div className="ml-auto flex items-center gap-2">
                        {config.tunnel && (
                            <span
                                className="hidden items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground md:inline-flex"
                                title="Connexion via Cloudflare Tunnel : envois découpés en petits morceaux, reprise automatique et débit limité."
                            >
                                <IconCloud size={14} className="text-primary" />
                                Tunnel · {limitMbps > 0 ? `${limitMbps} Mo/s` : 'illimité'}
                            </span>
                        )}
                        <SettingsMenu settings={settings} update={updateSettings} config={config} />
                    </div>
                </div>
            </header>

            {tab === 'convert' ? (
                <ConvertPage
                    queue={queue}
                    processing={settings.processing}
                    retentionHours={Math.round(config.retention_seconds / 3600)}
                />
            ) : (
                <Suspense fallback={<div className="p-10 text-center text-sm text-muted-foreground">Chargement du Color Lab…</div>}>
                    <ColorLab queue={queue} processing={settings.processing} lab={lab} setLab={setLab} />
                </Suspense>
            )}

            <DropOverlay visible={dragging} label={tab === 'lab' ? 'Dépose tes photos et vidéos' : 'Dépose tes fichiers'} />
        </div>
    )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-current={active ? 'page' : undefined}
            className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors',
                active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
        >
            {children}
        </button>
    )
}

function Count({ n, active }: { n: number; active: boolean }) {
    return (
        <span className={cn('rounded-full px-1.5 text-[11px] font-semibold tabular-nums', active ? 'bg-primary/12 text-primary' : 'bg-background/70')}>
            {n}
        </span>
    )
}

const PROCESSING_HELP: Record<ProcessingPreference, string> = {
    auto: "Les images que le navigateur sait traiter restent sur ton appareil (rien n'est envoyé). Tout le reste passe par le serveur.",
    server: 'Tout est converti par le serveur (FFmpeg, Pillow, LibreOffice). Le plus fiable.',
    browser: "Essaie aussi les vidéos dans le navigateur (lent, fichiers < 700 Mo). Bascule sur le serveur en cas d'échec.",
}

function SettingsMenu({ settings, update, config }: { settings: Settings; update: (p: Partial<Settings>) => void; config: ServerConfig }) {
    const rateValue = settings.tunnelLimitMbps === null ? 'default' : String(settings.tunnelLimitMbps)
    return (
        <Popover
            className="w-[min(92vw,360px)] p-4"
            trigger={({ open, toggle }) => (
                <Button variant={open ? 'secondary' : 'ghost'} size="icon" onClick={toggle} aria-label="Réglages" aria-expanded={open}>
                    <IconSettings size={18} />
                </Button>
            )}
        >
            <div className="space-y-5">
                <div className="space-y-2">
                    <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Où convertir</p>
                    <Segmented<ProcessingPreference>
                        className="w-full"
                        size="sm"
                        value={settings.processing}
                        onChange={(v) => update({ processing: v })}
                        options={[
                            { value: 'auto', label: 'Auto' },
                            { value: 'server', label: 'Serveur' },
                            { value: 'browser', label: 'Navigateur' },
                        ]}
                    />
                    <p className="text-xs leading-relaxed text-muted-foreground">{PROCESSING_HELP[settings.processing]}</p>
                </div>

                <div className="space-y-2">
                    <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                        <IconCloud size={14} /> Tunnel Cloudflare
                    </p>
                    <p className="text-xs text-muted-foreground">
                        {config.tunnel
                            ? 'Connexion via le tunnel détectée : envois en morceaux de 8 Mo avec reprise automatique.'
                            : "Connexion directe : aucune limite appliquée. Ces réglages s'activent quand tu passes par le tunnel."}
                    </p>
                    <div className="space-y-1.5">
                        <span className="text-sm">Débit max (envoi et téléchargement)</span>
                        <Select
                            size="sm"
                            className="w-full"
                            value={rateValue}
                            ariaLabel="Débit maximum via le tunnel"
                            onChange={(v) => update({ tunnelLimitMbps: v === 'default' ? null : parseFloat(v) })}
                            options={[
                                { value: 'default', label: `Défaut (${config.tunnel_rate_limit_mbps} Mo/s)` },
                                { value: '1', label: '1 Mo/s' },
                                { value: '2', label: '2 Mo/s' },
                                { value: '5', label: '5 Mo/s' },
                                { value: '10', label: '10 Mo/s' },
                                { value: '20', label: '20 Mo/s' },
                                { value: '50', label: '50 Mo/s' },
                                { value: '0', label: 'Illimité' },
                            ]}
                        />
                    </div>
                </div>

                <div className="space-y-1">
                    <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Téléchargement</p>
                    <Toggle
                        checked={settings.autoDownload}
                        onChange={(v) => update({ autoDownload: v })}
                        label="Télécharger automatiquement"
                        description="Quand un lot est terminé (ZIP s'il y a plusieurs fichiers)."
                    />
                </div>

                <div className="space-y-2">
                    <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Thème</p>
                    <Segmented<ThemePreference>
                        className="w-full"
                        size="sm"
                        value={settings.theme}
                        onChange={(v) => update({ theme: v })}
                        options={[
                            { value: 'system', label: 'Système' },
                            { value: 'light', label: 'Clair' },
                            { value: 'dark', label: 'Sombre' },
                        ]}
                    />
                </div>
            </div>
        </Popover>
    )
}

export default App
