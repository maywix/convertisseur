import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { UploadZone } from './UploadZone'
import { FileItem } from './FileItem'
import type { OutputMode, QueueItem } from '@/types'
import type { CompressSettings } from '@/types'
import { AUDIO_FORMATS, IMAGE_FORMATS, VIDEO_FORMATS } from '@/types'
import { IconDownload, IconTrash } from '@/components/icons'

interface FileQueueProps {
    queue: QueueItem[]
    currentAction: 'convert' | 'compress'
    outputMode: OutputMode
    defaultFormat: string
    onFilesAdded: (files: FileList | File[]) => void
    onRemove: (id: string) => void
    onClearAll: () => void
    onSetItemTargetFormat: (id: string, format: string) => void
    onSetItemCustomAction: (id: string, action: 'convert' | 'compress') => void
    onSetItemCustomCompressSettings: (id: string, patch: Partial<CompressSettings>) => void
    onSetItemOutputMode: (id: string, mode: 'global' | 'custom') => void
    onApplyGlobalOutput: () => void
    onRequeue: (id: string) => void
    hasCompletedFiles: boolean
}

const formatsByType = {
    video: VIDEO_FORMATS,
    audio: AUDIO_FORMATS,
    image: IMAGE_FORMATS,
    unknown: [] as string[],
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
}: FileQueueProps) {
    const handleDownloadAll = () => {
        window.location.href = '/download-all'
    }

    return (
        <div className="bg-card rounded-xl border border-border flex flex-col min-h-[500px] lg:min-h-0 lg:h-full">
            <UploadZone onFilesAdded={onFilesAdded} />

            {/* Header */}
            <div className="p-4 flex flex-wrap items-center justify-between gap-2 border-b border-border">
                <h3 className="font-semibold">
                    File d'attente <span className="text-muted-foreground">({queue.length})</span>
                </h3>
                <div className="flex gap-2">
                    {currentAction === 'convert' && outputMode === 'per-file' && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={onApplyGlobalOutput}
                            className="text-xs"
                        >
                            Appliquer format global
                        </Button>
                    )}
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleDownloadAll}
                        disabled={!hasCompletedFiles}
                        className="text-xs gap-2"
                    >
                        <IconDownload size={14} />
                        Tout télécharger
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onClearAll}
                        className="text-xs text-destructive hover:text-destructive gap-2"
                    >
                        <IconTrash size={14} />
                        Tout effacer
                    </Button>
                </div>
            </div>

            {/* File list */}
            <ScrollArea className="flex-1 p-4">
                {queue.length === 0 ? (
                    <div className="text-center text-muted-foreground italic py-12">
                        Aucun fichier en attente
                    </div>
                ) : (
                    queue.map((item) => (
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
            </ScrollArea>
        </div>
    )
}
