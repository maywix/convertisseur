import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { UploadZone } from './UploadZone'
import { FileItem } from './FileItem'
import type { OutputMode, QueueItem } from '@/types'
import type { CompressSettings } from '@/types'
import type { ExportMode } from '@/types'
import { AUDIO_FORMATS, IMAGE_FORMATS, MODEL_3D_FORMATS, OFFICE_FORMATS, VIDEO_FORMATS, getFileType } from '@/types'
import { IconDownload, IconTrash } from '@/components/icons'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

interface FileQueueProps {
    queue: QueueItem[]
    currentAction: 'convert' | 'compress' | 'convert_compress'
    outputMode: OutputMode
    defaultFormat: string
    onFilesAdded: (files: FileList | File[]) => void
    onRemove: (id: string) => void
    onClearAll: () => void
    onSetItemTargetFormat: (id: string, format: string) => void
    onSetItemCustomAction: (id: string, action: 'convert' | 'compress' | 'convert_compress') => void
    onSetItemCustomCompressSettings: (id: string, patch: Partial<CompressSettings>) => void
    onSetItemOutputMode: (id: string, mode: 'global' | 'custom') => void
    onApplyGlobalOutput: () => void
    onRequeue: (id: string) => void
    hasCompletedFiles: boolean
    exportMode: ExportMode
    onExportCompleted: () => void
}

const formatsByType = {
    video: VIDEO_FORMATS,
    audio: AUDIO_FORMATS,
    image: IMAGE_FORMATS,
    sequence: VIDEO_FORMATS,
    document: OFFICE_FORMATS,
    '3d': MODEL_3D_FORMATS,
    unknown: [] as string[],
}

type TypeTab = 'all' | 'video' | 'audio' | 'image' | 'document' | '3d'
type SortMode = 'default' | 'progress'

const TAB_LABELS: Record<TypeTab, string> = {
    all: 'Tous',
    video: 'Vidéo',
    audio: 'Audio',
    image: 'Image',
    document: 'Document',
    '3d': '3D',
}

function getItemTab(item: QueueItem): Exclude<TypeTab, 'all'> {
    const kind = item.mediaKind === 'sequence' ? 'video' : item.mediaKind || getFileType(item.file.name)
    if (kind === 'video') return 'video'
    if (kind === 'audio') return 'audio'
    if (kind === 'image') return 'image'
    if (kind === 'document') return 'document'
    if (kind === '3d') return '3d'
    return 'video' // unknown → default
}

const STATUS_COUNTS = (queue: QueueItem[]) => ({
    pending: queue.filter(i => i.status === 'pending').length,
    active: queue.filter(i => i.status === 'uploading' || i.status === 'queued' || i.status === 'processing').length,
    done: queue.filter(i => i.status === 'done').length,
    error: queue.filter(i => i.status === 'error').length,
})

const STATUS_SORT_RANK: Record<QueueItem['status'], number> = {
    pending: 1,
    uploading: 2,
    queued: 3,
    processing: 4,
    error: 5,
    done: 6,
}

export function FileQueue({
    queue,
    currentAction,
    outputMode,
    defaultFormat,
    onFilesAdded,
    onRemove,
    onClearAll,
    onSetItemTargetFormat,
    onSetItemCustomAction,
    onSetItemCustomCompressSettings,
    onSetItemOutputMode,
    onApplyGlobalOutput,
    onRequeue,
    hasCompletedFiles,
    exportMode,
    onExportCompleted,
}: FileQueueProps) {
    const [activeTab, setActiveTab] = useState<TypeTab>('all')
    const [sortMode, setSortMode] = useState<SortMode>('default')
    const [renderLimit, setRenderLimit] = useState(200)
    const counts = useMemo(() => STATUS_COUNTS(queue), [queue])
    const canExportCompleted = hasCompletedFiles && counts.pending === 0 && counts.active === 0

    // Count per type tab
    const tabCounts = useMemo(() => {
        const countsByTab: Record<TypeTab, number> = { all: queue.length, video: 0, audio: 0, image: 0, document: 0, '3d': 0 }
        for (const item of queue) {
            countsByTab[getItemTab(item)]++
        }
        return countsByTab
    }, [queue])

    // Only show tabs that have files (plus "all" if queue > 0)
    const visibleTabs = useMemo(() => (Object.keys(TAB_LABELS) as TypeTab[]).filter(
        t => t === 'all' ? queue.length > 0 : tabCounts[t] > 0
    ), [queue.length, tabCounts])
    const showTabs = visibleTabs.length > 2 // only show tab bar when more than 1 type

    // Filtered and sorted items
    const filteredQueue = useMemo(() => {
        const filtered = activeTab === 'all'
            ? queue
            : queue.filter(item => getItemTab(item) === activeTab)

        if (sortMode !== 'progress') {
            return filtered
        }

        return [...filtered].sort((a, b) => {
            const rankDiff = STATUS_SORT_RANK[b.status] - STATUS_SORT_RANK[a.status]
            if (rankDiff !== 0) return rankDiff

            // For same status, use numeric progress when available.
            const aProgress = typeof a.progress === 'number' ? a.progress : 0
            const bProgress = typeof b.progress === 'number' ? b.progress : 0
            return bProgress - aProgress
        })
    }, [activeTab, queue, sortMode])
    const visibleItems = useMemo(() => filteredQueue.slice(0, renderLimit), [filteredQueue, renderLimit])

    // Reset tab to 'all' if active tab becomes empty
    const effectiveTab = useMemo(
        () => (tabCounts[activeTab] > 0 || activeTab === 'all' ? activeTab : 'all'),
        [activeTab, tabCounts],
    )

    return (
        <div className="bg-card rounded-xl border border-border shadow-sm flex flex-col min-h-[520px] lg:min-h-0 lg:flex-1 overflow-hidden">
            <UploadZone onFilesAdded={onFilesAdded} compact={queue.length > 0} />

            {/* Header */}
            <div className="px-4 py-3.5 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/25">
                <div className="flex flex-wrap items-center gap-3">
                    <h3 className="text-sm font-semibold tracking-tight">
                        File d'attente
                        <span className="ml-1.5 text-muted-foreground font-normal">({queue.length})</span>
                    </h3>
                    {/* Status summary pills */}
                    {queue.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5">
                            {counts.pending > 0 && (
                                <span className="px-2 py-1 rounded-md text-xs bg-card border border-border text-muted-foreground">
                                    {counts.pending} en attente
                                </span>
                            )}
                            {counts.active > 0 && (
                                <span className="px-2 py-1 rounded-md text-xs bg-primary/10 text-primary border border-primary/20">
                                    {counts.active} actif
                                </span>
                            )}
                            {counts.done > 0 && (
                                <span className="px-2 py-1 rounded-md text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                                    {counts.done} terminé
                                </span>
                            )}
                            {counts.error > 0 && (
                                <span className="px-2 py-1 rounded-md text-xs bg-destructive/10 text-destructive border border-destructive/20">
                                    {counts.error} erreur
                                </span>
                            )}
                        </div>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                    {queue.length > 1 && (
                        <Select value={sortMode} onValueChange={(value) => setSortMode(value as SortMode)}>
                            <SelectTrigger className="h-8 min-w-[180px] bg-card text-xs">
                                <SelectValue placeholder="Trier par" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="default">Trier: ordre d'ajout</SelectItem>
                                <SelectItem value="progress">Trier: état d'avancement</SelectItem>
                            </SelectContent>
                        </Select>
                    )}
                    {(currentAction === 'convert' || currentAction === 'convert_compress') && outputMode === 'per-file' && (
                        <Button variant="outline" size="sm" onClick={onApplyGlobalOutput} className="text-xs h-8">
                            Format global
                        </Button>
                    )}
                    <Button
                        variant="ghost" size="sm"
                        onClick={onExportCompleted}
                        disabled={!canExportCompleted}
                        className={cn("text-xs h-8 gap-1.5", !canExportCompleted && "opacity-40")}
                    >
                        <IconDownload size={13} />
                        {exportMode === 'files' ? 'Exporter les fichiers' : 'Exporter en ZIP'}
                    </Button>
                    <Button
                        variant="ghost" size="sm"
                        onClick={onClearAll}
                        className="text-xs h-8 gap-1.5 text-muted-foreground hover:text-destructive"
                    >
                        <IconTrash size={13} />
                        Vider
                    </Button>
                </div>
            </div>

            {/* Type tabs */}
            {showTabs && (
                <div className="flex items-center gap-1 px-3 pt-2 pb-0 border-b border-border bg-muted/15 overflow-x-auto">
                    {visibleTabs.map(tab => (
                        <button
                            key={tab}
                            type="button"
                            onClick={() => {
                                setActiveTab(tab)
                                setRenderLimit(200)
                            }}
                            className={cn(
                                "relative px-3 py-1.5 text-xs font-semibold rounded-t-md transition-colors whitespace-nowrap",
                                effectiveTab === tab
                                    ? "text-foreground bg-card border-b-2 border-primary -mb-px shadow-sm"
                                    : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                            )}
                        >
                            {TAB_LABELS[tab]}
                            {tab !== 'all' && tabCounts[tab] > 0 && (
                                <span className={cn(
                                    "ml-1.5 text-[10px] px-1 rounded-full",
                                    effectiveTab === tab ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                                )}>
                                    {tabCounts[tab]}
                                </span>
                            )}
                        </button>
                    ))}
                </div>
            )}

            {/* File list */}
            <div className="flex-1 min-h-0 overflow-y-auto p-3 bg-background/35 overscroll-contain">
                {queue.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-card text-2xl text-muted-foreground">+</div>
                        <p className="text-sm font-medium text-foreground">Aucun fichier dans la file</p>
                        <p className="mt-1 text-xs text-muted-foreground">Glissez-déposez ou cliquez sur Ajouter des fichiers.</p>
                    </div>
                ) : filteredQueue.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                        <p className="text-sm text-muted-foreground">Aucun fichier dans cet onglet</p>
                    </div>
                ) : (
                    visibleItems.map((item) => (
                        <FileItem
                            key={item.id}
                            item={item}
                            currentAction={currentAction}
                            defaultFormat={defaultFormat}
                            formats={formatsByType}
                            onRemove={onRemove}
                            onRequeue={onRequeue}
                            onSetItemTargetFormat={onSetItemTargetFormat}
                            onSetItemCustomAction={onSetItemCustomAction}
                            onSetItemCustomCompressSettings={onSetItemCustomCompressSettings}
                            onSetItemOutputMode={onSetItemOutputMode}
                        />
                    ))
                )}
                {filteredQueue.length > visibleItems.length && (
                    <div className="pt-2 flex justify-center">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setRenderLimit((v) => v + 200)}
                            className="text-xs"
                        >
                            Afficher plus ({filteredQueue.length - visibleItems.length} restants)
                        </Button>
                    </div>
                )}
            </div>
        </div>
    )
}
