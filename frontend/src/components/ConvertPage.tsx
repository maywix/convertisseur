import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { FilePickers, EmptyDrop } from '@/components/DropZone'
import { ConvertOptionsPanel, type PanelStats } from '@/components/ConvertOptionsPanel'
import { FileRow } from '@/components/FileRow'
import { IconAudio, IconDownload, IconImage, IconPlay, IconVideo } from '@/components/icons'
import { JobLogDialog } from '@/components/JobLogDialog'
import { Button } from '@/components/ui'
import type { QueueApi } from '@/hooks/useQueue'
import { DEFAULT_CONVERT_OPTIONS, planForItem, type ConvertOptions } from '@/lib/convertPlan'
import type { ProcessingPreference } from '@/lib/settings'
import { AUDIO_FORMATS, isActive, type MediaKind, type QueueItem } from '@/types'

const OPTIONS_KEY = 'convertisseur_convert_options_v2'

function loadOptions(): ConvertOptions {
    try {
        const raw = localStorage.getItem(OPTIONS_KEY)
        // Trim / slideshow are per-batch choices: never restore them.
        if (raw) return { ...DEFAULT_CONVERT_OPTIONS, ...JSON.parse(raw), trimStart: '', trimEnd: '', slideshow: false }
    } catch {
        // ignore
    }
    return DEFAULT_CONVERT_OPTIONS
}

const KIND_ORDER: MediaKind[] = ['video', 'audio', 'image', 'pdf', 'document', '3d']

export function ConvertPage({
    queue,
    processing,
    retentionHours,
}: {
    queue: QueueApi
    processing: ProcessingPreference
    retentionHours: number
}) {
    const { items } = queue
    const [options, setOptionsState] = useState<ConvertOptions>(loadOptions)
    const setOptions = useCallback((patch: Partial<ConvertOptions>) => {
        setOptionsState((prev) => {
            const next = { ...prev, ...patch }
            try { localStorage.setItem(OPTIONS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
            return next
        })
    }, [])

    const stats = useMemo(() => {
        const kinds = new Set<MediaKind>()
        const videoTargets = new Set<string>()
        const imageTargets = new Set<string>()
        const pending = items.filter((it) => it.status === 'pending' && it.file)
        let gifs = 0, audioOut = 0, images = 0, pendingImages = 0
        for (const it of items) {
            if (it.kind !== 'unknown' && it.kind !== 'sequence') kinds.add(it.kind)
            if (it.kind === 'video') {
                if (it.targetFormat === 'gif') gifs++
                else if (AUDIO_FORMATS.has(it.targetFormat)) audioOut++
                else if (it.targetFormat !== 'zip') videoTargets.add(it.targetFormat)
            }
            if (it.kind === 'audio') audioOut++
            if (it.kind === 'image') {
                images++
                imageTargets.add(it.targetFormat)
            }
        }
        for (const it of pending) if (it.kind === 'image') pendingImages++
        const panel: PanelStats = {
            kinds: KIND_ORDER.filter((k) => kinds.has(k)),
            videoTargets: [...videoTargets],
            gifs, audioOut, images,
            imageTargets: [...imageTargets],
            pendingImages,
            zip: items.some((it) => it.kind === 'video' && it.targetFormat === 'zip'),
        }
        return {
            panel,
            pending,
            pendingImages,
            done: items.filter((it) => it.status === 'done'),
            active: items.filter((it) => isActive(it.status)).length,
        }
    }, [items])

    const [logItem, setLogItem] = useState<QueueItem | null>(null)

    const slideshow = options.slideshow && stats.pendingImages >= 2

    const start = useCallback(() => {
        let pending = stats.pending
        if (slideshow) {
            const images = pending
                .filter((it) => it.kind === 'image')
                .sort((a, b) => (a.relativePath || a.name).localeCompare(b.relativePath || b.name, undefined, { numeric: true }))
            const [first, ...rest] = images
            const id = queue.addItem({
                file: first.file, extraFiles: rest.map((it) => it.file!), name: `Diaporama · ${images.length} images`,
                size: images.reduce((n, it) => n + it.size, 0), kind: 'sequence', relativePath: '',
                targetFormat: options.slideshowFormat, status: 'pending', progress: 0, jobId: null, local: false,
                downloadUrl: null, outputName: null, outputSize: null, error: null,
            })
            queue.remove(images.map((it) => it.id))
            pending = pending.filter((it) => it.kind !== 'image')
            queue.run([{ id, plan: planForItem({ ...first, kind: 'sequence', targetFormat: options.slideshowFormat }, options, processing) }])
            setOptions({ slideshow: false })
        }
        queue.run(pending.map((it) => ({ id: it.id, plan: planForItem(it, options, processing) })))
    }, [stats.pending, slideshow, options, processing, queue, setOptions])

    const retry = useCallback((id: string) => {
        const it = queue.items.find((i) => i.id === id)
        if (it) queue.run([{ id, plan: planForItem(it, options, processing) }])
    }, [queue, options, processing])

    const onFormat = useCallback((id: string, format: string) => {
        queue.setFormat(id, format)
        const it = queue.items.find((i) => i.id === id)
        if (it && (it.status === 'done' || it.status === 'error')) queue.reset(id)
    }, [queue])

    const addFiles = useCallback((files: File[]) => { queue.add(files) }, [queue])

    // Ctrl/⌘+Enter launches the conversion.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && stats.pending.length) start()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [start, stats.pending.length])

    if (items.length === 0) {
        return (
            <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-16">
                <EmptyDrop
                    title="Dépose tes fichiers"
                    subtitle="Vidéo, audio, image, PDF, documents Office ou modèles 3D. Choisis le format, clique sur Convertir, c'est tout."
                    onFiles={addFiles}
                />
                <div className="mt-6 grid gap-3 text-sm sm:grid-cols-3">
                    <Hint icon={<IconVideo size={16} />} title="Vidéo">MP4, WebM, GIF, extraction du son, taille cible pour Discord…</Hint>
                    <Hint icon={<IconImage size={16} />} title="Image">JPG, PNG, WebP, AVIF, HEIC, RAW… converties sur place quand c'est possible.</Hint>
                    <Hint icon={<IconAudio size={16} />} title="Audio">MP3, M4A, FLAC, WAV, Opus, avec normalisation du volume.</Hint>
                </div>
            </div>
        )
    }

    const pendingCount = stats.pending.length
    const convertLabel = slideshow
        ? `Convertir (${pendingCount - stats.pendingImages + 1})`
        : pendingCount > 0 ? `Convertir ${pendingCount > 1 ? `${pendingCount} fichiers` : 'le fichier'}` : 'Convertir'

    return (
        <div className="mx-auto grid w-full max-w-[1400px] gap-5 px-4 py-5 pb-28 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6 lg:px-6 lg:pb-5">
            <main className="min-w-0">
                <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
                        <h2 className="mr-auto text-sm font-semibold">
                            {items.length} fichier{items.length > 1 ? 's' : ''}
                            {stats.done.length > 0 && (
                                <span className="ml-2 font-normal text-success">· {stats.done.length} prêt{stats.done.length > 1 ? 's' : ''}</span>
                            )}
                            {stats.active > 0 && <span className="ml-2 font-normal text-primary">· {stats.active} en cours</span>}
                        </h2>
                        <FilePickers onFiles={addFiles} compact />
                        <Button variant="ghost" size="sm" onClick={() => void queue.clear()} className="hover:text-destructive">
                            Tout effacer
                        </Button>
                    </div>
                    <div className="divide-y divide-border">
                        {items.map((it) => (
                            <FileRow
                                key={it.id}
                                item={it}
                                onFormat={onFormat}
                                onRemove={queue.remove}
                                onRetry={retry}
                                onDownload={queue.download}
                                onShowLog={options.advanced ? setLogItem : undefined}
                            />
                        ))}
                    </div>
                </div>
                <p className="mt-3 text-center text-xs text-muted-foreground">
                    Les fichiers envoyés au serveur sont supprimés automatiquement après {retentionHours} h.
                    Glisse d'autres fichiers n'importe où pour les ajouter.
                </p>
            </main>

            <aside className="min-w-0 lg:sticky lg:top-[72px] lg:self-start">
                <div className="flex flex-col lg:max-h-[calc(100vh-104px)] overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
                        <ConvertOptionsPanel
                            o={options}
                            set={setOptions}
                            stats={stats.panel}
                            kindFormats={queue.kindFormats}
                            setFormatForKind={queue.setFormatForKind}
                        />
                    </div>

                    <div className="hidden space-y-2 border-t border-border p-4 lg:block">
                        <ActionButtons
                            convertLabel={convertLabel}
                            pending={pendingCount}
                            done={stats.done.length}
                            onStart={start}
                            onDownloadAll={() => void queue.downloadMany(stats.done)}
                        />
                    </div>
                </div>
            </aside>

            {logItem && <JobLogDialog item={logItem} onClose={() => setLogItem(null)} />}

            {/* Mobile action bar */}
            <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 p-3 backdrop-blur lg:hidden">
                <div className="mx-auto flex max-w-xl gap-2">
                    <ActionButtons
                        convertLabel={convertLabel}
                        pending={pendingCount}
                        done={stats.done.length}
                        onStart={start}
                        onDownloadAll={() => void queue.downloadMany(stats.done)}
                        row
                    />
                </div>
            </div>
        </div>
    )
}

function ActionButtons({
    convertLabel, pending, done, onStart, onDownloadAll, row,
}: {
    convertLabel: string
    pending: number
    done: number
    onStart: () => void
    onDownloadAll: () => void
    row?: boolean
}) {
    const allDone = pending === 0 && done > 0
    const download = done > 0 && (
        <Button
            variant={allDone ? 'primary' : 'secondary'}
            size="lg"
            className={row ? 'flex-1' : 'w-full'}
            onClick={onDownloadAll}
        >
            <IconDownload size={16} />
            {done > 1 ? `Tout télécharger (${done})` : 'Télécharger'}
        </Button>
    )
    return (
        <>
            {allDone && download}
            {(!allDone || !row) && (
                <Button
                    variant={allDone ? 'secondary' : 'primary'}
                    size="lg"
                    className={row ? 'flex-1' : 'w-full'}
                    disabled={pending === 0}
                    onClick={onStart}
                    title="Ctrl + Entrée"
                >
                    <IconPlay size={15} />
                    {convertLabel}
                </Button>
            )}
            {!allDone && download}
        </>
    )
}

function Hint({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
    return (
        <div className="rounded-xl border border-border bg-card/60 p-4">
            <p className="flex items-center gap-2 font-semibold"><span className="text-primary">{icon}</span>{title}</p>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{children}</p>
        </div>
    )
}
