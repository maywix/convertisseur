import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { UploadZone } from './UploadZone'
import {
    IconArrowDown,
    IconAudio,
    IconCheck,
    IconChevronDown,
    IconChevronUp,
    IconCube,
    IconDocument,
    IconDownload,
    IconImage,
    IconPlay,
    IconRefresh,
    IconVideo,
    IconWand,
    IconX,
} from '@/components/icons'
import type { CompressSettings, QueueItem } from '@/types'
import { formatSize, getFileType } from '@/types'
import { cn } from '@/lib/utils'

// ──────────────────────────────────────────────────────────
// Workflow presets — Dribbble-style tabs at the top.
// Each tab pre-configures the action + target format for all pending files
// whose detected media type matches.
// ──────────────────────────────────────────────────────────
type WorkflowId = 'auto' | 'video-mp4' | 'gif' | 'audio-mp3' | 'image-jpg' | 'image-png' | 'image-webp' | 'upscale' | 'compress'

interface Workflow {
    id: WorkflowId
    label: string
    icon: React.ReactNode
    action: 'convert' | 'compress' | 'convert_compress'
    target?: { kind: 'video' | 'audio' | 'image'; format: string }
    description: string
}

const WORKFLOWS: Workflow[] = [
    { id: 'auto',        label: 'Auto',         icon: <IconWand size={14} />,     action: 'convert',          description: "On choisit le meilleur format pour chaque fichier" },
    { id: 'video-mp4',   label: 'Vidéo → MP4',  icon: <IconVideo size={14} />,    action: 'convert', target: { kind: 'video', format: 'mp4' },  description: "Convertir toute vidéo en MP4 H.264" },
    { id: 'gif',         label: 'GIF Maker',    icon: <IconImage size={14} />,    action: 'convert', target: { kind: 'video', format: 'gif' },  description: "Transformer une vidéo en GIF animé" },
    { id: 'audio-mp3',   label: 'Audio → MP3',  icon: <IconAudio size={14} />,    action: 'convert', target: { kind: 'audio', format: 'mp3' },  description: "Convertir tout audio en MP3" },
    { id: 'image-jpg',   label: 'Image → JPG',  icon: <IconImage size={14} />,    action: 'convert', target: { kind: 'image', format: 'jpg' },  description: "Convertir toute image en JPG" },
    { id: 'image-png',   label: 'Image → PNG',  icon: <IconImage size={14} />,    action: 'convert', target: { kind: 'image', format: 'png' },  description: "Convertir toute image en PNG (transparence)" },
    { id: 'image-webp',  label: 'Image → WebP', icon: <IconImage size={14} />,    action: 'convert', target: { kind: 'image', format: 'webp' }, description: "Convertir toute image en WebP" },
    { id: 'compress',    label: 'Compresser',   icon: <IconArrowDown size={14} />, action: 'convert_compress', description: "Réduire le poids des fichiers tout en gardant le format" },
]

// Curated, intentionally short format lists per media type for the per-file picker.
const SIMPLE_FORMATS: Record<'video' | 'audio' | 'image' | 'document' | '3d', string[]> = {
    video: ['mp4', 'webm', 'mkv', 'mov', 'avi', 'gif'],
    audio: ['mp3', 'aac', 'm4a', 'opus', 'ogg', 'flac', 'wav'],
    image: ['jpg', 'png', 'webp', 'gif', 'avif', 'pdf'],
    document: ['pdf'],
    '3d': ['glb', 'obj', 'stl', 'ply'],
}

interface SimpleConverterProps {
    queue: QueueItem[]
    canStart: boolean
    isProcessing: boolean
    currentAction: 'convert' | 'compress' | 'convert_compress'
    onFilesAdded: (files: FileList | File[]) => void
    onRemove: (id: string) => void
    onRequeue: (id: string) => void
    onClearAll: () => void
    onStart: () => void
    onSetFormat: (id: string, format: string) => void
    onSetCurrentAction: (action: 'convert' | 'compress' | 'convert_compress') => void
    onSetCompressSettings: (updater: (prev: CompressSettings) => CompressSettings) => void
    onExportCompleted: () => void
}

function itemKind(item: QueueItem): 'video' | 'audio' | 'image' | 'document' | '3d' | 'unknown' {
    const kind = item.mediaKind === 'sequence' ? 'video' : item.mediaKind
    if (kind === 'video' || kind === 'audio' || kind === 'image' || kind === 'document' || kind === '3d') {
        return kind
    }
    return getFileType(item.file.name)
}

function TypeIcon({ kind }: { kind: ReturnType<typeof itemKind> }) {
    const props = { size: 18 }
    if (kind === 'video') return <IconVideo {...props} />
    if (kind === 'audio') return <IconAudio {...props} />
    if (kind === 'image') return <IconImage {...props} />
    if (kind === 'document') return <IconDocument {...props} />
    if (kind === '3d') return <IconCube {...props} />
    return <IconDocument {...props} />
}

function FormatPicker({
    value,
    options,
    onChange,
}: {
    value: string
    options: string[]
    onChange: (format: string) => void
}) {
    const [open, setOpen] = useState(false)
    const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
    const btnRef = useRef<HTMLButtonElement>(null)
    const menuRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!open) return
        const onPointer = (e: Event) => {
            const t = e.target as Node
            if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return
            setOpen(false)
        }
        const onDismiss = () => setOpen(false)
        document.addEventListener('mousedown', onPointer)
        window.addEventListener('scroll', onDismiss, true)
        window.addEventListener('resize', onDismiss)
        return () => {
            document.removeEventListener('mousedown', onPointer)
            window.removeEventListener('scroll', onDismiss, true)
            window.removeEventListener('resize', onDismiss)
        }
    }, [open])

    const toggle = () => {
        if (!open && btnRef.current) {
            const r = btnRef.current.getBoundingClientRect()
            setPos({ top: r.bottom + 4, left: r.left })
        }
        setOpen((v) => !v)
    }

    return (
        <>
            <button
                ref={btnRef}
                type="button"
                onClick={toggle}
                className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-primary transition-colors hover:bg-primary/20"
            >
                <IconArrowDown size={11} />
                {value.toUpperCase()}
                <IconChevronDown size={11} />
            </button>
            {open && pos && createPortal(
                <div
                    ref={menuRef}
                    style={{ position: 'fixed', top: pos.top, left: pos.left }}
                    className="z-[100] max-h-60 min-w-[110px] overflow-auto rounded-lg border border-border bg-popover py-1 shadow-xl"
                >
                    {options.map((opt) => (
                        <button
                            key={opt}
                            type="button"
                            onClick={() => { onChange(opt); setOpen(false) }}
                            className={cn(
                                'flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted/60',
                                opt === value ? 'font-semibold text-primary' : 'text-foreground',
                            )}
                        >
                            {opt.toUpperCase()}
                            {opt === value && <IconCheck size={13} />}
                        </button>
                    ))}
                </div>,
                document.body,
            )}
        </>
    )
}

function Row({
    item,
    onRemove,
    onRequeue,
    onSetFormat,
}: {
    item: QueueItem
    onRemove: (id: string) => void
    onRequeue: (id: string) => void
    onSetFormat: (id: string, format: string) => void
}) {
    const kind = itemKind(item)
    const target = (item.targetFormat || '').toUpperCase()
    const isActive = item.status === 'uploading' || item.status === 'queued' || item.status === 'processing'
    const progress = typeof item.progress === 'number' ? item.progress : null
    const formatOptions = kind !== 'unknown' ? SIMPLE_FORMATS[kind] : []
    const canPickFormat = item.status === 'pending' && item.targetFormat != null && formatOptions.length > 1

    return (
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border/60 last:border-b-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <TypeIcon kind={kind} />
            </div>

            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{item.file.name}</span>
                    {canPickFormat ? (
                        <FormatPicker
                            value={item.targetFormat || ''}
                            options={formatOptions}
                            onChange={(fmt) => onSetFormat(item.id, fmt)}
                        />
                    ) : (
                        target && (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-primary">
                                <IconArrowDown size={11} />
                                {target}
                            </span>
                        )
                    )}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    {item.file.size > 0 && <span>{formatSize(item.file.size)}</span>}
                    {item.status === 'pending' && <span>· Prêt</span>}
                    {item.status === 'uploading' && <span className="text-primary">· Envoi…</span>}
                    {item.status === 'queued' && <span>· En file…</span>}
                    {item.status === 'processing' && (
                        <span className="text-primary">· Conversion{progress !== null ? ` ${Math.round(progress)} %` : '…'}</span>
                    )}
                    {item.status === 'done' && (
                        <span className="text-emerald-600 dark:text-emerald-400">
                            · Prêt {item.jobId?.startsWith('local-') && '· local'}
                        </span>
                    )}
                    {item.status === 'error' && (
                        <span className="text-destructive">· {item.error || 'Échec'}</span>
                    )}
                </div>
                {item.status === 'processing' && progress !== null && (
                    <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                        <div
                            className="h-full rounded-full bg-primary transition-[width] duration-300"
                            style={{ width: `${Math.max(2, Math.round(progress))}%` }}
                        />
                    </div>
                )}
            </div>

            <div className="flex shrink-0 items-center gap-1">
                {item.status === 'done' && item.downloadUrl && (
                    <a
                        href={item.downloadUrl}
                        download={item.outputFilename || undefined}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-500/15 px-3 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/25 dark:text-emerald-400"
                    >
                        <IconDownload size={14} />
                        Télécharger
                    </a>
                )}
                {item.status === 'error' && (
                    <button
                        type="button"
                        onClick={() => onRequeue(item.id)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                    >
                        <IconRefresh size={14} />
                        Réessayer
                    </button>
                )}
                {isActive && (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                )}
                {!isActive && (
                    <button
                        type="button"
                        onClick={() => onRemove(item.id)}
                        aria-label="Retirer"
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                    >
                        <IconX size={15} />
                    </button>
                )}
            </div>
        </div>
    )
}

function Tip({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
    return (
        <div className="rounded-xl border border-border bg-card/60 p-3.5">
            <div className="flex items-center gap-2 text-sm font-semibold">
                <span className="text-muted-foreground">{icon}</span>
                {title}
            </div>
            <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{children}</p>
        </div>
    )
}

export function SimpleConverter({
    queue,
    canStart,
    isProcessing,
    currentAction,
    onFilesAdded,
    onRemove,
    onRequeue,
    onClearAll,
    onStart,
    onSetFormat,
    onSetCurrentAction,
    onSetCompressSettings,
    onExportCompleted,
}: SimpleConverterProps) {
    const [activeWorkflow, setActiveWorkflow] = useState<WorkflowId>('auto')
    const [showTips, setShowTips] = useState(false)
    const pendingCount = queue.filter((i) => i.status === 'pending').length
    const doneCount = queue.filter((i) => i.status === 'done' && i.downloadUrl).length
    const isEmpty = queue.length === 0

    const currentWorkflow = useMemo(
        () => WORKFLOWS.find((w) => w.id === activeWorkflow) || WORKFLOWS[0],
        [activeWorkflow],
    )

    const applyWorkflow = (wf: Workflow) => {
        setActiveWorkflow(wf.id)
        onSetCurrentAction(wf.action)
        if (wf.id === 'compress') {
            onSetCompressSettings((prev) => ({ ...prev, mode: 'percent', percentReduction: '50' }))
        }
        // Apply the target format to all pending files of the matching kind.
        if (wf.target) {
            for (const item of queue) {
                if (item.status !== 'pending') continue
                if (itemKind(item) === wf.target.kind) {
                    onSetFormat(item.id, wf.target.format)
                }
            }
        }
    }

    const supportedFormatsHint = useMemo(() => {
        if (!currentWorkflow.target) return "Tous formats : vidéo · audio · image · documents Office · modèles 3D"
        const kind = currentWorkflow.target.kind
        if (kind === 'video') return "mp4, mov, mkv, webm, avi, flv, m4v, mpeg, 3gp, ts… et plus"
        if (kind === 'audio') return "mp3, wav, m4a, flac, aac, ogg, opus, wma… et plus"
        if (kind === 'image') return "jpg, png, heic, webp, raw, cr2, nef, tiff, psd, svg… et plus"
        return ""
    }, [currentWorkflow])

    return (
        <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
            {/* ─── Hero header ─── */}
            {isEmpty && (
                <div className="mb-8 text-center">
                    <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
                        Convertissez vos <span className="text-primary">fichiers</span>
                    </h1>
                    <p className="mt-4 text-base text-muted-foreground">
                        Choisissez un workflow, déposez vos fichiers, c'est tout.
                    </p>
                </div>
            )}

            {/* ─── Workflow tabs (Dribbble-style) ─── */}
            <div className="mb-6 flex flex-wrap items-center gap-2 justify-center">
                {WORKFLOWS.map((wf) => (
                    <button
                        key={wf.id}
                        type="button"
                        onClick={() => applyWorkflow(wf)}
                        className={cn(
                            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all",
                            activeWorkflow === wf.id
                                ? "border-primary bg-primary/10 text-primary shadow-sm"
                                : "border-border bg-card/60 text-muted-foreground hover:border-muted-foreground hover:text-foreground",
                        )}
                    >
                        {wf.icon}
                        {wf.label}
                    </button>
                ))}
            </div>

            {/* ─── Workflow info row ─── */}
            <div className="mb-4 flex flex-wrap items-baseline gap-x-6 gap-y-1.5 text-xs">
                <div>
                    <span className="text-muted-foreground">Workflow actif</span>{' '}
                    <span className="font-semibold text-foreground">{currentWorkflow.label}</span>
                </div>
                <div className="text-muted-foreground">
                    <span className="font-medium text-foreground/80">Formats acceptés</span> · {supportedFormatsHint}
                </div>
            </div>

            {/* ─── Tips (collapsible) ─── */}
            <button
                type="button"
                onClick={() => setShowTips((v) => !v)}
                className="mb-4 flex w-full items-center justify-between rounded-xl border border-border bg-card/60 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-card"
            >
                <span className="flex items-center gap-2">
                    <IconWand size={13} className="text-muted-foreground" />
                    {showTips ? 'Masquer les astuces' : 'Voir les astuces'}
                </span>
                {showTips ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
            </button>
            {showTips && (
                <div className="mb-6 grid gap-3 sm:grid-cols-2 animate-in fade-in slide-in-from-top-2 duration-200">
                    <Tip icon={<IconVideo size={14} />} title="Vidéos lourdes ?">
                        Active "Compresser" pour réduire le poids. Tu peux aussi viser une taille cible en MB en mode Pro.
                    </Tip>
                    <Tip icon={<IconImage size={14} />} title="Garder la transparence">
                        Pour les logos / images avec fond transparent, sors en PNG ou WebP (jamais JPG).
                    </Tip>
                    <Tip icon={<IconAudio size={14} />} title="Extraire l'audio d'une vidéo">
                        Sélectionne le workflow Audio → MP3 : il extrait la bande son et la convertit en MP3.
                    </Tip>
                    <Tip icon={<IconDownload size={14} />} title="Tout télécharger en ZIP">
                        Quand plusieurs fichiers sont prêts, le bouton "Tout télécharger" apparaît pour récupérer le tout d'un coup.
                    </Tip>
                </div>
            )}

            {/* ─── Upload zone ─── */}
            <div className="mb-6">
                <UploadZone onFilesAdded={onFilesAdded} compact={!isEmpty} />
            </div>

            {/* ─── File queue ─── */}
            {!isEmpty && (
                <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
                        <h2 className="text-sm font-semibold tracking-tight">
                            {queue.length} fichier{queue.length > 1 ? 's' : ''}
                            {doneCount > 0 && (
                                <span className="ml-2 text-xs font-normal text-emerald-600 dark:text-emerald-400">
                                    · {doneCount} prêt{doneCount > 1 ? 's' : ''}
                                </span>
                            )}
                        </h2>
                        <div className="flex items-center gap-3">
                            {doneCount > 1 && (
                                <button
                                    type="button"
                                    onClick={onExportCompleted}
                                    className="inline-flex h-7 items-center gap-1.5 rounded-md bg-emerald-500/15 px-2.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/25 dark:text-emerald-400"
                                >
                                    <IconDownload size={13} />
                                    Tout télécharger
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={onClearAll}
                                className="text-xs font-medium text-muted-foreground transition-colors hover:text-destructive"
                            >
                                Tout effacer
                            </button>
                        </div>
                    </div>

                    <div className="divide-y divide-border/60">
                        {queue.map((item) => (
                            <Row
                                key={item.id}
                                item={item}
                                onRemove={onRemove}
                                onRequeue={onRequeue}
                                onSetFormat={onSetFormat}
                            />
                        ))}
                    </div>
                </div>
            )}

            {/* ─── Auto-delete notice ─── */}
            {!isEmpty && (
                <p className="mt-3 text-center text-xs text-muted-foreground">
                    Tous les fichiers uploadés sont supprimés automatiquement <span className="underline decoration-dotted">3 h après upload</span>.
                </p>
            )}

            {/* ─── Big convert button ─── */}
            {!isEmpty && (
                <div className="mt-6 flex flex-col items-center gap-3">
                    <button
                        type="button"
                        onClick={onStart}
                        disabled={!canStart || isProcessing}
                        className={cn(
                            'inline-flex h-12 min-w-[220px] items-center justify-center gap-2 rounded-xl px-8 text-base font-semibold transition-all shadow-sm',
                            !canStart || isProcessing
                                ? 'cursor-not-allowed bg-muted text-muted-foreground'
                                : 'bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98]',
                        )}
                    >
                        {isProcessing ? (
                            <>
                                <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground" />
                                Conversion…
                            </>
                        ) : (
                            <>
                                <IconPlay size={16} />
                                {currentAction === 'convert_compress' ? 'Convertir et réduire' : 'Convertir'}
                                {pendingCount > 0 && pendingCount < queue.length && ` (${pendingCount})`}
                            </>
                        )}
                    </button>
                    <p className="text-[11px] text-muted-foreground">
                        En cliquant, vous acceptez les <a href="#" className="underline">conditions d'utilisation</a>.
                    </p>
                </div>
            )}
        </div>
    )
}
