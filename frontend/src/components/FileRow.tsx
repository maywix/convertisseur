import { memo, useState, type ReactNode } from 'react'
import {
    IconAlert, IconAudio, IconCube, IconDocument, IconDownload, IconFolder, IconImage,
    IconRefresh, IconSequence, IconSliders, IconTerminal, IconVideo, IconX,
} from '@/components/icons'
import { ProgressBar, Select } from '@/components/ui'
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
        <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[3px] bg-muted text-faint">
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
            return <span className="text-faint">Prêt</span>
        case 'queued':
            return <span className="text-muted-foreground">{item.jobId ? 'Dans la file du serveur…' : 'En attente…'}</span>
        case 'uploading':
            return <span className="text-foreground">Envoi · {item.progress} %</span>
        case 'processing':
            return (
                <span className="text-foreground">
                    {item.local ? 'Conversion dans le navigateur' : 'Conversion sur le serveur'}{item.progress > 0 ? ` · ${item.progress} %` : '…'}
                </span>
            )
        case 'done': {
            const saved = item.outputSize && item.size ? Math.round((1 - item.outputSize / item.size) * 100) : null
            return (
                <span className="text-success">
                    ✓ Terminé{item.outputSize ? ` · ${formatSize(item.outputSize)}` : ''}
                    {saved !== null && saved > 1 && ` (−${saved} %)`}
                    {item.local && <span className="ml-1.5 text-faint">· local</span>}
                </span>
            )
        }
        case 'error':
            return (
                <span className="inline-flex min-w-0 items-center gap-1 text-destructive" title={item.error ?? undefined}>
                    <IconAlert size={12} className="shrink-0" />
                    <span className="truncate">{item.error || 'Échec'}</span>
                </span>
            )
    }
}

function IconButton({ onClick, title, children, className }: { onClick: () => void; title: string; children: ReactNode; className?: string }) {
    return (
        <button
            type="button"
            onClick={onClick}
            title={title}
            aria-label={title}
            className={cn('flex h-7 w-7 items-center justify-center rounded-[3px] text-faint transition-colors hover:bg-accent hover:text-foreground', className)}
        >
            {children}
        </button>
    )
}

export const FileRow = memo(function FileRow({
    item,
    custom,
    editing,
    onFormat,
    onRemove,
    onRetry,
    onDownload,
    onShowLog,
    onEdit,
    formatNote,
}: {
    item: QueueItem
    /** Replaces the format menu (e.g. "même format" when compressing). */
    formatNote?: string
    /** Has its own settings (per-file override). */
    custom?: boolean
    /** Its settings are open in the options card. */
    editing?: boolean
    onFormat: (id: string, format: string) => void
    onRemove: (id: string) => void
    onRetry: (id: string) => void
    onDownload: (item: QueueItem) => void
    onShowLog?: (item: QueueItem) => void
    onEdit?: (item: QueueItem) => void
}) {
    const active = isActive(item.status)
    const options = item.kind === 'sequence' ? FORMATS.video.filter((f) => ['mp4', 'webm', 'gif'].includes(f.value))
        : item.kind === 'unknown' ? [] : FORMATS[item.kind]
    const canPick = !!item.file && !active && options.length > 1
    const folder = item.relativePath.includes('/') ? item.relativePath.slice(0, item.relativePath.lastIndexOf('/')) : ''

    const format = formatNote ? (
        <span className="text-[11px] text-faint">{formatNote}</span>
    ) : item.kind !== 'unknown' && (
        <span className="inline-flex items-center gap-2 text-[11px] text-faint">
            en
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
                <span className="text-[12px] font-semibold text-foreground">{formatLabel(item.kind, item.targetFormat)}</span>
            )}
        </span>
    )

    return (
        <div className={cn('group flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 transition-colors hover:bg-foreground/[0.03]', editing && 'bg-foreground/[0.05]')}>
            <Thumb item={item} />
            <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-foreground" title={item.relativePath || item.name}>
                    {item.name}
                    {custom && <span className="ml-2 rounded-[2px] border border-input px-1.5 py-px align-middle text-[9px] font-bold tracking-[0.04em] text-muted-foreground uppercase">Réglages perso</span>}
                </p>
                <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-faint">
                    {folder && (
                        <span className="inline-flex min-w-0 items-center gap-1" title={folder}>
                            <IconFolder size={11} className="shrink-0" />
                            <span className="max-w-[220px] truncate">{folder}</span>
                        </span>
                    )}
                    {item.size > 0 && <span className="tabular-nums">{formatSize(item.size)}</span>}
                </div>
                {(item.status === 'uploading' || item.status === 'processing') && (
                    <ProgressBar value={item.progress} indeterminate={item.status === 'processing' && item.progress === 0} className="mt-2" />
                )}
                <p className="mt-1 min-w-0 truncate text-[11px]"><StatusLine item={item} /></p>
            </div>
            {/* Under the name on phones, on the right from sm up. */}
            {format && <div className="order-last w-full pl-14 sm:order-none sm:w-auto sm:shrink-0 sm:pl-0">{format}</div>}
            <div className="flex shrink-0 items-center gap-1">
                {item.status === 'done' && item.downloadUrl && (
                    <button
                        type="button"
                        onClick={() => onDownload(item)}
                        className="inline-flex h-7 items-center gap-1.5 rounded-[3px] bg-success px-3 text-xs font-bold text-black transition-opacity hover:opacity-85"
                    >
                        <IconDownload size={13} />
                        <span className="hidden sm:inline">Sauvegarder</span>
                    </button>
                )}
                {item.status === 'error' && item.file && item.kind !== 'unknown' && (
                    <IconButton onClick={() => onRetry(item.id)} title="Réessayer"><IconRefresh size={14} /></IconButton>
                )}
                {onEdit && item.file && !active && item.kind !== 'unknown' && (
                    <IconButton onClick={() => onEdit(item)} title="Réglages de ce fichier" className={cn((custom || editing) && 'text-foreground')}>
                        <IconSliders size={14} />
                    </IconButton>
                )}
                {onShowLog && item.jobId && !item.local && (item.status === 'done' || item.status === 'error' || item.status === 'processing') && (
                    <IconButton onClick={() => onShowLog(item)} title={`Journal de ${item.name}`}><IconTerminal size={14} /></IconButton>
                )}
                <IconButton onClick={() => onRemove(item.id)} title={active ? `Annuler ${item.name}` : `Retirer ${item.name}`} className="hover:text-destructive">
                    <IconX size={14} />
                </IconButton>
            </div>
        </div>
    )
})

export { KindIcon }
