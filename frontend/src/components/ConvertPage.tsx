import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { FilePickers, EmptyDrop } from '@/components/DropZone'
import { FileRow } from '@/components/FileRow'
import {
    IconAudio, IconDownload, IconImage, IconPlay, IconSequence, IconSliders, IconVideo,
} from '@/components/icons'
import { Button, Field, Section, Segmented, Select, Slider, TextInput, Toggle } from '@/components/ui'
import type { QueueApi } from '@/hooks/useQueue'
import { DEFAULT_CONVERT_OPTIONS, planForItem, type ConvertOptions, type VideoQuality } from '@/lib/convertPlan'
import type { ProcessingPreference } from '@/lib/settings'
import { AUDIO_FORMATS, FORMATS, KIND_LABEL, isActive, type MediaKind } from '@/types'

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
        const pending = items.filter((it) => it.status === 'pending' && it.file)
        let videoFormats = 0, gifs = 0, audioOut = 0, images = 0, pendingImages = 0
        for (const it of items) {
            if (it.kind !== 'unknown' && it.kind !== 'sequence') kinds.add(it.kind)
            if (it.kind === 'video') {
                if (it.targetFormat === 'gif') gifs++
                else if (AUDIO_FORMATS.has(it.targetFormat)) audioOut++
                else if (it.targetFormat !== 'zip') videoFormats++
            }
            if (it.kind === 'audio') audioOut++
            if (it.kind === 'image') images++
        }
        for (const it of pending) if (it.kind === 'image') pendingImages++
        return {
            kinds: KIND_ORDER.filter((k) => kinds.has(k)),
            pending,
            done: items.filter((it) => it.status === 'done'),
            active: items.filter((it) => isActive(it.status)).length,
            videoFormats, gifs, audioOut, images, pendingImages,
            zip: items.some((it) => it.kind === 'video' && it.targetFormat === 'zip'),
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
                        <Section title="Formats de sortie" icon={<IconSliders size={15} />}>
                            {stats.kinds.map((kind) => (
                                <Field key={kind} label={`${KIND_LABEL[kind]} →`}>
                                    <Select
                                        value={queue.kindFormats[kind]}
                                        options={FORMATS[kind]}
                                        onChange={(v) => queue.setFormatForKind(kind, v)}
                                        className="w-full"
                                        ariaLabel={`Format pour ${KIND_LABEL[kind]}`}
                                    />
                                </Field>
                            ))}
                            <p className="text-xs text-muted-foreground">Tu peux aussi changer le format fichier par fichier dans la liste.</p>
                        </Section>

                        {stats.videoFormats > 0 && <VideoOptions o={options} set={setOptions} />}
                        {stats.gifs > 0 && <GifOptions o={options} set={setOptions} />}
                        {stats.zip && (
                            <Section title="Vidéo → images" icon={<IconImage size={15} />}>
                                <Field label="Images extraites par seconde">
                                    <Segmented value={options.frameFps} onChange={(v) => setOptions({ frameFps: v })} className="w-full"
                                        options={[{ value: '0.2', label: '1 / 5 s' }, { value: '1', label: '1' }, { value: '5', label: '5' }, { value: '10', label: '10' }]} />
                                </Field>
                            </Section>
                        )}
                        {(stats.audioOut > 0 || stats.videoFormats > 0) && <AudioOptions o={options} set={setOptions} />}
                        {stats.images > 0 && <ImageOptions o={options} set={setOptions} canSlideshow={stats.pendingImages >= 2} />}
                        {(stats.videoFormats > 0 || stats.gifs > 0 || stats.audioOut > 0) && (
                            <Section title="Couper" defaultOpen={!!(options.trimStart || options.trimEnd)}>
                                <div className="grid grid-cols-2 gap-2">
                                    <Field label="Début">
                                        <TextInput value={options.trimStart} onChange={(v) => setOptions({ trimStart: v })} placeholder="0:05" inputMode="decimal" ariaLabel="Début" />
                                    </Field>
                                    <Field label="Fin">
                                        <TextInput value={options.trimEnd} onChange={(v) => setOptions({ trimEnd: v })} placeholder="1:30" inputMode="decimal" ariaLabel="Fin" />
                                    </Field>
                                </div>
                                <p className="text-xs text-muted-foreground">En secondes ou en h:mm:ss. S'applique aux vidéos, GIF et sons.</p>
                            </Section>
                        )}
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

type OptProps = { o: ConvertOptions; set: (p: Partial<ConvertOptions>) => void }

function VideoOptions({ o, set }: OptProps) {
    return (
        <Section title="Vidéo" icon={<IconVideo size={15} />}>
            <Field label="Qualité">
                <Segmented<VideoQuality>
                    value={o.videoQuality}
                    onChange={(v) => set({ videoQuality: v })}
                    className="w-full"
                    size="sm"
                    options={[
                        { value: 'high', label: 'Haute', title: 'Fichier plus gros' },
                        { value: 'balanced', label: 'Équilibrée' },
                        { value: 'small', label: 'Légère', title: 'Fichier plus petit' },
                        { value: 'size', label: 'Taille cible' },
                    ]}
                />
            </Field>
            {o.videoQuality === 'size' && (
                <Field label="Poids visé (Mo)" hint="ex. 10 ou 25 pour Discord">
                    <TextInput value={o.videoTargetMb} onChange={(v) => set({ videoTargetMb: v.replace(',', '.') })} inputMode="decimal" ariaLabel="Poids visé en Mo" />
                </Field>
            )}
            <div className="grid grid-cols-2 gap-2">
                <Field label="Résolution max">
                    <Select value={o.videoMaxHeight} onChange={(v) => set({ videoMaxHeight: v })} className="w-full" ariaLabel="Résolution max"
                        options={[
                            { value: '', label: 'Originale' }, { value: '2160', label: '4K (2160p)' }, { value: '1440', label: '1440p' },
                            { value: '1080', label: '1080p' }, { value: '720', label: '720p' }, { value: '480', label: '480p' }, { value: '360', label: '360p' },
                        ]} />
                </Field>
                <Field label="Images / s">
                    <Select value={o.videoFps} onChange={(v) => set({ videoFps: v })} className="w-full" ariaLabel="Images par seconde"
                        options={[{ value: '', label: 'Original' }, { value: '60', label: '60' }, { value: '30', label: '30' }, { value: '25', label: '25' }, { value: '24', label: '24' }]} />
                </Field>
                <Field label="Codec">
                    <Select value={o.videoCodec} onChange={(v) => set({ videoCodec: v as ConvertOptions['videoCodec'] })} className="w-full" ariaLabel="Codec"
                        options={[{ value: 'libx264', label: 'H.264' }, { value: 'libx265', label: 'H.265 (léger)' }]} />
                </Field>
                <Field label="Rotation">
                    <Select value={o.rotate} onChange={(v) => set({ rotate: v as ConvertOptions['rotate'] })} className="w-full" ariaLabel="Rotation"
                        options={[{ value: 'none', label: 'Aucune' }, { value: '90', label: '90° →' }, { value: '270', label: '90° ←' }, { value: '180', label: '180°' }, { value: 'hflip', label: 'Miroir' }]} />
                </Field>
            </div>
            <Toggle checked={o.removeAudio} onChange={(v) => set({ removeAudio: v })} label="Supprimer le son" />
        </Section>
    )
}

function GifOptions({ o, set }: OptProps) {
    return (
        <Section title="GIF" icon={<IconSequence size={15} />}>
            <div className="grid grid-cols-2 gap-2">
                <Field label="Largeur">
                    <Select value={o.gifWidth} onChange={(v) => set({ gifWidth: v })} className="w-full" ariaLabel="Largeur du GIF"
                        options={[{ value: '320', label: '320 px' }, { value: '480', label: '480 px' }, { value: '640', label: '640 px' }, { value: '800', label: '800 px' }, { value: '0', label: 'Originale' }]} />
                </Field>
                <Field label="Images / s">
                    <Select value={o.gifFps} onChange={(v) => set({ gifFps: v })} className="w-full" ariaLabel="Images par seconde du GIF"
                        options={[{ value: '10', label: '10' }, { value: '15', label: '15' }, { value: '20', label: '20' }, { value: '25', label: '25' }]} />
                </Field>
                <Field label="Vitesse">
                    <Select value={o.gifSpeed} onChange={(v) => set({ gifSpeed: v })} className="w-full" ariaLabel="Vitesse du GIF"
                        options={[{ value: '0.5', label: '× 0,5' }, { value: '1', label: '× 1' }, { value: '1.5', label: '× 1,5' }, { value: '2', label: '× 2' }]} />
                </Field>
                <Field label="Couleurs">
                    <Select value={o.gifColors} onChange={(v) => set({ gifColors: v })} className="w-full" ariaLabel="Couleurs du GIF"
                        options={[{ value: '64', label: '64 · léger' }, { value: '128', label: '128' }, { value: '256', label: '256 · fidèle' }]} />
                </Field>
            </div>
        </Section>
    )
}

function AudioOptions({ o, set }: OptProps) {
    return (
        <Section title="Son" icon={<IconAudio size={15} />} defaultOpen={false}>
            <Field label="Débit (formats compressés)">
                <Segmented value={o.audioBitrate} onChange={(v) => set({ audioBitrate: v })} className="w-full" size="sm"
                    options={[{ value: '128k', label: '128k' }, { value: '192k', label: '192k' }, { value: '256k', label: '256k' }, { value: '320k', label: '320k' }]} />
            </Field>
            <Toggle checked={o.audioNormalize} onChange={(v) => set({ audioNormalize: v })} label="Normaliser le volume" description="Niveau sonore homogène (EBU R128)" />
        </Section>
    )
}

function ImageOptions({ o, set, canSlideshow }: OptProps & { canSlideshow: boolean }) {
    return (
        <Section title="Images" icon={<IconImage size={15} />}>
            <Slider label="Qualité (JPG, WebP, AVIF)" value={o.imageQuality} min={40} max={100} step={1} neutral={90}
                onChange={(v) => set({ imageQuality: v })} format={(v) => `${v} %`} />
            <div className="grid grid-cols-2 gap-2">
                <Field label="Taille max">
                    <Select value={o.imageMaxSize} onChange={(v) => set({ imageMaxSize: v })} className="w-full" ariaLabel="Taille maximale"
                        options={[{ value: '', label: 'Originale' }, { value: '3840', label: '3840 px' }, { value: '2560', label: '2560 px' }, { value: '1920', label: '1920 px' }, { value: '1280', label: '1280 px' }, { value: '800', label: '800 px' }, { value: '512', label: '512 px' }]} />
                </Field>
                <Field label="Agrandir">
                    <Select value={o.imageUpscale} onChange={(v) => set({ imageUpscale: v })} className="w-full" ariaLabel="Agrandir"
                        options={[{ value: '1', label: 'Non' }, { value: '2', label: '× 2' }, { value: '3', label: '× 3' }, { value: '4', label: '× 4' }]} />
                </Field>
            </div>
            {canSlideshow && (
                <div className="rounded-xl border border-border bg-muted/40 p-3">
                    <Toggle checked={o.slideshow} onChange={(v) => set({ slideshow: v })} label="Assembler en une vidéo" description="Les images en attente deviennent un diaporama (ordre alphabétique)." />
                    {o.slideshow && (
                        <div className="mt-3 grid grid-cols-2 gap-2">
                            <Field label="Format">
                                <Select value={o.slideshowFormat} onChange={(v) => set({ slideshowFormat: v as ConvertOptions['slideshowFormat'] })} className="w-full" ariaLabel="Format du diaporama"
                                    options={[{ value: 'mp4', label: 'MP4' }, { value: 'webm', label: 'WebM' }, { value: 'gif', label: 'GIF' }]} />
                            </Field>
                            <Field label="Images / s">
                                <Select value={o.slideshowFps} onChange={(v) => set({ slideshowFps: v })} className="w-full" ariaLabel="Images par seconde du diaporama"
                                    options={[{ value: '0.5', label: '1 / 2 s' }, { value: '1', label: '1' }, { value: '2', label: '2' }, { value: '5', label: '5' }, { value: '12', label: '12' }, { value: '24', label: '24' }]} />
                            </Field>
                        </div>
                    )}
                </div>
            )}
        </Section>
    )
}
