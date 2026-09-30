import { useCallback, useEffect, useMemo, useState } from 'react'
import { ConvertOptionsPanel, FormatTabs, type PanelStats } from '@/components/ConvertOptionsPanel'
import { DropBar, EmptyDrop } from '@/components/DropZone'
import { FileRow } from '@/components/FileRow'
import { JobLogDialog } from '@/components/JobLogDialog'
import { Button, Card, Label, ProgressBar } from '@/components/ui'
import type { QueueApi } from '@/hooks/useQueue'
import { DEFAULT_CONVERT_OPTIONS, planForItem, type ConvertOptions } from '@/lib/convertPlan'
import type { ProcessingPreference } from '@/lib/settings'
import { AUDIO_FORMATS, KIND_LABEL, formatSize, isActive, type MediaKind, type QueueItem } from '@/types'

const OPTIONS_KEY = 'convertisseur_convert_options_v2'

function loadOptions(): ConvertOptions {
    try {
        const raw = localStorage.getItem(OPTIONS_KEY)
        // Trim / slideshow / overlay are per-batch choices: never restore them.
        if (raw) return { ...DEFAULT_CONVERT_OPTIONS, ...JSON.parse(raw), trimStart: '', trimEnd: '', slideshow: false, overlayText: '' }
    } catch {
        // ignore
    }
    return DEFAULT_CONVERT_OPTIONS
}

const KIND_ORDER: MediaKind[] = ['video', 'audio', 'image', 'pdf', 'document', '3d']

function panelStats(list: QueueItem[]): PanelStats {
    const kinds = new Set<MediaKind>()
    const videoTargets = new Set<string>()
    const imageTargets = new Set<string>()
    let gifs = 0, audioOut = 0, images = 0, pendingImages = 0
    for (const it of list) {
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
            if (it.status === 'pending' && it.file) pendingImages++
        }
    }
    return {
        kinds: KIND_ORDER.filter((k) => kinds.has(k)),
        videoTargets: [...videoTargets],
        gifs, audioOut, images,
        imageTargets: [...imageTargets],
        pendingImages,
        zip: list.some((it) => it.kind === 'video' && it.targetFormat === 'zip'),
    }
}

export function ConvertPage({
    queue,
    processing,
    retentionHours,
    autoDownload,
    onAutoDownload,
    exportMode,
    background,
}: {
    queue: QueueApi
    processing: ProcessingPreference
    retentionHours: number
    autoDownload: boolean
    onAutoDownload: (v: boolean) => void
    exportMode: 'zip' | 'files'
    background: boolean
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

    // Per-file settings ("Réglages de ce fichier").
    const [overrides, setOverrides] = useState<Record<string, ConvertOptions>>({})
    const [editingId, setEditingId] = useState<string | null>(null)
    const editing = editingId ? items.find((it) => it.id === editingId) ?? null : null
    const optionsFor = useCallback((it: QueueItem) => overrides[it.id] ?? options, [overrides, options])

    const [logItem, setLogItem] = useState<QueueItem | null>(null)

    const stats = useMemo(() => {
        const pending = items.filter((it) => it.status === 'pending' && it.file)
        const running = items.filter((it) => isActive(it.status))
        const done = items.filter((it) => it.status === 'done')
        const tracked = items.filter((it) => it.status !== 'pending' && it.kind !== 'unknown')
        const overall = tracked.length
            ? Math.round(tracked.reduce((n, it) => n + (it.status === 'done' || it.status === 'error' ? 100 : it.status === 'processing' ? 50 + it.progress / 2 : it.status === 'uploading' ? it.progress / 2 : 0), 0) / tracked.length)
            : 0
        return {
            panel: panelStats(items),
            pending,
            running,
            done,
            errors: items.filter((it) => it.status === 'error').length,
            overall,
            doneBytes: done.reduce((n, it) => n + (it.outputSize ?? 0), 0),
            pendingImages: pending.filter((it) => it.kind === 'image').length,
        }
    }, [items])

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
        setEditingId(null)
        queue.run(pending.map((it) => ({ id: it.id, plan: planForItem(it, optionsFor(it), processing) })))
    }, [stats.pending, slideshow, options, processing, queue, setOptions, optionsFor])

    const retry = useCallback((id: string) => {
        const it = queue.items.find((i) => i.id === id)
        if (it) queue.run([{ id, plan: planForItem(it, optionsFor(it), processing) }])
    }, [queue, optionsFor, processing])

    const onFormat = useCallback((id: string, format: string) => {
        queue.setFormat(id, format)
        const it = queue.items.find((i) => i.id === id)
        if (it && (it.status === 'done' || it.status === 'error')) queue.reset(id)
    }, [queue])

    const addFiles = useCallback((files: File[]) => { queue.add(files) }, [queue])

    const onEdit = useCallback((it: QueueItem) => {
        setEditingId((cur) => (cur === it.id ? null : it.id))
    }, [])

    const setEditedOptions = useCallback((patch: Partial<ConvertOptions>) => {
        if (!editingId) return setOptions(patch)
        setOverrides((prev) => ({ ...prev, [editingId]: { ...(prev[editingId] ?? options), ...patch } }))
        const it = queue.items.find((i) => i.id === editingId)
        if (it && (it.status === 'done' || it.status === 'error')) queue.reset(editingId)
    }, [editingId, options, setOptions, queue])

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
            <>
                <EmptyDrop
                    title="Dépose tes fichiers"
                    subtitle="Vidéo, audio, image, PDF, documents Office ou modèles 3D — un fichier, plusieurs, ou des dossiers entiers."
                    onFiles={addFiles}
                />
                <Compat />
            </>
        )
    }

    const pendingCount = stats.pending.length
    const convertCount = slideshow ? pendingCount - stats.pendingImages + 1 : pendingCount
    const shownOptions = editing ? overrides[editing.id] ?? options : options
    const shownStats = editing ? panelStats([editing]) : stats.panel
    const allFinished = stats.running.length === 0 && pendingCount === 0

    return (
        <>
            <DropBar onFiles={addFiles} />

            {stats.running.length > 0 && (
                <Card>
                    <div className="flex items-center justify-between px-5 pt-4 pb-2.5 text-[13px]">
                        <span>
                            {stats.running.some((it) => it.status === 'uploading') ? 'Envoi et conversion' : 'Conversion'} de {stats.running.length} fichier{stats.running.length > 1 ? 's' : ''}…
                        </span>
                        <span className="font-bold tabular-nums">{stats.overall}%</span>
                    </div>
                    <ProgressBar value={stats.overall} className="mx-5 w-auto rounded-none" />
                    <div className="flex justify-between px-5 pt-2 pb-4 text-[11px] text-faint">
                        <span>{stats.done.length} terminé{stats.done.length > 1 ? 's' : ''}{stats.errors ? ` · ${stats.errors} en erreur` : ''}</span>
                        <span>
                            {stats.running.some((it) => it.status === 'uploading') ? 'Garde la page ouverte pendant l’envoi.'
                                : stats.running.some((it) => it.local) ? 'Garde la page ouverte : conversion dans ton navigateur.'
                                    : background ? 'Tu peux fermer la page : le serveur continue.'
                                        : 'Garde la page ouverte (arrière-plan désactivé).'}
                        </span>
                    </div>
                </Card>
            )}

            {allFinished && stats.done.length > 0 && (
                <div className="fade-up flex flex-wrap items-center gap-3.5 rounded-[4px] border border-success/25 bg-success/[0.06] px-5 py-4">
                    <span className="text-lg text-success">✓</span>
                    <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold">Terminé</p>
                        <p className="truncate text-[11px] text-faint">
                            {stats.done.length} fichier{stats.done.length > 1 ? 's' : ''}{stats.doneBytes ? ` · ${formatSize(stats.doneBytes)}` : ''}
                            {stats.errors ? ` · ${stats.errors} en erreur` : ''}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => void queue.downloadMany(stats.done)}
                        className="rounded-[3px] bg-success px-4 py-2 text-xs font-bold text-black transition-opacity hover:opacity-85"
                    >
                        {stats.done.length > 1 ? (exportMode === 'zip' ? 'Tout sauvegarder (.zip)' : `Tout sauvegarder (${stats.done.length})`) : 'Sauvegarder'}
                    </button>
                </div>
            )}

            <Card>
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                    <Label>Fichiers · {items.length}</Label>
                    <Button size="sm" className="h-7" onClick={() => { setEditingId(null); setOverrides({}); void queue.clear() }}>Tout effacer</Button>
                </div>
                <div className="scroll-thin max-h-[480px] divide-y divide-border overflow-y-auto">
                    {items.map((it) => (
                        <FileRow
                            key={it.id}
                            item={it}
                            custom={!!overrides[it.id]}
                            editing={editingId === it.id}
                            onFormat={onFormat}
                            onRemove={queue.remove}
                            onRetry={retry}
                            onDownload={queue.download}
                            onShowLog={setLogItem}
                            onEdit={onEdit}
                        />
                    ))}
                </div>
            </Card>

            <Card>
                <div className="flex flex-col gap-6 p-6 sm:p-7">
                    {editing ? (
                        <div className="flex flex-wrap items-center gap-2 rounded-[4px] border border-input px-3 py-2.5">
                            <div className="min-w-0 flex-1">
                                <Label>Réglages de ce fichier uniquement</Label>
                                <p className="truncate text-[13px] font-semibold">{editing.name}</p>
                            </div>
                            {overrides[editing.id] && (
                                <Button size="sm" onClick={() => setOverrides((prev) => {
                                    const next = { ...prev }
                                    delete next[editing.id]
                                    return next
                                })}>Revenir aux réglages communs</Button>
                            )}
                            <Button size="sm" variant="primary" onClick={() => setEditingId(null)}>OK</Button>
                        </div>
                    ) : null}

                    {editing ? (
                        editing.kind !== 'unknown' && editing.kind !== 'sequence' && (
                            <FormatTabs kind={editing.kind} value={editing.targetFormat} onChange={(v) => onFormat(editing.id, v)} label="Format" />
                        )
                    ) : (
                        stats.panel.kinds.map((kind) => (
                            <FormatTabs key={kind} kind={kind} value={queue.kindFormats[kind]} onChange={(v) => queue.setFormatForKind(kind, v)}
                                label={`${KIND_LABEL[kind]} → format`} />
                        ))
                    )}

                    <ConvertOptionsPanel o={shownOptions} set={setEditedOptions} stats={shownStats} />

                    {!editing && (
                        <>
                            <label className="flex cursor-pointer items-center gap-2 text-[13px] text-muted-foreground select-none">
                                <input type="checkbox" checked={autoDownload} onChange={(e) => onAutoDownload(e.target.checked)} className="h-[15px] w-[15px] accent-primary" />
                                Télécharger automatiquement à la fin
                            </label>
                            <Button variant="primary" size="lg" className="w-full" disabled={convertCount === 0} onClick={start} title="Ctrl + Entrée">
                                {convertCount > 0 ? `Convertir ${convertCount > 1 ? `${convertCount} fichiers` : 'le fichier'}` : allFinished ? 'Tout est converti' : 'Conversion en cours…'}
                            </Button>
                        </>
                    )}
                </div>
            </Card>

            <p className="text-center text-[11px] text-faint">
                Les fichiers envoyés au serveur sont supprimés automatiquement après {retentionHours} h. Glisse d'autres fichiers n'importe où pour les ajouter.
            </p>

            {logItem && <JobLogDialog item={logItem} onClose={() => setLogItem(null)} />}
        </>
    )
}

function Compat() {
    const groups: [string, string][] = [
        ['Vidéo', 'MP4 · MOV · MKV · WebM · AVI · GIF'],
        ['Audio', 'MP3 · M4A · FLAC · WAV · Opus'],
        ['Image', 'JPG · PNG · WebP · AVIF · HEIC · RAW'],
        ['Documents', 'PDF · Word · Excel · PowerPoint'],
        ['3D', 'GLB · OBJ · STL · PLY'],
    ]
    return (
        <footer className="border-t border-border pt-8">
            <Label className="mb-5">Compatible avec</Label>
            <div className="flex flex-wrap gap-x-7 gap-y-4">
                {groups.map(([name, formats]) => (
                    <div key={name} className="text-faint transition-colors hover:text-foreground">
                        <p className="text-xs font-semibold">{name}</p>
                        <p className="text-[11px]">{formats}</p>
                    </div>
                ))}
            </div>
        </footer>
    )
}
