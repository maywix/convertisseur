import {
    useCallback, useEffect, useMemo, useRef, useState,
    type CSSProperties, type Dispatch, type ReactNode, type RefObject, type SetStateAction,
} from 'react'
import { EmptyDrop, FilePickers } from '@/components/DropZone'
import { KindIcon } from '@/components/FileRow'
import {
    IconAlert, IconChevronLeft, IconChevronRight, IconCompare, IconCopy, IconDownload, IconPause, IconPlay,
    IconRefresh, IconWand, IconX,
} from '@/components/icons'
import { Button, Field, ProgressBar, Section, Select, Slider, Spinner, TextInput, Toggle } from '@/components/ui'
import type { JobPlan, QueueApi } from '@/hooks/useQueue'
import { BROWSER_DECODABLE, BROWSER_ENCODABLE, decodeImage, processImageInBrowser } from '@/lib/clientProcessor'
import { parseCubeLut, type Lut3D } from '@/lib/cubeLut'
import { DEFAULT_GRADE, NEUTRAL, gradeToFilter, gradeToServerFields, isNeutral, lookOf, type Grade } from '@/lib/grade'
import { createCanvas2DLutRenderer, renderStill, type Canvas2DLutRenderer, type ExtraFilter } from '@/lib/lutCanvas2D'
import { useThumbnail } from '@/hooks/useThumbnail'
import { objectUrlFor } from '@/lib/objectUrl'
import type { LabState } from '@/lib/labState'
import type { ProcessingPreference } from '@/lib/settings'
import { cn } from '@/lib/utils'
import { extOf, formatSize, isActive, type QueueItem } from '@/types'

const VIDEO_OUT = [
    { value: 'mp4', label: 'MP4 (H.264)' }, { value: 'mov', label: 'MOV' }, { value: 'webm', label: 'WebM' },
    { value: 'mkv', label: 'MKV' }, { value: 'gif', label: 'GIF' },
]
const IMAGE_OUT = [
    { value: 'jpg', label: 'JPG' }, { value: 'png', label: 'PNG' }, { value: 'webp', label: 'WebP' }, { value: 'avif', label: 'AVIF' },
    { value: 'tiff', label: 'TIFF' },
]

function isEditable(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

function useParsedLut(file: File | null): { lut: Lut3D | null; error: string | null } {
    const [cache, setCache] = useState<Map<File, Lut3D | string>>(() => new Map())
    useEffect(() => {
        if (!file || cache.has(file)) return
        let cancelled = false
        file.text().then(parseCubeLut).then(
            (lut) => { if (!cancelled) setCache((prev) => new Map(prev).set(file, lut)) },
            (e) => { if (!cancelled) setCache((prev) => new Map(prev).set(file, e instanceof Error ? e.message : 'LUT illisible')) },
        )
        return () => { cancelled = true }
    }, [file, cache])
    const value = file ? cache.get(file) : undefined
    return { lut: value && typeof value !== 'string' ? value : null, error: typeof value === 'string' ? value : null }
}

function fileKey(f: File | null): string {
    return f ? `${f.name}:${f.size}:${f.lastModified}` : ''
}

/**
 * Everything that changes an item's export. When it still matches the last
 * export, the result is up to date: the button downloads it instead of
 * rendering it again.
 */
function exportSignature(it: QueueItem, lab: LabState, processing: ProcessingPreference): string {
    const { lutFile, ...rest } = lab.grades[it.id] || DEFAULT_GRADE
    const lut = lab.lutScope === 'global' ? lab.globalLut : lutFile
    const format = it.kind === 'video' ? lab.videoFormat : lab.imageFormat
    return JSON.stringify([rest, fileKey(lut), format, processing])
}

function formatName(it: QueueItem, lab: LabState): string {
    const f = it.kind === 'video' ? lab.videoFormat : lab.imageFormat
    return (it.kind === 'video' ? VIDEO_OUT : IMAGE_OUT).find((o) => o.value === f)?.label.split(' ')[0] ?? f.toUpperCase()
}

function fmtTime(s: number): string {
    if (!Number.isFinite(s)) return '0:00'
    const m = Math.floor(s / 60)
    const sec = s - m * 60
    return `${m}:${sec < 10 ? '0' : ''}${sec.toFixed(1)}`
}

export function ColorLab({
    queue,
    processing,
    lab,
    setLab,
}: {
    queue: QueueApi
    processing: ProcessingPreference
    lab: LabState
    setLab: Dispatch<SetStateAction<LabState>>
}) {
    const labItems = useMemo(
        () => queue.items.filter((it) => (it.kind === 'image' || it.kind === 'video') && it.file),
        [queue.items],
    )
    const [activeId, setActiveId] = useState<string | null>(null)
    const active = labItems.find((it) => it.id === activeId) ?? labItems[0] ?? null
    const activeIndex = active ? labItems.indexOf(active) : -1
    const grade = (active && lab.grades[active.id]) || DEFAULT_GRADE
    const isVideo = active?.kind === 'video'
    const lutFile = lab.lutScope === 'global' ? lab.globalLut : grade.lutFile
    const { lut, error: lutError } = useParsedLut(lutFile)
    const filter = useMemo(() => gradeToFilter(grade), [grade])
    const [comparing, setComparing] = useState(false)
    const videoRef = useRef<HTMLVideoElement | null>(null)
    const lutInput = useRef<HTMLInputElement>(null)

    const updateGrade = useCallback((patch: Partial<Grade>) => {
        if (!active) return
        setLab((prev) => ({
            ...prev,
            grades: { ...prev.grades, [active.id]: { ...(prev.grades[active.id] || DEFAULT_GRADE), ...patch } },
        }))
    }, [active, setLab])

    const go = useCallback((delta: number) => {
        if (labItems.length === 0) return
        const next = Math.max(0, Math.min(labItems.length - 1, activeIndex + delta))
        setActiveId(labItems[next].id)
    }, [labItems, activeIndex])

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (isEditable(e.target) || e.ctrlKey || e.metaKey || e.altKey) return
            if (e.key === 'ArrowLeft') go(-1)
            else if (e.key === 'ArrowRight') go(1)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [go])

    const copyLookToAll = () => {
        const look = lookOf(grade)
        setLab((prev) => {
            const grades = { ...prev.grades }
            for (const it of labItems) grades[it.id] = { ...(grades[it.id] || DEFAULT_GRADE), ...look }
            return { ...prev, grades }
        })
    }

    const setLutFile = (f: File | null) => {
        if (lab.lutScope === 'global') setLab((prev) => ({ ...prev, globalLut: f }))
        else updateGrade({ lutFile: f })
    }

    const planFor = useCallback((it: QueueItem): { plan: JobPlan; format: string } => {
        const g = lab.grades[it.id] || DEFAULT_GRADE
        const itemLut = lab.lutScope === 'global' ? lab.globalLut : g.lutFile
        if (it.kind === 'video') {
            const format = lab.videoFormat
            const plan: JobPlan = {
                server: { action: 'convert', format, fields: { ...gradeToServerFields(g, 'video'), video_quality: 'high' }, lut: itemLut },
            }
            if (processing === 'browser' && format !== 'gif') {
                plan.local = {
                    run: async ({ file, onProgress }) => {
                        const { processVideoInBrowser } = await import('@/lib/clientVideoProcessor')
                        return processVideoInBrowser(file, format, { grade: g, lutFile: itemLut, crf: 20, onProgress })
                    },
                }
            }
            return { plan, format }
        }
        const format = lab.imageFormat
        const plan: JobPlan = {
            server: { action: 'convert', format, fields: { ...gradeToServerFields(g, 'image'), image_quality: '95' }, lut: itemLut },
        }
        // Same pixel pipeline as the preview: the export matches the screen.
        if (processing !== 'server' && BROWSER_DECODABLE.has(extOf(it.name)) && BROWSER_ENCODABLE.has(format)) {
            plan.local = {
                run: async ({ file }) => {
                    const parsed = itemLut ? parseCubeLut(await itemLut.text()) : null
                    return processImageInBrowser(file, format, {
                        quality: 95, filter: gradeToFilter(g), sharpness: g.sharpness, lut: parsed,
                    })
                },
            }
        }
        return { plan, format }
    }, [lab, processing])

    const isUpToDate = (it: QueueItem) => it.status === 'done' && !!it.downloadUrl && lab.exported[it.id] === exportSignature(it, lab, processing)

    // Render, then download on its own as soon as it's ready (a ZIP or
    // separate files for several, per the settings).
    const exportItems = (list: QueueItem[]) => {
        if (list.length === 0) return
        const signatures: Record<string, string> = {}
        const entries = list.map((it) => {
            const { plan, format } = planFor(it)
            queue.setFormat(it.id, format)
            signatures[it.id] = exportSignature(it, lab, processing)
            return { id: it.id, plan }
        })
        setLab((prev) => ({ ...prev, exported: { ...prev.exported, ...signatures } }))
        queue.run(entries, { autoDownload: true })
    }

    const addFiles = (files: File[]) => {
        const added = queue.add(files).filter((it) => it.kind === 'image' || it.kind === 'video')
        if (added.length && !active) setActiveId(added[0].id)
    }

    if (!active) {
        return (
            <EmptyDrop
                title="Étalonne tes vidéos et photos"
                subtitle="Applique un LUT .cube (Resolve, Premiere, Lightroom…), règle la lumière et les couleurs avec un aperçu en direct, puis exporte tout en une fois."
                onFiles={addFiles}
                accept="image/*,video/*,.heic,.heif,.dng,.cr2,.nef,.arw,.mkv,.mov"
            />
        )
    }

    const running = labItems.filter((it) => isActive(it.status))
    const stale = labItems.filter((it) => !isActive(it.status) && !isUpToDate(it))
    const ready = labItems.filter(isUpToDate)
    const activeReady = isUpToDate(active)
    const activeRunning = isActive(active.status)

    return (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
            {/* ── Stage ── */}
            <div className="min-w-0 space-y-3">
                <div className="checker relative overflow-hidden rounded-[4px] border border-border">
                    <div className="relative flex aspect-video max-h-[72vh] w-full items-center justify-center bg-stage/90">
                        {isVideo ? (
                            <VideoPreview key={active.id} file={active.file!} lut={lut} filter={filter} comparing={comparing} videoRef={videoRef} />
                        ) : (
                            <ImagePreview key={active.id} file={active.file!} lut={lut} filter={filter} sharpness={grade.sharpness} comparing={comparing} />
                        )}

                        <div className="absolute top-3 left-3 flex max-w-[70%] items-center gap-2">
                            <span className="truncate rounded-[3px] bg-black/70 px-2 py-1 text-xs font-medium text-white backdrop-blur" title={active.relativePath || active.name}>
                                {active.name}
                            </span>
                            {lutFile && (
                                <span className={cn('shrink-0 rounded-[3px] px-2 py-1 text-[10px] font-bold tracking-[0.06em] text-black uppercase', lutError ? 'bg-destructive' : 'bg-success')}>
                                    {lutError ? 'LUT invalide' : 'LUT'}
                                </span>
                            )}
                        </div>

                        <button
                            type="button"
                            onPointerDown={() => setComparing(true)}
                            onPointerUp={() => setComparing(false)}
                            onPointerLeave={() => setComparing(false)}
                            onPointerCancel={() => setComparing(false)}
                            onContextMenu={(e) => e.preventDefault()}
                            className={cn(
                                'absolute top-3 right-3 inline-flex select-none items-center gap-1.5 rounded-[3px] px-3 py-1.5 text-xs font-semibold backdrop-blur transition-colors',
                                comparing ? 'bg-white text-black' : 'bg-black/70 text-white hover:bg-black/85',
                            )}
                            title="Maintenir pour voir l'original"
                        >
                            <IconCompare size={14} />
                            {comparing ? 'Original' : 'Avant / après'}
                        </button>
                    </div>
                </div>

                {/* Filmstrip */}
                <div className="flex items-center gap-2">
                    <Button variant="secondary" size="icon" onClick={() => go(-1)} disabled={activeIndex <= 0} aria-label="Fichier précédent">
                        <IconChevronLeft size={16} />
                    </Button>
                    <div className="scroll-thin flex min-w-0 flex-1 gap-2 overflow-x-auto py-1">
                        {labItems.map((it) => (
                            <FilmThumb
                                key={it.id}
                                item={it}
                                active={it.id === active.id}
                                graded={!isNeutral(lab.grades[it.id] || DEFAULT_GRADE)}
                                upToDate={isUpToDate(it)}
                                onSelect={() => setActiveId(it.id)}
                                onRemove={() => queue.remove(it.id)}
                            />
                        ))}
                    </div>
                    <Button variant="secondary" size="icon" onClick={() => go(1)} disabled={activeIndex >= labItems.length - 1} aria-label="Fichier suivant">
                        <IconChevronRight size={16} />
                    </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-faint">
                    <span>Fichier {activeIndex + 1} / {labItems.length} · ← → pour naviguer</span>
                    <span className="ml-auto flex gap-2">
                        <FilePickers onFiles={addFiles} accept="image/*,video/*,.heic,.heif,.dng,.cr2,.nef,.arw" folder={false} compact />
                    </span>
                </div>
            </div>

            {/* ── Controls ── */}
            <aside className="min-w-0 lg:sticky lg:top-6 lg:self-start">
                <div className="flex flex-col overflow-hidden rounded-[4px] border border-border bg-card lg:max-h-[calc(100vh-48px)]">
                    <div className="flex items-center gap-1 border-b border-border px-5 py-3">
                        <h2 className="mr-auto text-[13px] font-bold">Étalonnage</h2>
                        {labItems.length > 1 && (
                            <Button variant="ghost" size="sm" onClick={copyLookToAll} title="Appliquer ces réglages à tous les fichiers">
                                <IconCopy size={13} /> Sur tous
                            </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => updateGrade({ ...lookOf(DEFAULT_GRADE) })} disabled={isNeutral(grade)}>
                            <IconRefresh size={13} /> Reset
                        </Button>
                    </div>

                    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
                        <div className="space-y-3 border-b border-border px-5 py-4">
                            <input
                                ref={lutInput}
                                type="file"
                                accept=".cube"
                                className="hidden"
                                onChange={(e) => {
                                    const f = e.target.files?.[0]
                                    e.target.value = ''
                                    if (f) setLutFile(f)
                                }}
                            />
                            {lutFile ? (
                                <div className={cn('flex items-center gap-2 rounded-[4px] border px-3 py-2', lutError ? 'border-destructive/50' : 'border-input')}>
                                    <IconWand size={15} className={lutError ? 'text-destructive' : 'text-success'} />
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-[13px] font-semibold" title={lutFile.name}>{lutFile.name}</p>
                                        <p className={cn('text-[11px]', lutError ? 'text-destructive' : 'text-faint')}>
                                            {lutError ?? (lut ? `LUT 3D ${lut.size}³ · appliqué en premier` : 'Lecture…')}
                                        </p>
                                    </div>
                                    <Button variant="ghost" size="sm" onClick={() => lutInput.current?.click()}>Changer</Button>
                                    <Button variant="danger" size="icon" onClick={() => setLutFile(null)} aria-label="Retirer le LUT"><IconX size={14} /></Button>
                                </div>
                            ) : (
                                <Button variant="secondary" className="w-full border-dashed" onClick={() => lutInput.current?.click()}>
                                    <IconWand size={15} /> Charger un LUT (.cube)
                                </Button>
                            )}
                            <Select
                                className="w-full"
                                ariaLabel="Portée du LUT"
                                value={lab.lutScope}
                                onChange={(v) => setLab((prev) => ({ ...prev, lutScope: v as LabState['lutScope'] }))}
                                options={[
                                    { value: 'global', label: 'Même LUT pour tous les fichiers' },
                                    { value: 'per-file', label: 'Un LUT différent par fichier' },
                                ]}
                            />
                        </div>

                        <Section title="Lumière">
                            <Slider label="Exposition" value={grade.exposure} min={-2} max={2} step={0.05} onChange={(v) => updateGrade({ exposure: v })} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(2)} EV`} />
                            <Slider label="Contraste" value={grade.contrast} min={-100} max={100} onChange={(v) => updateGrade({ contrast: v })} />
                            <Slider label="Hautes lumières" value={grade.highlights} min={-100} max={100} onChange={(v) => updateGrade({ highlights: v })} />
                            <Slider label="Ombres" value={grade.shadows} min={-100} max={100} onChange={(v) => updateGrade({ shadows: v })} />
                            <Slider label="Blancs" value={grade.whites} min={-100} max={100} onChange={(v) => updateGrade({ whites: v })} />
                            <Slider label="Noirs" value={grade.blacks} min={-100} max={100} onChange={(v) => updateGrade({ blacks: v })} />
                        </Section>

                        <Section title="Couleur">
                            <Slider label="Température" value={grade.temperature} min={-100} max={100} onChange={(v) => updateGrade({ temperature: v })} />
                            <Slider label="Teinte" value={grade.tint} min={-100} max={100} onChange={(v) => updateGrade({ tint: v })} />
                            <Slider label="Saturation" value={grade.saturation} min={-100} max={100} onChange={(v) => updateGrade({ saturation: v })} />
                            <Slider label="Rotation de teinte" value={grade.hue} min={-180} max={180} onChange={(v) => updateGrade({ hue: v })} format={(v) => `${v}°`}
                                disabled={!isVideo && processing === 'server'} />
                        </Section>

                        <Section title="Roues chromatiques" defaultOpen={false}>
                            <Wheel label="Lift · ombres" color={grade.liftColor} amount={grade.liftAmount}
                                onChange={(c, a) => updateGrade({ liftColor: c, liftAmount: a })} />
                            <Wheel label="Gamma · tons moyens" color={grade.gammaColor} amount={grade.gammaAmount}
                                onChange={(c, a) => updateGrade({ gammaColor: c, gammaAmount: a })} />
                            <Wheel label="Gain · hautes lumières" color={grade.gainColor} amount={grade.gainAmount}
                                onChange={(c, a) => updateGrade({ gainColor: c, gainAmount: a })} />
                        </Section>

                        <Section title="Détail et effets" defaultOpen={false}>
                            <Slider label="Netteté" value={grade.sharpness} min={-100} max={100} onChange={(v) => updateGrade({ sharpness: v })} />
                            <Slider label="Vignette" value={grade.vignette} min={0} max={100} onChange={(v) => updateGrade({ vignette: v })} />
                            <Slider label="Grain" value={grade.grain} min={0} max={100} onChange={(v) => updateGrade({ grain: v })} />
                            <Slider label="Glow" value={grade.glow} min={0} max={100} onChange={(v) => updateGrade({ glow: v })} />
                            <Slider label="Aberration chromatique" value={grade.chromatic} min={0} max={20} onChange={(v) => updateGrade({ chromatic: v })} format={(v) => `${v} px`} />
                        </Section>

                        <Section title="Détourage (fond vert)" defaultOpen={grade.removeEnabled}>
                            <Toggle checked={grade.removeEnabled} onChange={(v) => updateGrade({ removeEnabled: v })} label="Rendre une couleur transparente"
                                description={isVideo ? 'Transparence conservée en WebM et MOV.' : 'Transparence conservée en PNG, WebP, AVIF.'} />
                            {grade.removeEnabled && (
                                <>
                                    <div className="flex items-center gap-2">
                                        <input type="color" value={grade.removeColor} onChange={(e) => updateGrade({ removeColor: e.target.value })}
                                            className="h-9 w-12 shrink-0 cursor-pointer rounded-[4px] border border-input bg-card p-1" aria-label="Couleur à retirer" />
                                        <TextInput value={grade.removeColor} onChange={(v) => updateGrade({ removeColor: v })} ariaLabel="Couleur à retirer (hex)" />
                                    </div>
                                    <Slider label="Tolérance" value={grade.removeTolerance} min={1} max={100} neutral={20} onChange={(v) => updateGrade({ removeTolerance: v })} format={(v) => `${v} %`} />
                                </>
                            )}
                        </Section>

                        <Section title="Export">
                            <div className="grid grid-cols-2 gap-2">
                                <Field label="Vidéos en">
                                    <Select value={lab.videoFormat} options={VIDEO_OUT} onChange={(v) => setLab((p) => ({ ...p, videoFormat: v }))} className="w-full" ariaLabel="Format des vidéos" />
                                </Field>
                                <Field label="Images en">
                                    <Select value={lab.imageFormat} options={IMAGE_OUT} onChange={(v) => setLab((p) => ({ ...p, imageFormat: v }))} className="w-full" ariaLabel="Format des images" />
                                </Field>
                            </div>
                            {isVideo && (
                                <>
                                    <Field label="Images / s">
                                        <Select
                                            value={grade.targetFps ? String(grade.targetFps) : ''}
                                            onChange={(v) => updateGrade({ targetFps: v ? parseInt(v, 10) : null })}
                                            className="w-full"
                                            ariaLabel="Images par seconde"
                                            options={[{ value: '', label: 'Original' }, ...['60', '50', '30', '25', '24', '15', '12'].map((v) => ({ value: v, label: v }))]}
                                        />
                                    </Field>
                                    <div className="grid grid-cols-2 gap-2">
                                        <Field label="Début" hint={<TimeGrab videoRef={videoRef} onGrab={(t) => updateGrade({ trimStart: t })} />}>
                                            <TextInput value={grade.trimStart} onChange={(v) => updateGrade({ trimStart: v })} placeholder="0:00" ariaLabel="Début" />
                                        </Field>
                                        <Field label="Fin" hint={<TimeGrab videoRef={videoRef} onGrab={(t) => updateGrade({ trimEnd: t })} />}>
                                            <TextInput value={grade.trimEnd} onChange={(v) => updateGrade({ trimEnd: v })} placeholder="fin" ariaLabel="Fin" />
                                        </Field>
                                    </div>
                                    <Field label="Texte incrusté (bas de l'image)">
                                        <TextInput value={grade.overlayText} onChange={(v) => updateGrade({ overlayText: v })} placeholder="Optionnel" ariaLabel="Texte incrusté" />
                                    </Field>
                                </>
                            )}
                        </Section>
                    </div>

                    <div className="space-y-2.5 border-t border-border px-5 py-4">
                        <ActiveStatus item={active} upToDate={activeReady} onDownload={queue.download} />
                        {activeRunning ? (
                            <Button variant="primary" size="lg" className="w-full" disabled>
                                <Spinner /> Rendu en cours…
                            </Button>
                        ) : activeReady ? (
                            <div className="flex gap-2">
                                <Button variant="success" size="lg" className="min-w-0 flex-1" onClick={() => queue.download(active)}>
                                    <IconDownload size={15} /> Télécharger
                                </Button>
                                <Button variant="secondary" size="lg" onClick={() => exportItems([active])} title="Refaire le rendu">
                                    <IconRefresh size={14} /> Refaire
                                </Button>
                            </div>
                        ) : (
                            <Button variant="primary" size="lg" className="w-full" onClick={() => exportItems([active])}>
                                <IconWand size={15} /> {active.status === 'error' ? 'Réessayer' : 'Exporter'} en {formatName(active, lab)}
                            </Button>
                        )}
                        {labItems.length > 1 && (
                            stale.length > 0 ? (
                                <Button variant="secondary" className="w-full" onClick={() => exportItems(stale)}>
                                    {stale.length === labItems.length ? `Tout exporter (${stale.length})` : stale.length === 1 ? 'Exporter le fichier restant' : `Exporter les ${stale.length} fichiers restants`}
                                </Button>
                            ) : ready.length > 1 && running.length === 0 ? (
                                <Button variant="success" className="w-full" onClick={() => void queue.downloadMany(ready)}>
                                    <IconDownload size={15} /> Tout télécharger ({ready.length})
                                </Button>
                            ) : null
                        )}
                        <p className="text-[11px] leading-relaxed text-faint">Le téléchargement démarre tout seul à la fin du rendu.</p>
                    </div>
                </div>
            </aside>
        </div>
    )
}

function ActiveStatus({ item, upToDate, onDownload }: { item: QueueItem; upToDate: boolean; onDownload: (it: QueueItem) => void }) {
    if (item.status === 'uploading' || item.status === 'processing' || item.status === 'queued') {
        const label = item.status === 'uploading' ? 'Envoi au serveur' : item.status === 'queued' ? 'En attente' : item.local ? 'Rendu dans le navigateur' : 'Rendu sur le serveur'
        return (
            <div className="space-y-1.5">
                <p className="flex justify-between text-xs text-foreground">
                    <span>{label}{item.progress ? '' : '…'}</span>
                    {item.progress > 0 && <span className="tabular-nums">{item.progress} %</span>}
                </p>
                <ProgressBar value={item.progress} indeterminate={item.status !== 'uploading' && item.progress === 0} />
            </div>
        )
    }
    if (item.status === 'done' && item.downloadUrl) {
        if (upToDate) {
            return (
                <p className="truncate text-xs text-success" title={item.outputName ?? undefined}>
                    ✓ Exporté · {item.outputName}{item.outputSize ? ` · ${formatSize(item.outputSize)}` : ''}
                </p>
            )
        }
        return (
            <p className="text-xs text-faint">
                Réglages modifiés depuis le dernier export.{' '}
                <button type="button" className="text-muted-foreground underline hover:text-foreground" onClick={() => onDownload(item)}>
                    Télécharger l'ancien
                </button>
            </p>
        )
    }
    if (item.status === 'error') {
        return (
            <p className="flex items-start gap-1.5 text-xs text-destructive"><IconAlert size={14} className="mt-px shrink-0" />{item.error}</p>
        )
    }
    return null
}

function FilmThumb({
    item, active, graded, upToDate, onSelect, onRemove,
}: {
    item: QueueItem
    active: boolean
    graded: boolean
    upToDate: boolean
    onSelect: () => void
    onRemove: () => void
}) {
    const url = useThumbnail(item.kind === 'image' ? item.file : null, 224)
    return (
        <div className={cn('group relative w-28 shrink-0 overflow-hidden rounded-[4px] border bg-card transition-colors', active ? 'border-foreground' : 'border-border hover:border-input')}>
            <button type="button" onClick={onSelect} className="block w-full text-left" aria-current={active}>
                <div className="flex h-16 items-center justify-center bg-muted text-faint">
                    {url ? <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" /> : <KindIcon kind={item.kind} size={20} />}
                </div>
                <div className="px-2 py-1.5">
                    <p className="truncate text-[11px] font-semibold">{item.name}</p>
                    <p className="flex items-center gap-1 text-[10px] text-faint">
                        {isActive(item.status) ? <span className="text-foreground tabular-nums">{item.progress} %</span>
                            : item.status === 'error' ? <span className="text-destructive">Erreur</span>
                                : upToDate ? <span className="text-success">✓ Exporté</span>
                                    : graded ? <span className="text-muted-foreground">Modifié</span> : formatSize(item.size)}
                    </p>
                </div>
            </button>
            {isActive(item.status) && <ProgressBar value={item.progress} className="absolute inset-x-0 bottom-0 h-0.5 rounded-none" />}
            <button
                type="button"
                onClick={onRemove}
                aria-label={`Retirer ${item.name}`}
                className="absolute top-1 right-1 hidden h-6 w-6 items-center justify-center rounded-[3px] bg-black/70 text-white group-hover:flex"
            >
                <IconX size={12} />
            </button>
        </div>
    )
}

function Wheel({ label, color, amount, onChange }: { label: string; color: string; amount: number; onChange: (c: string, a: number) => void }) {
    const neutral = color.toLowerCase() === NEUTRAL
    return (
        <div className="flex items-center gap-3">
            <input type="color" value={color} onChange={(e) => onChange(e.target.value, amount)} aria-label={label}
                className="h-10 w-10 shrink-0 cursor-pointer rounded-full border border-input bg-card p-0.5 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch-wrapper]:p-0" />
            <div className="min-w-0 flex-1">
                <Slider label={label} value={amount} min={0} max={2} step={0.05} neutral={1} onChange={(a) => onChange(color, a)} disabled={neutral}
                    format={(v) => `× ${v.toFixed(2)}`} />
            </div>
            <Button variant="ghost" size="icon" onClick={() => onChange(NEUTRAL, 1)} disabled={neutral} aria-label={`Réinitialiser ${label}`}>
                <IconRefresh size={13} />
            </Button>
        </div>
    )
}

function TimeGrab({ videoRef, onGrab }: { videoRef: RefObject<HTMLVideoElement | null>; onGrab: (t: string) => void }) {
    return (
        <button type="button" className="text-[11px] text-muted-foreground underline hover:text-foreground" onClick={() => {
            const v = videoRef.current
            if (v) onGrab(v.currentTime.toFixed(2))
        }}>
            position actuelle
        </button>
    )
}

function PreviewMessage({ children }: { children: ReactNode }) {
    return (
        <div className="absolute inset-0 flex items-center justify-center p-6">
            <p className="max-w-sm rounded-[4px] bg-black/75 px-4 py-3 text-center text-[13px] text-white/90 backdrop-blur">{children}</p>
        </div>
    )
}

function ImagePreview({
    file, lut, filter, sharpness, comparing,
}: {
    file: File
    lut: Lut3D | null
    filter: ExtraFilter
    sharpness: number
    comparing: boolean
}) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const [image, setImage] = useState<Awaited<ReturnType<typeof decodeImage>> | null>(null)
    const [failed, setFailed] = useState(false)

    useEffect(() => {
        let cancelled = false
        let decoded: Awaited<ReturnType<typeof decodeImage>> | null = null
        decodeImage(file).then(
            (img) => {
                if (cancelled) img.close()
                else { decoded = img; setImage(img) }
            },
            () => { if (!cancelled) setFailed(true) },
        )
        return () => {
            cancelled = true
            decoded?.close()
        }
    }, [file])

    useEffect(() => {
        const canvas = canvasRef.current
        if (!image || !canvas) return
        const raf = requestAnimationFrame(() => {
            try {
                renderStill(image.source, image.width, image.height, canvas, comparing ? null : lut,
                    comparing ? gradeToFilter(DEFAULT_GRADE) : filter, comparing ? 0 : sharpness, 1600)
            } catch (e) {
                console.warn('[preview]', e)
            }
        })
        return () => cancelAnimationFrame(raf)
    }, [image, lut, filter, sharpness, comparing])

    if (failed) {
        return <PreviewMessage>Aperçu impossible pour ce format dans le navigateur (HEIC, RAW…). L'export se fera sur le serveur avec tes réglages.</PreviewMessage>
    }
    return <canvas ref={canvasRef} className="h-full w-full object-contain" />
}

function VideoPreview({
    file, lut, filter, comparing, videoRef,
}: {
    file: File
    lut: Lut3D | null
    filter: ExtraFilter
    comparing: boolean
    videoRef: RefObject<HTMLVideoElement | null>
}) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const rendererRef = useRef<Canvas2DLutRenderer | null>(null)
    const [ready, setReady] = useState(false)
    const [failed, setFailed] = useState(false)

    useEffect(() => {
        const video = videoRef.current
        const canvas = canvasRef.current
        if (!ready || !video || !canvas) return
        const r = createCanvas2DLutRenderer(canvas, video)
        rendererRef.current = r
        r.start()
        return () => {
            r.stop()
            rendererRef.current = null
        }
    }, [ready, videoRef])

    useEffect(() => {
        const r = rendererRef.current
        if (!r) return
        r.setLut(lut)
        r.setExtraFilter(filter)
        r.setBypass(comparing)
    }, [lut, filter, comparing, ready])

    return (
        <>
            <video
                ref={videoRef}
                src={objectUrlFor(file)}
                muted
                loop
                playsInline
                preload="auto"
                className="hidden"
                onLoadedData={(e) => { if (e.currentTarget.videoWidth > 0) setReady(true) }}
                onError={() => setFailed(true)}
            />
            <canvas ref={canvasRef} className={cn('h-full w-full object-contain', !ready && 'hidden')} />
            {failed && (
                <PreviewMessage>Le navigateur ne sait pas lire cette vidéo (ProRes, Apple Log, HEVC…). L'export sur le serveur fonctionnera quand même avec tes réglages.</PreviewMessage>
            )}
            {!failed && !ready && <PreviewMessage>Chargement de la vidéo…</PreviewMessage>}
            {ready && <VideoControls videoRef={videoRef} />}
        </>
    )
}

function VideoControls({ videoRef }: { videoRef: RefObject<HTMLVideoElement | null> }) {
    const [playing, setPlaying] = useState(false)
    const [time, setTime] = useState(0)
    const [duration, setDuration] = useState(0)

    useEffect(() => {
        const v = videoRef.current
        if (!v) return
        const sync = () => {
            setPlaying(!v.paused)
            setTime(v.currentTime)
            setDuration(v.duration || 0)
        }
        const events = ['play', 'pause', 'timeupdate', 'durationchange', 'seeked'] as const
        events.forEach((ev) => v.addEventListener(ev, sync))
        return () => events.forEach((ev) => v.removeEventListener(ev, sync))
    }, [videoRef])

    const toggle = () => {
        const v = videoRef.current
        if (!v) return
        if (v.paused) v.play().catch(() => undefined)
        else v.pause()
    }

    return (
        <div className="absolute inset-x-3 bottom-3 flex items-center gap-3 rounded-[4px] bg-black/70 px-3 py-2 text-white backdrop-blur">
            <button type="button" onClick={toggle} aria-label={playing ? 'Pause' : 'Lecture'} className="flex h-7 w-7 items-center justify-center rounded-[3px] hover:bg-white/15">
                {playing ? <IconPause size={16} /> : <IconPlay size={14} />}
            </button>
            <input
                type="range"
                className="range flex-1"
                min={0}
                max={duration || 1}
                step={0.01}
                value={time}
                aria-label="Position"
                onChange={(e) => {
                    const v = videoRef.current
                    if (v) v.currentTime = parseFloat(e.target.value)
                }}
                style={{ '--fill-from': '0%', '--fill-to': `${duration ? (time / duration) * 100 : 0}%` } as CSSProperties}
            />
            <span className="shrink-0 whitespace-nowrap text-right font-mono text-[11px] tabular-nums text-white/80">{fmtTime(time)} / {fmtTime(duration)}</span>
        </div>
    )
}
