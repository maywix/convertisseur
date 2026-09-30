import { memo, useState } from 'react'
import {
    IconAlert, IconArrowRight, IconAudio, IconCube, IconDocument, IconDownload, IconImage,
    IconRefresh, IconSequence, IconTerminal, IconVideo, IconX,
} from '@/components/icons'
import { Button, ProgressBar, Select } from '@/components/ui'
import { objectUrlFor } from '@/lib/objectUrl'
import { cn } from '@/lib/utils'
import { FORMATS, formatLabel, formatSize, isActive, type QueueItem } from '@/types'

function KindIcon({ kind, size = 18 }: { kind: QueueItem['kind']; size?: number }) {
    if (kind === 'video') return <IconVideo size={size} />
    if (kind === 'audio') return <IconAudio size={size} />
    if (kind === 'image') return <IconImage size={size} />
    if (kind === '3d') return <IconCube size={size} />
    if (kind === 'sequence') return <IconSequence size={size} />
    return <IconDocument size={size} />
}

function Thumb({ item }: { item: QueueItem }) {
    const [failed, setFailed] = useState(false)
    const url = item.kind === 'image' && item.file && !failed ? objectUrlFor(item.file) : null
    return (
        <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
            {url ? (
                <img src={url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" onError={() => setFailed(true)} />
            ) : (
                <KindIcon kind={item.kind} />
            )}
        </div>
    )
}

function StatusLine({ item }: { item: QueueItem }) {
    switch (item.status) {
        case 'pending':
            return <span className="text-muted-foreground">Prêt</span>
        case 'queued':
            return <span className="text-muted-foreground">{item.jobId ? 'Dans la file du serveur…' : 'En attente…'}</span>
        case 'uploading':
            return <span className="text-primary">Envoi · {item.progress} %</span>
        case 'processing':
            return (
                <span className="text-primary">
                    Conversion{item.local ? ' (navigateur)' : ''}{item.progress > 0 ? ` · ${item.progress} %` : '…'}
                </span>
            )
        case 'done': {
            const saved = item.outputSize && item.size ? Math.round((1 - item.outputSize / item.size) * 100) : null
            return (
                <span className="text-success">
                    Terminé{item.outputSize ? ` · ${formatSize(item.outputSize)}` : ''}
                    {saved !== null && saved > 1 && <span className="text-success/80"> (−{saved} %)</span>}
                    {item.local && <span className="ml-1.5 rounded bg-success/12 px-1 py-px text-[10px] font-semibold uppercase">local</span>}
                </span>
            )
        }
        case 'error':
            return (
                <span className="inline-flex min-w-0 items-center gap-1 text-destructive" title={item.error ?? undefined}>
                    <IconAlert size={13} className="shrink-0" />
                    <span className="truncate">{item.error || 'Échec'}</span>
                </span>
            )
    }
}

export const FileRow = memo(function FileRow({
    item,
    onFormat,
    onRemove,
    onRetry,
    onDownload,
    onShowLog,
}: {
    item: QueueItem
    onFormat: (id: string, format: string) => void
    onRemove: (id: string) => void
    onRetry: (id: string) => void
    onDownload: (item: QueueItem) => void
    /** Advanced mode: open the FFmpeg log of server jobs. */
    onShowLog?: (item: QueueItem) => void
}) {
    const active = isActive(item.status)
    const options = item.kind === 'sequence' ? FORMATS.video.filter((f) => ['mp4', 'webm', 'gif'].includes(f.value))
        : item.kind === 'unknown' ? [] : FORMATS[item.kind]
    const canPick = !!item.file && !active && options.length > 1

    return (
        <div className={cn('group flex items-center gap-3 px-4 py-3 transition-colors', item.status === 'done' && 'bg-success/[0.03]')}>
            <Thumb item={item} />
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground" title={item.relativePath || item.name}>
                    {item.name}
                </p>
                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    {item.size > 0 && <span className="text-muted-foreground tabular-nums">{formatSize(item.size)}</span>}
                    {item.kind !== 'unknown' && (
                        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                            <IconArrowRight size={12} />
                            {canPick ? (
                                <Select
                                    size="sm"
                                    ariaLabel={`Format de sortie pour ${item.name}`}
                                    value={item.targetFormat}
                                    options={options}
                                    onChange={(v) => onFormat(item.id, v)}
                                    className="w-[124px]"
                                />
                            ) : (
                                <span className="font-semibold text-foreground">{formatLabel(item.kind, item.targetFormat)}</span>
                            )}
                        </span>
                    )}
                    <span className="min-w-0 text-xs">
                        <StatusLine item={item} />
                    </span>
                </div>
                {(item.status === 'uploading' || item.status === 'processing') && (
                    <ProgressBar value={item.progress} indeterminate={item.status === 'processing' && item.progress === 0} className="mt-2" />
                )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
                {onShowLog && item.jobId && !item.local && (item.status === 'done' || item.status === 'error' || item.status === 'processing') && (
                    <Button variant="ghost" size="icon" onClick={() => onShowLog(item)} title="Journal FFmpeg" aria-label={`Journal de ${item.name}`}>
                        <IconTerminal size={15} />
                    </Button>
                )}
                {item.status === 'done' && item.downloadUrl && (
                    <Button variant="success" size="sm" onClick={() => onDownload(item)}>
                        <IconDownload size={14} />
                        <span className="hidden sm:inline">Télécharger</span>
                    </Button>
                )}
                {item.status === 'error' && item.file && item.kind !== 'unknown' && (
                    <Button variant="ghost" size="sm" onClick={() => onRetry(item.id)} title="Réessayer">
                        <IconRefresh size={14} />
                        <span className="hidden sm:inline">Réessayer</span>
                    </Button>
                )}
                <Button
                    variant="danger"
                    size="icon"
                    onClick={() => onRemove(item.id)}
                    title={active ? 'Annuler' : 'Retirer'}
                    aria-label={active ? `Annuler ${item.name}` : `Retirer ${item.name}`}
                >
                    <IconX size={15} />
                </Button>
            </div>
        </div>
    )
})

export { KindIcon }
