import { useState, useEffect } from 'react'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { IconDownload, IconX } from '@/components/icons'
import type { QueueItem } from '@/types'
import { formatSize, getFileType } from '@/types'

interface FileItemProps {
    item: QueueItem
    onRemove: (id: string) => void
}

export function FileItem({ item, onRemove }: FileItemProps) {
    const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
    const fileType = getFileType(item.file.name)

    useEffect(() => {
        if (fileType === 'image') {
            const reader = new FileReader()
            reader.onload = (e) => {
                const img = new Image()
                img.onload = () => {
                    const canvas = document.createElement('canvas')
                    const size = 90
                    let width = img.width
                    let height = img.height

                    if (width > height) {
                        height = (height / width) * size
                        width = size
                    } else {
                        width = (width / height) * size
                        height = size
                    }

                    canvas.width = width
                    canvas.height = height
                    const ctx = canvas.getContext('2d')
                    ctx?.drawImage(img, 0, 0, width, height)
                    setThumbnailUrl(canvas.toDataURL('image/jpeg', 0.7))
                }
                img.src = e.target?.result as string
            }
            reader.readAsDataURL(item.file)
        }
    }, [item.file, fileType])

    const statusText = {
        pending: 'En attente',
        uploading: 'Envoi...',
        queued: "En file d'attente...",
        processing: 'Traitement en cours...',
        done: 'Terminé',
        error: item.error ? `Erreur: ${item.error}` : 'Erreur',
    }[item.status]

    const progressValue = {
        pending: 0,
        uploading: 25,
        queued: 35,
        processing: 70,
        done: 100,
        error: 100,
    }[item.status]

    const emoji = {
        video: '🎬',
        audio: '🎵',
        image: '🖼️',
        unknown: '📄',
    }[fileType]

    return (
        <div className="flex items-center gap-4 p-3 bg-background rounded-lg border border-border mb-2">
            {/* Thumbnail */}
            <div className="w-14 h-14 min-w-14 rounded-md overflow-hidden bg-muted flex items-center justify-center">
                {thumbnailUrl ? (
                    <img src={thumbnailUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                    <span className="text-2xl">{emoji}</span>
                )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0 overflow-hidden">
                <div className="font-medium text-sm truncate pr-6" title={item.relativePath || item.file.name}>
                    {item.relativePath || item.file.name}
                </div>
                <div className={`text-xs mt-1 ${item.status === 'done' ? 'text-emerald-500' :
                        item.status === 'error' ? 'text-destructive' :
                            'text-muted-foreground'
                    }`}>
                    {formatSize(item.file.size)} • {statusText}
                </div>
                <div className="mt-1.5">
                    <Progress
                        value={progressValue}
                        className={`h-1 ${item.status === 'done' ? '[&>div]:bg-emerald-500' :
                                item.status === 'error' ? '[&>div]:bg-destructive' : ''
                            }`}
                    />
                </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-1 shrink-0 items-center">
                {item.status !== 'done' && (
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onRemove(item.id)}
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        aria-label="Retirer le fichier"
                    >
                        <IconX size={16} />
                    </Button>
                )}
                {item.status === 'done' && item.downloadUrl && (
                    <a
                        href={item.downloadUrl}
                        download={item.outputFilename || undefined}
                        className="flex items-center justify-center h-8 w-8 bg-emerald-500 text-white rounded-md hover:bg-emerald-600 transition-colors"
                        aria-label="Télécharger le fichier converti"
                    >
                        <IconDownload size={16} />
                    </a>
                )}
            </div>
        </div>
    )
}
