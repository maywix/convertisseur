import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
    ActionPicker, CategoryPicker, CompressFields, FormatChips, FormatSelect, OptionGroups, StepTitle,
} from '@/components/ConvertOptionsPanel'
import { DropCard } from '@/components/DropZone'
import { FileRow } from '@/components/FileRow'
import { JobLogDialog } from '@/components/JobLogDialog'
import { IconArrowDown, IconAudio, IconDownload, IconImage, IconPlus, IconTrash, IconVideo, IconWand } from '@/components/icons'
import { Button, Label, ProgressBar, Select, Toggle } from '@/components/ui'
import type { QueueApi } from '@/hooks/useQueue'
import {
    CATEGORY_FORMATS, CATEGORY_KINDS, DEFAULT_CONVERT_OPTIONS, categoryOfItem, groupsFor, groupsForKinds, inferCategory, planForItem,
    type Category, type CompressLevel, type ConvertOptions,
} from '@/lib/convertPlan'
import type { ProcessingPreference } from '@/lib/settings'
import { cn } from '@/lib/utils'
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
            delete o.advanced
            delete o.detail
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

// ── Simple mode: one click presets ──

type PresetId = 'auto' | 'mp4' | 'gif' | 'mp3' | 'jpg' | 'png' | 'webp' | 'compress'

interface Preset {
    id: PresetId
    label: string
    icon: ReactNode
    hint: string
    /** Output type shown in Pro mode (undefined: unchanged). */
    category?: Category | null
    formats: Partial<Record<MediaKind, string>>
}

const PRESETS: Preset[] = [
    {
        id: 'auto', label: 'Auto', icon: <IconWand size={14} />, category: null,
        hint: 'Le format le plus pratique pour chaque fichier : vidéos en MP4, sons en MP3, images en JPG, documents en PDF, 3D en GLB.',
        formats: { video: 'mp4', audio: 'mp3', image: 'jpg', pdf: 'pdf', document: 'pdf', '3d': 'glb' },
    },
    { id: 'mp4', label: 'Vidéo → MP4', icon: <IconVideo size={14} />, category: 'video', hint: 'Toutes les vidéos en MP4 (H.264), lisible partout.', formats: { video: 'mp4' } },
    { id: 'gif', label: 'Vidéo → GIF', icon: <IconImage size={14} />, category: 'video', hint: 'Les vidéos deviennent des GIF animés (480 px, 15 images/s).', formats: { video: 'gif' } },
    { id: 'mp3', label: 'Extraire le son', icon: <IconAudio size={14} />, category: 'audio', hint: 'Le son des vidéos (et les fichiers audio) en MP3.', formats: { video: 'mp3', audio: 'mp3' } },
    { id: 'jpg', label: 'Image → JPG', icon: <IconImage size={14} />, category: 'image', hint: 'Photos en JPG, le format le plus compatible (HEIC, RAW, PNG…).', formats: { image: 'jpg' } },
    { id: 'png', label: 'Image → PNG', icon: <IconImage size={14} />, category: 'image', hint: 'Images en PNG : sans perte, garde la transparence.', formats: { image: 'png' } },
    { id: 'webp', label: 'Image → WebP', icon: <IconImage size={14} />, category: 'image', hint: 'Images en WebP : plus léger que le JPG, pour le web.', formats: { image: 'webp' } },
    { id: 'compress', label: 'Réduire le poids', icon: <IconArrowDown size={14} />, hint: 'Même format, fichier plus léger : vidéos, sons, images et PDF.', formats: {} },
]

const LEVELS: [CompressLevel, string][] = [['low', 'Légère'], ['medium', 'Moyenne'], ['high', 'Forte']]

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            role="radio"
            aria-checked={active}
            onClick={onClick}
            className={cn(
                'inline-flex items-center gap-2 rounded-[4px] border px-4 py-2.5 text-[13px] transition-colors',
                active ? 'border-foreground bg-foreground/[0.06] font-semibold text-foreground' : 'border-border text-muted-foreground hover:border-input hover:text-foreground',
            )}
        >
            {children}
        </button>
    )
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
    const [preset, setPreset] = useState<PresetId>('auto')
    const [advancedOpen, setAdvancedOpen] = useState(false)

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

    const applyPreset = (p: Preset) => {
        setPreset(p.id)
        setOptions(p.id === 'compress'
            ? { action: 'compress' }
            : { action: 'convert', ...(p.category !== undefined ? { category: p.category } : {}) })
        for (const [kind, fmt] of Object.entries(p.formats)) queue.setFormatForKind(kind as MediaKind, fmt)
    }

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
    const o: ConvertOptions = editing ? overrides[editing.id] ?? options : options
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

    const settings = (
        <div className="fade-up overflow-hidden rounded-[4px] border border-border bg-card">
            <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
                <div className="min-w-0">
                    <h2 className="text-[15px] font-bold">Réglages</h2>
                    <p className="mt-0.5 text-[11px] text-faint">Tous les paramètres, étape par étape (s'appliquent à la file ci-dessus).</p>
                </div>
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

            <div className="space-y-7 px-5 py-5 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-10 lg:gap-y-7 lg:space-y-0">
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
                    <Step n={step++} title="Options">
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
            </div>
        </div>
    )

    // ── Shared blocks ──
    const doneCard = allFinished && stats.done.length > 0 && (
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
    )

    const pro = true
    const queueCard = (
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
                                custom={pro && !!overrides[it.id]}
                                editing={pro && editingId === it.id}
                                onFormat={onFormat}
                                onRemove={queue.remove}
                                onRetry={retry}
                                onDownload={queue.download}
                                onShowLog={pro ? setLogItem : undefined}
                                onEdit={pro ? onEdit : undefined}
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
    )

    const retention = (
        <p className="text-center text-[11px] text-faint">
            Les fichiers envoyés au serveur sont supprimés automatiquement après {retentionHours} h.
        </p>
    )

    // ── One page: presets, files, Convertir, then the full settings below ──
    const current = PRESETS.find((p) => p.id === preset) ?? PRESETS[0]
    const doing = options.action === 'compress' ? 'Compresser' : 'Convertir'
    const showAdvanced = advancedOpen || !!editing
    return (
        <>
            <section>
                <p className="mb-3 text-[10px] font-bold tracking-[0.1em] text-faint uppercase">Que veux-tu faire ?</p>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Que veux-tu faire ?">
                    {PRESETS.map((p) => (
                        <Pill key={p.id} active={preset === p.id} onClick={() => applyPreset(p)}>
                            <span className={preset === p.id ? 'text-foreground' : 'text-faint'}>{p.icon}</span>
                            {p.label}
                        </Pill>
                    ))}
                </div>
                <p className="mt-3 text-[12px] text-muted-foreground">{current.hint}</p>
                {preset === 'compress' && (
                    <div className="mt-3 flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Niveau de compression">
                        <span className="mr-1 text-[12px] text-faint">Niveau</span>
                        {LEVELS.map(([v, label]) => (
                            <Pill key={v} active={options.compressMode === 'level' && options.compressLevel === v}
                                onClick={() => setOptions({ compressMode: 'level', compressLevel: v })}>
                                {label}
                            </Pill>
                        ))}
                    </div>
                )}
            </section>

            <DropCard onFiles={addFiles} compact={items.length > 0} />
            {doneCard}

            {items.length > 0 && (
                <>
                    {queueCard}
                    <div className="space-y-3">
                        <Button variant="primary" size="lg" className="w-full" disabled={startCount === 0} onClick={start} title="Ctrl + Entrée">
                            {startCount > 0
                                ? `${doing} ${startCount > 1 ? `${startCount} fichiers` : 'le fichier'}`
                                : allFinished && stats.done.length > 0 ? 'Tout est prêt' : 'Conversion en cours…'}
                        </Button>
                        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
                            <label className="flex cursor-pointer items-center gap-2 text-[12px] text-muted-foreground select-none">
                                <input type="checkbox" checked={autoDownload} onChange={(e) => onAutoDownload(e.target.checked)} className="h-[14px] w-[14px] accent-primary" />
                                Télécharger automatiquement
                            </label>
                            <label className="flex cursor-pointer items-center gap-2 text-[12px] text-muted-foreground select-none">
                                <input type="checkbox" checked={background} onChange={(e) => onBackground(e.target.checked)} className="h-[14px] w-[14px] accent-primary" />
                                Arrière-plan
                            </label>
                            <span className="flex items-center gap-2 text-[12px] text-muted-foreground">
                                Plusieurs fichiers
                                <Select size="sm" className="w-[140px]" ariaLabel="Export de plusieurs fichiers" value={exportMode}
                                    onChange={(v) => onExportMode(v as 'zip' | 'files')}
                                    options={[{ value: 'zip', label: 'Un ZIP' }, { value: 'files', label: 'Fichiers séparés' }]} />
                            </span>
                        </div>
                    </div>
                    {retention}
                </>
            )}

            {/* Pro settings, at the bottom of the same page */}
            <section>
                <button
                    type="button"
                    onClick={() => { setAdvancedOpen((v) => !v); if (editing) setEditingId(null) }}
                    aria-expanded={showAdvanced}
                    className="flex w-full items-center justify-between rounded-[4px] border border-border px-5 py-3.5 text-left text-[13px] font-bold transition-colors hover:border-input"
                >
                    <span>
                        Réglages avancés
                        <span className="ml-2 text-[11px] font-normal text-faint">action, type, format, compression, codecs, rognage, son…</span>
                    </span>
                    <span className={cn('text-muted-foreground transition-transform', showAdvanced && 'rotate-180')}>▾</span>
                </button>
                {showAdvanced && <div className="mt-3">{settings}</div>}
            </section>

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
