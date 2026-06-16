import { memo, useState, useEffect, useRef } from 'react'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { IconDownload, IconX, IconRefresh, IconChevronDown, IconChevronUp, IconTerminal } from '@/components/icons'
import type { CompressSettings, QueueItem } from '@/types'
import { formatSize, getFileType } from '@/types'
import { cn } from '@/lib/utils'

interface FileItemProps {
    item: QueueItem
    currentAction: 'convert' | 'compress' | 'convert_compress'
    defaultFormat: string
    formats: {
        video: string[]
        audio: string[]
        image: string[]
        sequence: string[]
        document: string[]
        '3d': string[]
        unknown: string[]
    }
    onRemove: (id: string) => void
    onRequeue: (id: string) => void
    onSetItemTargetFormat: (id: string, format: string) => void
    onSetItemCustomAction: (id: string, action: 'convert' | 'compress' | 'convert_compress') => void
    onSetItemCustomCompressSettings: (id: string, patch: Partial<CompressSettings>) => void
    onSetItemOutputMode: (id: string, mode: 'global' | 'custom') => void
}

const STATUS_COLOR = {
    pending: 'text-muted-foreground',
    uploading: 'text-blue-400',
    queued: 'text-yellow-400',
    processing: 'text-orange-400',
    done: 'text-emerald-500',
    error: 'text-destructive',
}

const STATUS_TEXT = {
    pending: 'En attente',
    uploading: 'Envoi…',
    queued: "File d'attente…",
    processing: 'Conversion…',
    done: 'Terminé',
    error: 'Erreur',
}

const PROGRESS_FALLBACK = {
    pending: 0,
    uploading: 15,
    queued: 30,
    processing: 60,
    done: 100,
    error: 100,
}

const FILE_EMOJI: Record<string, string> = {
    video: '🎬', audio: '🎵', image: '🖼️', sequence: '🎞️',
    document: '📄', '3d': '🧊', unknown: '📄',
}

function FileItemImpl({
    item,
    currentAction,
    defaultFormat,
    formats,
    onRemove,
    onRequeue,
    onSetItemTargetFormat,
    onSetItemCustomAction,
    onSetItemCustomCompressSettings,
    onSetItemOutputMode,
}: FileItemProps) {
    const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [logsOpen, setLogsOpen] = useState(false)

    const fileType = item.mediaKind === 'sequence' ? 'sequence' : item.mediaKind || getFileType(item.file.name)

    useEffect(() => {
        if ((fileType !== 'image' && fileType !== 'sequence') || item.file.size <= 0) {
            setThumbnailUrl(null)
            return
        }

        // Avoid expensive client-side canvas work for very large files.
        if (item.file.size > 25 * 1024 * 1024) {
            setThumbnailUrl(null)
            return
        }

        const objectUrl = URL.createObjectURL(item.file)
        setThumbnailUrl(objectUrl)

        return () => {
            URL.revokeObjectURL(objectUrl)
        }
    }, [item.file, fileType])

    const availableFormats = formats[fileType]
    const selectedFormat = item.targetFormat || defaultFormat
    const customCompress = item.customCompressSettings
    const isCustom = item.outputMode === 'custom'
    const displayName =
        item.mediaKind === 'sequence' && item.extraFiles && item.extraFiles.length > 0
            ? `${item.relativePath || item.file.name} (+${item.extraFiles.length})`
            : item.relativePath || item.file.name

    const isDone = item.status === 'done'
    const isError = item.status === 'error'
    const isActive = item.status === 'uploading' || item.status === 'queued' || item.status === 'processing'
    const isPending = item.status === 'pending'
    const effectiveAction = item.customAction || currentAction
    const showsConvertControls = effectiveAction === 'convert' || effectiveAction === 'convert_compress'
    const showsCompressControls = effectiveAction === 'compress' || effectiveAction === 'convert_compress'

    return (
        <div className={cn(
            "rounded-lg border transition-colors mb-2",
            isDone ? "border-emerald-500/30 bg-emerald-500/5" :
            isError ? "border-destructive/30 bg-destructive/5" :
            isActive ? "border-primary/20 bg-primary/5" :
            "border-border bg-card/50"
        )}>
            {/* Main row */}
            <div className="flex items-center gap-3 p-3">
                {/* Thumbnail / icon */}
                <div className="w-12 h-12 min-w-12 flex-shrink-0 rounded-md overflow-hidden bg-muted flex items-center justify-center">
                    {thumbnailUrl ? (
                        <img src={thumbnailUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                        <span className="text-xl">{FILE_EMOJI[fileType] || '📄'}</span>
                    )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate" title={displayName}>{displayName}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground">{formatSize(item.file.size)}</span>
                        <span className={cn("text-xs font-medium", STATUS_COLOR[item.status])}>
                            {item.status === 'error' && item.error
                                ? `Erreur: ${item.error.slice(0, 50)}`
                                : STATUS_TEXT[item.status]}
                        </span>
                        {isActive && item.progress != null && item.progress > 0 && (
                            <span className="text-xs font-mono text-primary ml-auto">
                                {item.progress}%
                            </span>
                        )}
                    </div>
                    <Progress
                        value={
                            item.progress != null && item.progress > 0
                                ? item.progress
                                : PROGRESS_FALLBACK[item.status]
                        }
                        className={cn(
                            "h-1 mt-1.5",
                            isDone ? "[&>div]:bg-emerald-500" :
                            isError ? "[&>div]:bg-destructive" :
                            isActive ? "[&>div]:bg-primary" : "[&>div]:bg-muted"
                        )}
                    />
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                    {item.jobId && !isPending && (
                        <button
                            type="button"
                            onClick={() => setLogsOpen((v) => !v)}
                            className={cn(
                                "h-7 w-7 rounded-md flex items-center justify-center transition-colors",
                                logsOpen
                                    ? "text-emerald-400 bg-emerald-500/10"
                                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                            )}
                            title="Voir les logs"
                        >
                            <IconTerminal size={14} />
                        </button>
                    )}
                    {isPending && availableFormats.length > 0 && (
                        <button
                            type="button"
                            onClick={() => setSettingsOpen((v) => !v)}
                            className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                            title="Paramètres individuels"
                        >
                            {settingsOpen ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
                        </button>
                    )}
                    {isDone && item.downloadUrl && (
                        <a
                            href={item.downloadUrl}
                            download={item.outputFilename || undefined}
                            className="h-7 w-7 rounded-md flex items-center justify-center bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
                            title="Télécharger"
                        >
                            <IconDownload size={14} />
                        </a>
                    )}
                    {(isDone || isError) && (
                        <button
                            type="button"
                            onClick={() => onRequeue(item.id)}
                            className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                            title="Reconvertir"
                        >
                            <IconRefresh size={14} />
                        </button>
                    )}
                    {!isDone && (
                        <button
                            type="button"
                            onClick={() => onRemove(item.id)}
                            className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                            title="Supprimer"
                        >
                            <IconX size={14} />
                        </button>
                    )}
                </div>
            </div>

            {/* Per-file settings (expandable, only for pending) */}
            {isPending && settingsOpen && availableFormats.length > 0 && (
                <div className="border-t border-border px-3 py-2.5 space-y-2 bg-muted/10">
                    <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground font-medium">Paramètres individuels</span>
                        <div className="flex items-center gap-1.5">
                            <span className="text-xs text-muted-foreground">Global</span>
                            <Switch
                                checked={isCustom}
                                onCheckedChange={(checked) =>
                                    onSetItemOutputMode(item.id, checked ? 'custom' : 'global')
                                }
                            />
                            <span className="text-xs text-muted-foreground">Fichier</span>
                        </div>
                    </div>

                    {isCustom && (
                        <div className="space-y-2">
                            <Select
                                value={effectiveAction}
                                onValueChange={(v) => onSetItemCustomAction(item.id, v as 'convert' | 'compress' | 'convert_compress')}
                            >
                                <SelectTrigger className="h-8 text-xs">
                                    <SelectValue placeholder="Action" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="convert">Convertir</SelectItem>
                                    <SelectItem value="compress">Compresser</SelectItem>
                                    <SelectItem value="convert_compress">Convertir + compresser</SelectItem>
                                </SelectContent>
                            </Select>

                            {showsConvertControls && (
                                <Select
                                    value={selectedFormat || undefined}
                                    onValueChange={(v) => onSetItemTargetFormat(item.id, v)}
                                >
                                    <SelectTrigger className="h-8 text-xs">
                                        <SelectValue placeholder="Format de sortie" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {availableFormats.map((fmt) => (
                                            <SelectItem key={fmt} value={fmt}>
                                                {fmt === 'zip' ? "ZIP (suite PNG)" : fmt.toUpperCase()}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}

                            {showsCompressControls && (
                                <div className="grid grid-cols-2 gap-2">
                                    <Select
                                        value={customCompress?.mode || 'size'}
                                        onValueChange={(v) =>
                                            onSetItemCustomCompressSettings(item.id, { mode: v as CompressSettings['mode'] })
                                        }
                                    >
                                        <SelectTrigger className="h-8 text-xs">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="size">Taille (MB)</SelectItem>
                                            <SelectItem value="percent">Réduction (%)</SelectItem>
                                            <SelectItem value="crf">Qualité</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <input
                                        type="text"
                                        value={
                                            (customCompress?.mode || 'size') === 'percent'
                                                ? customCompress?.percentReduction || '50'
                                                : (customCompress?.mode || 'size') === 'crf'
                                                    ? customCompress?.crfLevel || 'medium'
                                                    : customCompress?.targetSizeMb || '50'
                                        }
                                        onChange={(e) => {
                                            const mode = customCompress?.mode || 'size'
                                            if (mode === 'percent') {
                                                onSetItemCustomCompressSettings(item.id, { percentReduction: e.target.value })
                                            } else if (mode === 'crf') {
                                                onSetItemCustomCompressSettings(item.id, { crfLevel: e.target.value as CompressSettings['crfLevel'] })
                                            } else {
                                                onSetItemCustomCompressSettings(item.id, { targetSizeMb: e.target.value })
                                            }
                                        }}
                                        className="h-8 px-2 rounded-md border border-input bg-background text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                                        placeholder="Valeur"
                                    />
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Log panel */}
            {logsOpen && item.jobId && (
                <LogPanel jobId={item.jobId} isActive={isActive} />
            )}
        </div>
    )
}

export const FileItem = memo(FileItemImpl, (prev, next) => {
    return (
        prev.item === next.item &&
        prev.currentAction === next.currentAction &&
        prev.defaultFormat === next.defaultFormat &&
        prev.formats === next.formats &&
        prev.onRemove === next.onRemove &&
        prev.onRequeue === next.onRequeue &&
        prev.onSetItemTargetFormat === next.onSetItemTargetFormat &&
        prev.onSetItemCustomAction === next.onSetItemCustomAction &&
        prev.onSetItemCustomCompressSettings === next.onSetItemCustomCompressSettings &&
        prev.onSetItemOutputMode === next.onSetItemOutputMode
    )
})

function LogPanel({ jobId, isActive }: { jobId: string; isActive: boolean }) {
    const [lines, setLines] = useState<string[]>([])
    const scrollRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        let cancelled = false

        const poll = async () => {
            try {
                const res = await fetch(`/jobs/${jobId}/logs`)
                if (!res.ok || cancelled) return
                const data = await res.json()
                if (!cancelled) setLines(data.lines ?? [])
            } catch {}
        }

        poll()
        if (!isActive) return
        const id = setInterval(poll, 1200)
        return () => { cancelled = true; clearInterval(id) }
    }, [jobId, isActive])

    useEffect(() => {
        const el = scrollRef.current
        if (el) el.scrollTop = el.scrollHeight
    }, [lines])

    return (
        <div className="border-t border-border">
            <div
                ref={scrollRef}
                className="max-h-52 overflow-y-auto bg-zinc-950 rounded-b-lg p-3 font-mono text-[11px] leading-[1.6] select-text"
            >
                {lines.length === 0 ? (
                    <span className="text-zinc-600 italic">Pas de logs disponibles…</span>
                ) : (
                    lines.map((line, i) => (
                        <div
                            key={i}
                            className={cn(
                                "whitespace-pre-wrap break-all",
                                line.startsWith('$')
                                    ? 'text-emerald-400 font-semibold mt-1'
                                    : /error|erreur|failed|invalid/i.test(line)
                                        ? 'text-red-400'
                                        : /warning|warn/i.test(line)
                                            ? 'text-yellow-400'
                                            : 'text-zinc-400'
                            )}
                        >
                            {line || '\u00a0'}
                        </div>
                    ))
                )}
            </div>
        </div>
    )
}
