import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { UploadZone } from './UploadZone'
import { FileItem } from './FileItem'
import type { QueueItem } from '@/types'

interface FileQueueProps {
    queue: QueueItem[]
    onFilesAdded: (files: FileList | File[]) => void
    onRemove: (id: string) => void
    onClearAll: () => void
    hasCompletedFiles: boolean
}

export function FileQueue({ queue, onFilesAdded, onRemove, onClearAll, hasCompletedFiles }: FileQueueProps) {
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
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleDownloadAll}
                        disabled={!hasCompletedFiles}
                        className="text-xs"
                    >
                        📦 Tout télécharger
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onClearAll}
                        className="text-xs text-destructive hover:text-destructive"
                    >
                        🗑️ Tout effacer
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
                        <FileItem key={item.id} item={item} onRemove={onRemove} />
                    ))
                )}
            </ScrollArea>
        </div>
    )
}
