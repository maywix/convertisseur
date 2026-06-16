import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Switch } from '@/components/ui/switch'
import { UploadZone } from './UploadZone'
import {
    IconArrowDown,
    IconAudio,
    IconCheck,
    IconChevronDown,
    IconCube,
    IconDocument,
    IconDownload,
    IconImage,
    IconRefresh,
    IconVideo,
    IconX,
} from '@/components/icons'
import type { CompressSettings, QueueItem } from '@/types'
import { formatSize, getFileType } from '@/types'
import { cn } from '@/lib/utils'

// Curated, intentionally short format lists per media type for Simple mode.
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
        // Close on scroll/resize since the portal is positioned against the viewport.
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
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border/60 last:border-b-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
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
                    {item.status === 'uploading' && <span>· Envoi…</span>}
                    {item.status === 'queued' && <span>· En file…</span>}
                    {item.status === 'processing' && (
                        <span>· Conversion{progress !== null ? ` ${Math.round(progress)} %` : '…'}</span>
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
                    <>
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                            <IconCheck size={14} />
                        </span>
                        <a
                            href={item.downloadUrl}
                            download={item.outputFilename || undefined}
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                        >
                            <IconDownload size={14} />
                            Télécharger
                        </a>
                    </>
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
}: SimpleConverterProps) {
    const reduceEnabled = currentAction === 'convert_compress'
    const pendingCount = queue.filter((i) => i.status === 'pending').length
    const isEmpty = queue.length === 0

    const toggleReduce = (on: boolean) => {
        if (on) {
            onSetCurrentAction('convert_compress')
            onSetCompressSettings((prev) => ({ ...prev, mode: 'percent', percentReduction: '50' }))
        } else {
            onSetCurrentAction('convert')
        }
    }

    if (isEmpty) {
        return (
            <div className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col items-center justify-center px-4 text-center">
                <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                    Convertissez vos fichiers
                </h1>
                <p className="mt-3 max-w-md text-[15px] text-muted-foreground">
                    Déposez n'importe quel fichier. On choisit le format idéal pour vous.
                </p>
                <div className="mt-8 w-full">
                    <UploadZone onFilesAdded={onFilesAdded} />
                </div>
            </div>
        )
    }

    return (
        <div className="mx-auto w-full max-w-xl px-4 py-8">
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                <div className="flex items-center justify-between px-4 py-3">
                    <h2 className="text-sm font-semibold tracking-tight">
                        {queue.length} fichier{queue.length > 1 ? 's' : ''}
                    </h2>
                    <button
                        type="button"
                        onClick={onClearAll}
                        className="text-xs font-medium text-muted-foreground transition-colors hover:text-destructive"
                    >
                        Tout effacer
                    </button>
                </div>

                <div className="border-y border-border/60">
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

                <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <label className="flex cursor-pointer items-center gap-2.5 select-none">
                        <Switch checked={reduceEnabled} onCheckedChange={toggleReduce} disabled={isProcessing} />
                        <span className="text-sm text-foreground">Réduire le poids</span>
                    </label>

                    <button
                        type="button"
                        onClick={onStart}
                        disabled={!canStart || isProcessing}
                        className={cn(
                            'inline-flex h-11 items-center justify-center gap-2 rounded-xl px-6 text-sm font-semibold transition-all',
                            !canStart || isProcessing
                                ? 'cursor-not-allowed bg-muted text-muted-foreground'
                                : 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:scale-[0.98]',
                        )}
                    >
                        {isProcessing ? (
                            <>
                                <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground" />
                                Conversion…
                            </>
                        ) : (
                            <>
                                {reduceEnabled ? 'Convertir et réduire' : 'Convertir'}
                                {pendingCount > 0 && pendingCount < queue.length && ` (${pendingCount})`}
                            </>
                        )}
                    </button>
                </div>
            </div>

            <div className="mt-4">
                <UploadZone onFilesAdded={onFilesAdded} compact />
            </div>
        </div>
    )
}
