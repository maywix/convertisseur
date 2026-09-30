import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
    ActionPicker, CategoryPicker, CompressFields, DetailSwitch, FormatChips, FormatSelect, OptionGroups, StepTitle,
} from '@/components/ConvertOptionsPanel'
import { DropCard } from '@/components/DropZone'
import { FileRow } from '@/components/FileRow'
import { JobLogDialog } from '@/components/JobLogDialog'
import { IconDownload, IconPlay, IconPlus, IconTrash } from '@/components/icons'
import { Button, Label, ProgressBar, Select, Toggle } from '@/components/ui'
import type { QueueApi } from '@/hooks/useQueue'
import {
    CATEGORY_FORMATS, CATEGORY_KINDS, DEFAULT_CONVERT_OPTIONS, categoryOfItem, groupsFor, groupsForKinds, inferCategory, planForItem,
    type Category, type ConvertOptions,
} from '@/lib/convertPlan'
import type { ProcessingPreference } from '@/lib/settings'
import { AUDIO_FORMATS, FORMATS, KIND_LABEL, formatSize, isActive, type MediaKind, type QueueItem } from '@/types'

const OPTIONS_KEY = 'convertisseur_convert_options_v3'

function loadOptions(): ConvertOptions {
    try {
        const raw = localStorage.getItem(OPTIONS_KEY) ?? localStorage.getItem('convertisseur_convert_options_v2')
        if (raw) {
            const saved = JSON.parse(raw) as Record<string, unknown>
            const o = { ...DEFAULT_CONVERT_OPTIONS, ...saved } as ConvertOptions & Record<string, unknown>
            // Earlier versions kept compression targets in the video quality.
            if (saved.videoQuality === 'size' || saved.videoQuality === 'percent') o.videoQuality = 'balanced'
            if (typeof saved.advanced === 'boolean' && saved.detail === undefined) o.detail = saved.advanced ? 'advanced' : 'simple'
            delete o.advanced
            delete o.videoTargetMb
            delete o.videoPercent
            // Action, type, cuts and text are per-batch choices: never restored.
            return { ...o, action: 'convert', category: null, trimStart: '', trimEnd: '', slideshow: false, overlayText: '' }
        }
    } catch {
        // ignore
    }
    return DEFAULT_CONVERT_OPTIONS
}

const KIND_ORDER: MediaKind[] = ['video', 'audio', 'image', 'pdf', 'document', '3d']

/** Format currently chosen for an output type. */
function categoryFormat(cat: Category, kindFormats: Record<MediaKind, string>, o: ConvertOptions): string {
    switch (cat) {
        case 'video': return AUDIO_FORMATS.has(kindFormats.video) ? 'mp4' : kindFormats.video
        case 'audio': return kindFormats.audio
        case 'image': return kindFormats.image
        case 'slideshow': return o.slideshowFormat
        case 'document': return 'pdf'
        case '3d': return kindFormats['3d']
    }
}

function Step({ n, title, aside, children }: { n: number; title: string; aside?: ReactNode; children: ReactNode }) {
    return (
        <section>
            <StepTitle n={n} aside={aside}>{title}</StepTitle>
            {children}
        </section>
    )
}

export function ConvertPage({
    queue,
    processing,
    retentionHours,
    autoDownload,
    onAutoDownload,
    exportMode,
    onExportMode,
    background,
    onBackground,
}: {
    queue: QueueApi
    processing: ProcessingPreference
    retentionHours: number
    autoDownload: boolean
    onAutoDownload: (v: boolean) => void
    exportMode: 'zip' | 'files'
    onExportMode: (v: 'zip' | 'files') => void
    background: boolean
    onBackground: (v: boolean) => void
}) {
    const { items, kindFormats } = queue
    const [options, setOptionsState] = useState<ConvertOptions>(loadOptions)
    const setOptions = useCallback((patch: Partial<ConvertOptions>) => {
        setOptionsState((prev) => {
            const next = { ...prev, ...patch }
            try { localStorage.setItem(OPTIONS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
            return next
        })
    }, [])

    // Per-file settings (⚙ on a row).
    const [overrides, setOverrides] = useState<Record<string, ConvertOptions>>({})
    const [editingId, setEditingId] = useState<string | null>(null)
    const editing = editingId ? items.find((it) => it.id === editingId) ?? null : null
    const optionsFor = useCallback((it: QueueItem) => overrides[it.id] ?? options, [overrides, options])

    const [logItem, setLogItem] = useState<QueueItem | null>(null)

    // Step 2 preselects a type from the files until one is picked.
    const category = options.category ?? inferCategory(items)
    const format = category ? categoryFormat(category, kindFormats, options) : ''

    const stats = useMemo(() => {
        const pending = items.filter((it) => it.status === 'pending' && it.file)
        const running = items.filter((it) => isActive(it.status))
        const done = items.filter((it) => it.status === 'done')
        const tracked = items.filter((it) => it.status !== 'pending' && it.kind !== 'unknown')
        const overall = tracked.length
            ? Math.round(tracked.reduce((n, it) => n + (it.status === 'done' || it.status === 'error' ? 100 : it.status === 'processing' ? 50 + it.progress / 2 : it.status === 'uploading' ? it.progress / 2 : 0), 0) / tracked.length)
            : 0
        const kinds = new Set<MediaKind>()
        const count = (k: MediaKind) => items.filter((it) => it.kind === k && it.file).length
        for (const it of items) if (it.file && it.kind !== 'unknown' && it.kind !== 'sequence') kinds.add(it.kind)
        return {
            pending,
            running,
            done,
            errors: items.filter((it) => it.status === 'error').length,
            overall,
            doneBytes: done.reduce((n, it) => n + (it.outputSize ?? 0), 0),
            pendingImages: pending.filter((it) => it.kind === 'image').length,
            kinds: KIND_ORDER.filter((k) => kinds.has(k)),
            counts: {
                video: count('video'), audio: count('audio'), image: count('image'), slideshow: count('image'),
                document: count('document') + count('pdf'), '3d': count('3d'),
            } as Partial<Record<Category, number>>,
        }
    }, [items])

    const slideshow = category === 'slideshow' && options.action !== 'compress' && stats.pendingImages > 0

    const applyFormat = useCallback((cat: Category, fmt: string) => {
        if (cat === 'slideshow') return setOptions({ slideshowFormat: fmt as ConvertOptions['slideshowFormat'] })
        for (const kind of CATEGORY_KINDS[cat]) queue.setFormatForKind(kind, kind === 'pdf' ? 'pdf' : fmt)
    }, [queue, setOptions])

    const pickCategory = (cat: Category) => {
        setOptions({ category: cat })
        applyFormat(cat, categoryFormat(cat, kindFormats, options))
    }

    const pickFormat = (fmt: string) => {
        if (!category) return
        if (!options.category) setOptions({ category })
        applyFormat(category, fmt)
    }

    const start = useCallback(() => {
        let pending = stats.pending
        if (slideshow) {
            const images = pending
                .filter((it) => it.kind === 'image')
                .sort((a, b) => (a.relativePath || a.name).localeCompare(b.relativePath || b.name, undefined, { numeric: true }))
            const [first, ...rest] = images
            const id = queue.addItem({
                file: first.file, extraFiles: rest.map((it) => it.file!), name: `Diaporama · ${images.length} image${images.length > 1 ? 's' : ''}`,
                size: images.reduce((n, it) => n + it.size, 0), kind: 'sequence', relativePath: '',
                targetFormat: options.slideshowFormat, status: 'pending', progress: 0, jobId: null, local: false,
                downloadUrl: null, outputName: null, outputSize: null, error: null,
            })
            queue.remove(images.map((it) => it.id))
            pending = pending.filter((it) => it.kind !== 'image')
            queue.run([{ id, plan: planForItem({ ...first, kind: 'sequence', targetFormat: options.slideshowFormat }, options, processing) }])
        }
        setEditingId(null)
        queue.run(pending.map((it) => ({ id: it.id, plan: planForItem(it, optionsFor(it), processing) })))
    }, [stats.pending, slideshow, options, processing, queue, optionsFor])

    const retry = useCallback((id: string) => {
        const it = queue.items.find((i) => i.id === id)
        if (it) queue.run([{ id, plan: planForItem(it, optionsFor(it), processing) }])
    }, [queue, optionsFor, processing])

    const onFormat = useCallback((id: string, fmt: string) => {
        queue.setFormat(id, fmt)
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

    // ── Settings column ──
    const o: ConvertOptions = editing ? { ...(overrides[editing.id] ?? options), detail: options.detail } : options
    const set = editing ? setEditedOptions : setOptions
    const compressing = o.action !== 'convert'
    const covered = category ? CATEGORY_KINDS[category] : []
    const otherKinds = stats.kinds.filter((k) => !covered.includes(k))
    const editCategory = editing ? categoryOfItem(editing) : null
    const groups = o.action === 'compress'
        ? groupsForKinds(editing ? (editing.kind === 'unknown' || editing.kind === 'sequence' ? [] : [editing.kind]) : stats.kinds, o)
        : editing ? groupsFor(editCategory, editing.targetFormat, o) : groupsFor(category, format, o)
    const shownFormat = editing ? editing.targetFormat : format
    const noOptionsNote = !compressing && (editing ? editCategory : category)
    let step = 1

    const pendingCount = stats.pending.length
    const startCount = slideshow ? pendingCount - stats.pendingImages + 1 : pendingCount
    const allFinished = stats.running.length === 0 && pendingCount === 0
    const verb = options.action === 'compress' ? 'Démarrer la compression' : 'Démarrer la conversion'

    const settings = (
        <div className="flex flex-col overflow-hidden rounded-[4px] border border-border bg-card lg:max-h-[calc(100vh-32px)]">
            <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
                <div className="min-w-0">
                    <h2 className="text-[15px] font-bold">Réglages</h2>
                    <p className="mt-0.5 text-[11px] text-faint">Simple par défaut, complet si nécessaire.</p>
                </div>
                <DetailSwitch value={options.detail} onChange={(v) => setOptions({ detail: v })} />
            </div>

            {editing && (
                <div className="flex flex-wrap items-center gap-2 border-b border-border bg-foreground/[0.04] px-5 py-3">
                    <div className="min-w-0 flex-1">
                        <Label>Ce fichier uniquement</Label>
                        <p className="mt-0.5 truncate text-[13px] font-bold" title={editing.name}>{editing.name}</p>
                    </div>
                    {overrides[editing.id] && (
                        <Button size="sm" onClick={() => setOverrides((prev) => {
                            const next = { ...prev }
                            delete next[editing.id]
                            return next
                        })}>Réglages communs</Button>
                    )}
                    <Button size="sm" variant="primary" onClick={() => setEditingId(null)}>OK</Button>
                </div>
            )}

            <div className="scroll-thin min-h-0 flex-1 space-y-7 overflow-y-auto px-5 py-5">
                <Step n={step++} title="Action">
                    <ActionPicker value={o.action} onChange={(a) => set({ action: a })} />
                </Step>

                {o.action !== 'compress' && !editing && (
                    <>
                        <Step n={step++} title="Type de média">
                            <CategoryPicker value={category} counts={stats.counts} onChange={pickCategory} />
                        </Step>
                        <Step n={step++} title="Format de sortie">
                            {category ? (
                                <FormatChips formats={CATEGORY_FORMATS[category]} value={format} onChange={pickFormat} />
                            ) : (
                                <p className="text-[12px] text-faint italic">Choisis un type d'abord (ou ajoute des fichiers).</p>
                            )}
                            {category === 'audio' && stats.counts.video ? (
                                <p className="mt-2.5 text-[11px] text-faint">Les vidéos de la file deviennent aussi des fichiers son.</p>
                            ) : null}
                            {category === 'document' && (
                                <p className="mt-2.5 text-[11px] text-faint">Word, Excel, PowerPoint, OpenDocument, RTF, CSV… vers PDF (LibreOffice). Les PDF sont allégés.</p>
                            )}
                            {otherKinds.length > 0 && (
                                <div className="mt-4 rounded-[4px] border border-border p-3">
                                    <p className="mb-2.5 text-[11px] text-faint">Les autres fichiers de la file :</p>
                                    <div className="grid grid-cols-2 gap-2.5">
                                        {otherKinds.map((k) => (
                                            <FormatSelect key={k} label={`${KIND_LABEL[k]} en`} value={kindFormats[k]} options={FORMATS[k]}
                                                onChange={(v) => queue.setFormatForKind(k, v)} />
                                        ))}
                                    </div>
                                </div>
                            )}
                        </Step>
                    </>
                )}

                {o.action !== 'compress' && editing && editing.kind !== 'unknown' && (
                    <Step n={step++} title="Format de sortie">
                        <FormatChips formats={editing.kind === 'sequence' ? CATEGORY_FORMATS.slideshow : FORMATS[editing.kind]} value={editing.targetFormat}
                            onChange={(v) => onFormat(editing.id, v)} />
                    </Step>
                )}

                {compressing && (
                    <Step n={step++} title="Compression">
                        <CompressFields o={o} set={set} />
                    </Step>
                )}

                {groups.length > 0 ? (
                    <Step n={step++} title="Options" aside={options.detail === 'simple' ? 'Avancé : tous les réglages' : undefined}>
                        <OptionGroups
                            o={o}
                            set={set}
                            groups={groups}
                            compressing={compressing}
                            videoTargets={shownFormat && !compressing ? [shownFormat] : []}
                            imageTargets={shownFormat && !compressing ? [shownFormat] : []}
                        />
                    </Step>
                ) : noOptionsNote === 'document' || noOptionsNote === '3d' ? (
                    <p className="text-[12px] text-faint">Pas de réglage pour ce type : conversion directe.</p>
                ) : null}
            </div>

            <div className="border-t border-border px-5 py-4">
                <div className="flex items-center justify-between gap-3 pb-1">
                    <span className="text-[13px]">Export</span>
                    <Select
                        size="sm"
                        className="w-[160px]"
                        ariaLabel="Export de plusieurs fichiers"
                        value={exportMode}
                        onChange={(v) => onExportMode(v as 'zip' | 'files')}
                        options={[{ value: 'zip', label: 'Un ZIP' }, { value: 'files', label: 'Fichiers séparés' }]}
                    />
                </div>
                <Toggle checked={background} onChange={onBackground} label="Traitement en arrière-plan" />
                <Toggle checked={autoDownload} onChange={onAutoDownload} label="Téléchargement auto" />
                <Button variant="primary" size="lg" className="mt-3 w-full" disabled={startCount === 0} onClick={start} title="Ctrl + Entrée">
                    {startCount > 0 ? (
                        <>
                            <IconPlay size={13} />
                            {verb}{startCount > 1 ? ` (${startCount})` : ''}
                        </>
                    ) : allFinished && stats.done.length > 0 ? 'Tout est converti' : stats.running.length ? 'Conversion en cours…' : 'Ajoute des fichiers'}
                </Button>
            </div>
        </div>
    )

    // ── Queue column ──
    return (
        <>
            <div className="grid items-start gap-5 lg:grid-cols-[390px_minmax(0,1fr)] lg:gap-6">
                <aside className="order-2 min-w-0 lg:sticky lg:top-4 lg:order-1">{settings}</aside>

                <div className="order-1 min-w-0 space-y-5 lg:order-2">
                    <DropCard onFiles={addFiles} compact={items.length > 0} />

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

                    <div className="overflow-hidden rounded-[4px] border border-border bg-card">
                        <div className="flex items-center gap-1 border-b border-border px-4 py-3">
                            <h2 className="mr-auto text-[14px] font-bold">
                                File d'attente <span className="font-normal text-faint tabular-nums">({items.length})</span>
                            </h2>
                            <Button size="sm" variant="ghost" disabled={stats.done.length === 0} onClick={() => void queue.downloadMany(stats.done)}>
                                <IconDownload size={14} /> <span className="hidden sm:inline">Exporter les fichiers</span><span className="sm:hidden">Exporter</span>
                            </Button>
                            <Button size="sm" variant="ghost" disabled={items.length === 0} onClick={() => { setEditingId(null); setOverrides({}); void queue.clear() }}>
                                <IconTrash size={14} /> Vider
                            </Button>
                        </div>

                        {stats.running.length > 0 && (
                            <div className="border-b border-border px-4 py-3">
                                <div className="mb-2 flex items-center justify-between text-[12px]">
                                    <span>
                                        {stats.running.some((it) => it.status === 'uploading') ? 'Envoi et conversion' : 'Conversion'} · {stats.done.length}/{stats.done.length + stats.running.length}
                                        {stats.errors ? ` · ${stats.errors} en erreur` : ''}
                                    </span>
                                    <span className="font-bold tabular-nums">{stats.overall}%</span>
                                </div>
                                <ProgressBar value={stats.overall} />
                                <p className="mt-2 text-[11px] text-faint">
                                    {stats.running.some((it) => it.status === 'uploading') ? 'Garde la page ouverte pendant l’envoi.'
                                        : stats.running.some((it) => it.local) ? 'Garde la page ouverte : conversion dans ton navigateur.'
                                            : background ? 'Tu peux fermer la page : le serveur continue.'
                                                : 'Garde la page ouverte (arrière-plan désactivé).'}
                                </p>
                            </div>
                        )}

                        {items.length === 0 ? (
                            <div className="flex flex-col items-center px-6 py-14 text-center">
                                <span className="flex h-11 w-11 items-center justify-center rounded-[4px] border border-input text-muted-foreground"><IconPlus size={18} /></span>
                                <p className="mt-4 text-[13px] font-semibold">Aucun fichier dans la file</p>
                                <p className="mt-1 text-[12px] text-faint">Glisse-dépose ou clique sur « Choisir les fichiers ».</p>
                            </div>
                        ) : (
                            <div className="scroll-thin max-h-[640px] divide-y divide-border overflow-y-auto">
                                {items.map((it) => {
                                    const itemAction = optionsFor(it).action
                                    return (
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
                                            formatNote={
                                                it.status === 'pending' && itemAction === 'compress' && it.kind !== 'document' && it.kind !== '3d'
                                                    ? 'compressé · même format'
                                                    : it.status === 'pending' && slideshow && it.kind === 'image' ? 'dans le diaporama' : undefined
                                            }
                                        />
                                    )
                                })}
                            </div>
                        )}
                    </div>

                    <p className="text-center text-[11px] text-faint">
                        Les fichiers envoyés au serveur sont supprimés automatiquement après {retentionHours} h.
                    </p>
                </div>
            </div>

            {items.length === 0 && <Compat />}
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
