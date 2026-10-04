import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ConvertPage } from '@/components/ConvertPage'
import { DropOverlay } from '@/components/DropZone'
import { IconSettings } from '@/components/icons'
import { Toaster } from '@/components/Toaster'
import { Popover, RoundButton, Select, Toggle } from '@/components/ui'
import { useQueue } from '@/hooks/useQueue'
import { useWindowDrop } from '@/hooks/useWindowDrop'
import { FALLBACK_CONFIG, fetchConfig, type ServerConfig } from '@/lib/api'
import { INITIAL_LAB_STATE, type LabState } from '@/lib/labState'
import { canNotify, chime, notifyDone, primeChime } from '@/lib/notify'
import {
    useSettings, type MetadataPreference, type ProcessingPreference, type Settings, type ThemePreference,
} from '@/lib/settings'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { isActive } from '@/types'

const ColorLab = lazy(() => import('@/components/ColorLab').then((m) => ({ default: m.ColorLab })))

type Tab = 'convert' | 'lab'
type Sub = 'simple' | 'advanced'
type ServerState = 'checking' | 'ok' | 'error'
const TAB_KEY = 'convertisseur_tab'
const SUB_KEY = 'convertisseur_sub'
const MB = 1024 * 1024

function stored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
    try {
        const v = localStorage.getItem(key)
        return allowed.includes(v as T) ? (v as T) : fallback
    } catch {
        return fallback
    }
}

function remember(key: string, value: string) {
    try { localStorage.setItem(key, value) } catch { /* private mode */ }
}

function tabTitle(running: number, done: number, unseen: number): string {
    if (running) return `(${done}/${done + running}) Conversion… — Convertisseur`
    if (unseen) return `✓ ${unseen} prêt${unseen > 1 ? 's' : ''} — Convertisseur`
    return 'Convertisseur Studio'
}

function App() {
    const [settings, updateSettings] = useSettings()
    const [config, setConfig] = useState<ServerConfig>(FALLBACK_CONFIG)
    const [serverState, setServerState] = useState<ServerState>('checking')
    const [tab, setTabState] = useState<Tab>(() => stored(TAB_KEY, ['convert', 'lab'] as const, 'convert'))
    const [sub, setSubState] = useState<Sub>(() => stored(SUB_KEY, ['simple', 'advanced'] as const, 'simple'))
    const [lab, setLab] = useState<LabState>(INITIAL_LAB_STATE)

    useEffect(() => {
        fetchConfig()
            .then((c) => { setConfig(c); setServerState('ok') })
            .catch(() => setServerState('error'))
    }, [])

    const setTab = (t: Tab) => { setTabState(t); remember(TAB_KEY, t) }
    const setSub = (v: Sub) => { setSubState(v); remember(SUB_KEY, v) }

    const limitMbps = config.tunnel ? (settings.tunnelLimitMbps ?? config.tunnel_rate_limit_mbps) : 0
    const rateLimit = limitMbps > 0 ? limitMbps * MB : 0
    const queue = useQueue(config, {
        rateLimit,
        autoDownload: settings.autoDownload,
        exportMode: settings.exportMode,
        background: settings.background,
        metadata: settings.metadata,
    })
    const { items } = queue

    const dragging = useWindowDrop((files) => { queue.add(files) })

    // Progress in the tab title, and a warning before closing mid-transfer.
    const summary = useMemo(() => {
        const running = items.filter((it) => isActive(it.status))
        const done = items.filter((it) => it.status === 'done').length
        const errors = items.filter((it) => it.status === 'error').length
        const onServer = running.filter((it) => !it.local && it.jobId && it.status !== 'uploading').length
        // Uploads and in-browser conversions die with the tab. Server jobs
        // too, unless background mode keeps them going.
        const fragile = items.some((it) => it.status === 'uploading' || (it.local && it.status === 'processing'))
            || (!settings.background && onServer > 0)
        return { running: running.length, done, errors, onServer, fragile }
    }, [items, settings.background])

    // A batch that ends while the tab is hidden: "✓" in the title until it is
    // seen again, plus a chime and a notification when asked for.
    const wasRunning = useRef(0)
    const unseen = useRef(0)
    useEffect(() => {
        const before = wasRunning.current
        wasRunning.current = summary.running
        if (before > 0 && summary.running === 0 && document.hidden) {
            unseen.current = summary.done
            if (settings.notify) {
                chime()
                notifyDone(summary.done, summary.errors)
            }
        }
        document.title = tabTitle(summary.running, summary.done, unseen.current)
    }, [summary, settings.notify])

    useEffect(() => {
        const onVisible = () => {
            if (document.hidden || unseen.current === 0) return
            unseen.current = 0
            if (wasRunning.current === 0) document.title = tabTitle(0, 0, 0)
        }
        document.addEventListener('visibilitychange', onVisible)
        return () => document.removeEventListener('visibilitychange', onVisible)
    }, [])

    // Browsers only let a page play sound after a click: get the audio ready then.
    useEffect(() => {
        if (!settings.notify) return
        const prime = () => primeChime()
        window.addEventListener('pointerdown', prime)
        window.addEventListener('keydown', prime)
        return () => {
            window.removeEventListener('pointerdown', prime)
            window.removeEventListener('keydown', prime)
        }
    }, [settings.notify])

    useEffect(() => {
        if (!summary.fragile) return
        const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
        window.addEventListener('beforeunload', warn)
        return () => window.removeEventListener('beforeunload', warn)
    }, [summary.fragile])

    const labCount = items.filter((it) => (it.kind === 'image' || it.kind === 'video') && it.file).length

    return (
        <div className="min-h-screen bg-background text-foreground">
            <div className={cn('mx-auto px-4 pt-10 pb-28 sm:px-8 sm:pt-[72px]', 'max-w-[1280px]')}>
                <header className="mb-10 sm:mb-12">
                    <div className="mb-2 flex items-center justify-between gap-4">
                        <h1 className="text-[28px] leading-tight font-bold tracking-[-1px] sm:text-[34px]">
                            Convertisseur
                            <span className="ml-2 text-base font-normal tracking-normal text-muted-foreground">Studio</span>
                        </h1>
                        <SettingsMenu settings={settings} update={updateSettings} config={config} />
                    </div>
                    <p className="text-sm text-muted-foreground">
                        Vidéos, sons, images, PDF, documents et 3D — convertis, compressés ou étalonnés, dossiers compris.
                    </p>
                </header>

                <nav className="mb-6 flex flex-wrap items-center gap-2" aria-label="Espaces">
                    <ModeTab active={tab === 'convert'} onClick={() => setTab('convert')}>
                        Convertir
                        {items.length > 0 && <Count n={items.length} />}
                    </ModeTab>
                    <ModeTab active={tab === 'lab'} onClick={() => setTab('lab')}>
                        Color Lab · étalonnage
                        {labCount > 0 && <Count n={labCount} />}
                    </ModeTab>
                    {tab === 'convert' && <SubSwitch value={sub} onChange={setSub} />}
                </nav>

                <main className="space-y-7">
                    {tab === 'convert' ? (
                        <ConvertPage
                            queue={queue}
                            sub={sub}
                            processing={settings.processing}
                            metadata={settings.metadata}
                            rateLimit={rateLimit}
                            retentionHours={Math.round(config.retention_seconds / 3600)}
                            autoDownload={settings.autoDownload}
                            onAutoDownload={(v) => updateSettings({ autoDownload: v })}
                            exportMode={settings.exportMode}
                            onExportMode={(v) => updateSettings({ exportMode: v })}
                            background={settings.background}
                            onBackground={(v) => updateSettings({ background: v })}
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
            <Toaster />
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

/** "Simple | Avancé", on the right of the tabs (remembered). */
function SubSwitch({ value, onChange }: { value: Sub; onChange: (v: Sub) => void }) {
    return (
        <div className="flex w-full rounded-[4px] border border-input p-0.5 sm:ml-auto sm:inline-flex sm:w-auto" role="radiogroup" aria-label="Mode de conversion">
            {([['simple', 'Simple'], ['advanced', 'Avancé']] as const).map(([v, label]) => (
                <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
                    className={cn('h-8 flex-1 rounded-[3px] px-4 text-[13px] font-semibold transition-colors sm:flex-none',
                        value === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
                    {label}
                </button>
            ))}
        </div>
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
    auto: "Les images simples (PNG, WebP…) restent sur ton appareil, rien n'est envoyé. Les photos JPEG passent par le serveur pour garder leurs infos, sauf si tu les supprimes.",
    server: 'Tout est converti par le serveur (FFmpeg, Pillow, LibreOffice, Ghostscript). Le plus fiable.',
    browser: "Essaie aussi les vidéos dans le navigateur (lent, fichiers < 700 Mo). Bascule sur le serveur en cas d'échec.",
}

const METADATA_HELP: Record<MetadataPreference, string> = {
    nogps: "Date de prise de vue, appareil et profil couleur sont gardés ; la position GPS est retirée avant que tu partages le fichier.",
    keep: 'Tout est gardé, position GPS comprise.',
    strip: 'Date, appareil, position… tout est retiré (le profil couleur reste, pour ne pas fausser les couleurs).',
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

    const setNotify = async (on: boolean) => {
        update({ notify: on })
        if (!on) return
        primeChime()
        if (!canNotify()) {
            toast('Notifications indisponibles ici (page en HTTP) : un son te préviendra.', { tone: 'info' })
            return
        }
        if (Notification.permission === 'default') {
            const answer = await Notification.requestPermission().catch(() => 'denied' as NotificationPermission)
            if (answer !== 'granted') toast('Notifications refusées par le navigateur : seul le son te préviendra.', { tone: 'info' })
        } else if (Notification.permission === 'denied') {
            toast('Notifications bloquées pour ce site : seul le son te préviendra.', { tone: 'info' })
        }
        chime()
    }

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
                <Select
                    className="w-full"
                    ariaLabel="Où convertir"
                    value={settings.processing}
                    onChange={(v) => update({ processing: v as ProcessingPreference })}
                    options={[
                        { value: 'auto', label: 'Auto (images simples dans le navigateur)' },
                        { value: 'server', label: 'Tout sur le serveur' },
                        { value: 'browser', label: 'Navigateur si possible' },
                    ]}
                />
                <p className="text-[11px] leading-relaxed text-faint">{PROCESSING_HELP[settings.processing]}</p>
            </MenuGroup>

            <MenuGroup title="Infos des photos et vidéos">
                <Select
                    className="w-full"
                    ariaLabel="Métadonnées"
                    value={settings.metadata}
                    onChange={(v) => update({ metadata: v as MetadataPreference })}
                    options={[
                        { value: 'nogps', label: 'Garder, sans la position GPS' },
                        { value: 'keep', label: 'Tout garder' },
                        { value: 'strip', label: 'Tout supprimer' },
                    ]}
                />
                <p className="text-[11px] leading-relaxed text-faint">{METADATA_HELP[settings.metadata]}</p>
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
                    <Select
                        className="w-full"
                        ariaLabel="Plusieurs fichiers"
                        value={settings.exportMode}
                        onChange={(v) => update({ exportMode: v as Settings['exportMode'] })}
                        options={[
                            { value: 'zip', label: 'Un seul ZIP' },
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
                <Toggle
                    checked={settings.notify}
                    onChange={(v) => void setNotify(v)}
                    label="Me prévenir à la fin"
                    description="Un son (et une notification en HTTPS) quand un lot se termine pendant que tu es sur un autre onglet."
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
                <Select
                    className="w-full"
                    ariaLabel="Thème"
                    value={settings.theme}
                    onChange={(v) => update({ theme: v as ThemePreference })}
                    options={[
                        { value: 'dark', label: 'Sombre' },
                        { value: 'light', label: 'Clair' },
                        { value: 'system', label: 'Comme le système' },
                    ]}
                />
            </MenuGroup>

            <p className="px-4 py-3 text-[11px] text-faint">
                Version : <span className="font-mono text-muted-foreground">{config.version || 'inconnue'}</span>
                <span className="mt-1 block">Raccourcis : Ctrl+V coller · Ctrl+Entrée convertir · ← → dans l'aperçu</span>
            </p>
        </Popover>
    )
}

export default App
