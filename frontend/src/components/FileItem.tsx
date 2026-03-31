import { useState, useEffect } from 'react'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { IconDownload, IconX } from '@/components/icons'
import type { CompressSettings, QueueItem } from '@/types'
import { formatSize, getFileType } from '@/types'

interface FileItemProps {
    item: QueueItem
    currentAction: 'convert' | 'compress'
    defaultFormat: string
    formats: {
        video: string[]
        audio: string[]
        image: string[]
        unknown: string[]
    }
    onRemove: (id: string) => void
    onRequeue: (id: string) => void
    onSetItemTargetFormat: (id: string, format: string) => void
    onSetItemCustomAction: (id: string, action: 'convert' | 'compress') => void
    onSetItemCustomCompressSettings: (id: string, patch: Partial<CompressSettings>) => void
    onSetItemOutputMode: (id: string, mode: 'global' | 'custom') => void
}

export function FileItem({
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

    const availableFormats = formats[fileType]
    const selectedFormat = item.targetFormat || defaultFormat
    const customCompress = item.customCompressSettings

    return (
        <div className="flex flex-col gap-3 p-3 bg-[#0d1017] rounded-xl border border-white/10 mb-3">
            <div className="flex items-center gap-4 w-full overflow-hidden">
                <div className="w-14 h-14 min-w-14 flex-shrink-0 rounded-md overflow-hidden bg-muted flex items-center justify-center">
                    {thumbnailUrl ? (
                        <img src={thumbnailUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                        <span className="text-2xl">{emoji}</span>
                    )}
                </div>

                <div className="flex-1 min-w-0 overflow-hidden max-w-[calc(100%-120px)]">
                    <div className="font-medium text-sm truncate pr-6" title={item.relativePath || item.file.name}>
                        {item.relativePath || item.file.name}
                    </div>
                    <div className={`text-xs mt-1 ${item.status === 'done'
                        ? 'text-emerald-500'
                        : item.status === 'error'
                            ? 'text-destructive'
                            : 'text-muted-foreground'
                        }`}>
                        {formatSize(item.file.size)} • {statusText}
                    </div>
                    <div className="mt-1.5">
                        <Progress
                            value={progressValue}
                            className={`h-1 ${item.status === 'done' ? '[&>div]:bg-emerald-500' : item.status === 'error' ? '[&>div]:bg-destructive' : ''}`}
                        />
                    </div>
                </div>

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

            {availableFormats.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-3 items-center">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>Mode global</span>
                        <Switch
                            checked={item.outputMode === 'custom'}
                            onCheckedChange={(checked) =>
                                onSetItemOutputMode(item.id, checked ? 'custom' : 'global')
                            }
                        />
                        <span>Mode fichier</span>
                    </div>
                    <div className="flex flex-col gap-2">
                        <Select
                            value={item.customAction || currentAction}
                            onValueChange={(v) => onSetItemCustomAction(item.id, v as 'convert' | 'compress')}
                            disabled={item.outputMode === 'global'}
                        >
                            <SelectTrigger className="h-9">
                                <SelectValue placeholder="Action" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="convert">Convertir</SelectItem>
                                <SelectItem value="compress">Compresser</SelectItem>
                            </SelectContent>
                        </Select>
                        {(item.customAction || currentAction) === 'convert' && (
                            <Select
                                value={selectedFormat || undefined}
                                onValueChange={(v) => onSetItemTargetFormat(item.id, v)}
                                disabled={item.outputMode === 'global'}
                            >
                                <SelectTrigger className="h-9">
                                    <SelectValue placeholder="Format de sortie" />
                                </SelectTrigger>
                                <SelectContent>
                                    {availableFormats.map((fmt) => (
                                        <SelectItem key={fmt} value={fmt}>
                                            {fmt.toUpperCase()}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                        {(item.customAction || currentAction) === 'compress' && (
                            <div className="grid grid-cols-2 gap-2">
                                <Select
                                    value={customCompress?.mode || 'size'}
                                    onValueChange={(v) =>
                                        onSetItemCustomCompressSettings(item.id, {
                                            mode: v as CompressSettings['mode'],
                                        })
                                    }
                                    disabled={item.outputMode === 'global'}
                                >
                                    <SelectTrigger className="h-9">
                                        <SelectValue placeholder="Mode" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="size">Taille MB</SelectItem>
                                        <SelectItem value="percent">Réduction %</SelectItem>
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
                                    disabled={item.outputMode === 'global'}
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
                                    className="h-9 px-3 rounded-md border border-input bg-card text-sm"
                                />
                            </div>
                        )}
                    </div>
                </div>
            )}

            {(item.status === 'done' || item.status === 'error') && (
                <div className="flex justify-end">
                    <Button size="sm" variant="outline" onClick={() => onRequeue(item.id)}>
                        Reconvertir ce fichier
                    </Button>
                </div>
            )}
        </div>
    )
}