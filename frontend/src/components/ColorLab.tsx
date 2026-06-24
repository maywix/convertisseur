import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    IconChevronDown,
    IconChevronUp,
    IconDownload,
    IconImage,
    IconRefresh,
    IconVideo,
    IconWand,
    IconX,
} from '@/components/icons'
import { Button } from '@/components/ui/button'
import { processImageClientSide, isClientSupportedFormat, type ClientGrade } from '@/lib/clientProcessor'
import { cn } from '@/lib/utils'
import { formatSize, getFileType } from '@/types'

type ProcessingMode = 'frontend' | 'backend'

interface ColorLabProps {
    processingMode: ProcessingMode
}

// ──────────────────────────────────────────────────────────
// Color Lab — Lightroom + DaVinci-style grading + effects + LUT batch.
// Live CSS-filter preview while the user moves sliders. Final render is done
// server-side (FFmpeg for video, Pillow for image) for accurate output.
// ──────────────────────────────────────────────────────────

type MediaKind = 'image' | 'video'

interface Grade {
    // Light
    exposure: number       // -2..+2 EV
    contrast: number       // -100..+100
    highlights: number     // -100..+100
    shadows: number        // -100..+100
    whites: number         // -100..+100
    blacks: number         // -100..+100
    // Color (basic)
    saturation: number     // -100..+100
    temperature: number    // -100..+100 cool/warm
    tint: number           // -100..+100 green/magenta
    hue: number            // -180..+180°
    // Color wheels (DaVinci LGG)
    liftColor: string      // hex, neutral = #808080
    liftAmount: number     // 0..2 (intensity multiplier)
    gammaColor: string
    gammaAmount: number
    gainColor: string
    gainAmount: number
    // Detail
    sharpness: number      // -100..+100
    // Effects
    vignette: number       // 0..100
    glow: number           // 0..100
    grain: number          // 0..100
    chromatic: number      // 0..20 (px)
    // Color remover
    removeEnabled: boolean
    removeColor: string    // hex
    removeTolerance: number // 0..100
}

const NEUTRAL = '#808080'

const DEFAULT_GRADE: Grade = {
    exposure: 0, contrast: 0,
    highlights: 0, shadows: 0, whites: 0, blacks: 0,
    saturation: 0, temperature: 0, tint: 0, hue: 0,
    liftColor: NEUTRAL, liftAmount: 1,
    gammaColor: NEUTRAL, gammaAmount: 1,
    gainColor: NEUTRAL, gainAmount: 1,
    sharpness: 0,
    vignette: 0, glow: 0, grain: 0, chromatic: 0,
    removeEnabled: false, removeColor: '#ffffff', removeTolerance: 15,
}

const VIDEO_OUTPUTS = ['mp4', 'webm', 'mov', 'mkv'] as const
const IMAGE_OUTPUTS = ['png', 'jpg', 'webp', 'avif'] as const

function detectKind(file: File): MediaKind | null {
    const t = getFileType(file.name)
    if (t === 'image') return 'image'
    if (t === 'video') return 'video'
    return null
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value))
}

function gradeToCssFilter(g: Grade): string {
    const brightness = clamp(1 + g.exposure * 0.25 + g.whites * 0.002 + g.blacks * -0.0015, 0.1, 2.5)
    const contrast = clamp(1 + g.contrast / 100 + g.highlights * -0.002 + g.shadows * -0.002, 0, 2)
    const saturate = clamp(1 + g.saturation / 100, 0, 3)
    const hueDeg = clamp(g.hue + g.tint * 0.45, -180, 180)
    // Glow approximated by a small blur kernel (CSS blur).
    const blurPx = g.glow > 0 ? (g.glow / 100) * 3.5 : 0
    const blurPart = blurPx > 0 ? ` blur(${blurPx.toFixed(2)}px)` : ''
    return `brightness(${brightness.toFixed(3)}) contrast(${contrast.toFixed(3)}) saturate(${saturate.toFixed(3)}) hue-rotate(${hueDeg}deg)${blurPart}`
}

function temperatureToOverlay(temp: number): { rgba: string; mixBlend: 'multiply' | 'normal' } {
    const amount = clamp(Math.abs(temp) / 100, 0, 1)
    if (amount < 0.01) return { rgba: 'transparent', mixBlend: 'normal' }
    const a = (amount * 0.30).toFixed(3)
    return {
        rgba: temp >= 0 ? `rgba(255, 170, 80, ${a})` : `rgba(100, 160, 255, ${a})`,
        mixBlend: 'multiply',
    }
}

function lggToOverlay(color: string, amount: number, alphaMax: number): { rgba: string; mixBlend: 'soft-light' | 'normal' } {
    // Tints the preview with the picked colour for LGG.
    const c = color.replace('#', '')
    if (c.length !== 6 || color.toLowerCase() === '#808080') return { rgba: 'transparent', mixBlend: 'normal' }
    const r = parseInt(c.substring(0, 2), 16)
    const g = parseInt(c.substring(2, 4), 16)
    const b = parseInt(c.substring(4, 6), 16)
    const a = clamp(amount * alphaMax, 0, 0.5).toFixed(3)
    return { rgba: `rgba(${r}, ${g}, ${b}, ${a})`, mixBlend: 'soft-light' }
}

function Slider({
    label, value, min, max, step, onChange, suffix, disabled,
}: {
    label: string; value: number; min: number; max: number; step: number;
    onChange: (v: number) => void; suffix?: string; disabled?: boolean
}) {
    const display = `${value > 0 ? '+' : ''}${value.toFixed(step < 1 ? 1 : 0)}${suffix ?? ''}`
    return (
        <div className={cn('space-y-1.5', disabled && 'opacity-40 pointer-events-none')}>
            <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-foreground">{label}</span>
                <span className="text-[11px] font-mono text-muted-foreground tabular-nums">{display}</span>
            </div>
            <input
                type="range" min={min} max={max} step={step} value={value}
                onChange={(e) => onChange(parseFloat(e.target.value))}
                disabled={disabled}
                className="h-1.5 w-full accent-primary"
            />
        </div>
    )
}

function ColorSwatch({
    label, color, amount, onColorChange, onAmountChange, onReset,
}: {
    label: string; color: string; amount: number;
    onColorChange: (c: string) => void; onAmountChange: (a: number) => void;
    onReset: () => void;
}) {
    return (
        <div className="rounded-lg border border-border bg-background/40 p-2.5 space-y-2">
            <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
                <button
                    type="button"
                    onClick={onReset}
                    className="text-[10px] text-muted-foreground hover:text-destructive"
                >
                    Reset
                </button>
            </div>
            <div className="flex items-center gap-2">
                <input
                    type="color"
                    value={color}
                    onChange={(e) => onColorChange(e.target.value)}
                    className="h-9 w-9 shrink-0 rounded-md border border-border bg-background cursor-pointer"
                />
                <div className="flex-1">
                    <Slider
                        label="Intensité"
                        value={amount}
                        min={0} max={2} step={0.05}
                        onChange={onAmountChange}
                    />
                </div>
            </div>
        </div>
    )
}

function CollapsibleSection({
    title, defaultOpen = true, children,
}: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
    const [open, setOpen] = useState(defaultOpen)
    return (
        <div className="overflow-hidden rounded-lg border border-border bg-background/40">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-muted/40"
            >
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
                {open ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />}
            </button>
            {open && <div className="space-y-3 border-t border-border px-3 py-3">{children}</div>}
        </div>
    )
}

interface JobResult {
    id: string
    status: 'queued' | 'processing' | 'done' | 'error'
    download_url: string | null
    output_filename: string | null
    progress?: number
    error?: string | null
}

async function uploadAndConvert(
    file: File,
    targetFormat: string,
    grade: Grade,
    kind: MediaKind,
    lutFile: File | null,
    onProgress?: (state: string) => void,
): Promise<{ downloadUrl: string; filename: string }> {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('action', 'convert')
    fd.append('format', targetFormat)

    if (lutFile) {
        fd.append('lut_file', lutFile)
    }

    // Lightroom-style sliders
    const slidersMap: Record<string, [keyof Grade, string, string]> = {
        // sliderKey: [Grade key, video param name, image param name]
        exposure:    ['exposure', 'video_exposure', 'photo_exposure'],
        contrast:    ['contrast', 'video_contrast', 'photo_contrast'],
        highlights:  ['highlights', 'video_highlights', 'photo_highlights'],
        shadows:     ['shadows', 'video_shadows', 'photo_shadows'],
        whites:      ['whites', 'video_whites', 'photo_whites'],
        blacks:      ['blacks', 'video_blacks', 'photo_blacks'],
        saturation:  ['saturation', 'video_saturation', 'photo_saturation'],
        temperature: ['temperature', 'video_temperature', 'photo_temperature'],
        tint:        ['tint', 'video_tint', 'photo_tint'],
        sharpness:   ['sharpness', 'video_sharpness', 'photo_sharpness'],
    }
    for (const k of Object.keys(slidersMap)) {
        const [gk, vname, pname] = slidersMap[k]
        const v = grade[gk] as number
        if (v !== 0) {
            const target = kind === 'video' ? vname : pname
            if (target) fd.append(target, String(v))
        }
    }
    if (kind === 'video' && grade.hue !== 0) fd.append('video_hue', String(grade.hue))

    if (kind === 'video') {
        // LGG color wheels
        if (grade.liftColor.toLowerCase() !== NEUTRAL) {
            fd.append('video_lift_color', grade.liftColor)
            fd.append('video_lift_amount', String(grade.liftAmount))
        }
        if (grade.gammaColor.toLowerCase() !== NEUTRAL) {
            fd.append('video_gamma_color', grade.gammaColor)
            fd.append('video_gamma_amount', String(grade.gammaAmount))
        }
        if (grade.gainColor.toLowerCase() !== NEUTRAL) {
            fd.append('video_gain_color', grade.gainColor)
            fd.append('video_gain_amount', String(grade.gainAmount))
        }
        // Effects
        if (grade.vignette > 0) fd.append('video_vignette', String(grade.vignette))
        if (grade.glow > 0) fd.append('video_glow', String(grade.glow))
        if (grade.grain > 0) fd.append('video_grain', String(grade.grain))
        if (grade.chromatic > 0) fd.append('video_chromatic', String(grade.chromatic))
    }

    // Color remover (image + video)
    if (grade.removeEnabled && grade.removeColor) {
        fd.append('color_remove_color', grade.removeColor)
        fd.append('color_remove_tolerance', String(grade.removeTolerance))
    }

    onProgress?.('Envoi du fichier…')
    const res = await fetch('/jobs', { method: 'POST', body: fd })
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'upload failed' }))
        throw new Error(err.error || 'upload failed')
    }
    const { job_id } = await res.json()

    onProgress?.('Traitement…')
    while (true) {
        await new Promise((r) => setTimeout(r, 800))
        const j = await fetch(`/jobs/${job_id}`).then((r) => r.json() as Promise<JobResult>)
        if (j.status === 'done' && j.download_url) {
            return { downloadUrl: j.download_url, filename: j.output_filename || file.name }
        }
        if (j.status === 'error') throw new Error(j.error || 'conversion failed')
        if (typeof j.progress === 'number') onProgress?.(`Traitement… ${Math.round(j.progress)} %`)
    }
}

interface BatchItem {
    file: File
    state: 'idle' | 'busy' | 'done' | 'error'
    progress: string
    downloadUrl?: string
    filename?: string
    error?: string
}

export function ColorLab({ processingMode }: ColorLabProps) {
    const [files, setFiles] = useState<File[]>([])
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)
    const [grade, setGrade] = useState<Grade>(DEFAULT_GRADE)
    const [lutFile, setLutFile] = useState<File | null>(null)
    const [batch, setBatch] = useState<BatchItem[]>([])
    const [busy, setBusy] = useState(false)
    const [busyMessage, setBusyMessage] = useState('')
    const [err, setErr] = useState<string | null>(null)
    const [outputFormat, setOutputFormat] = useState<string>('')
    const fileInputRef = useRef<HTMLInputElement>(null)
    const lutInputRef = useRef<HTMLInputElement>(null)

    // The "primary" file is the first one — used for live preview.
    const primaryFile = files[0] || null
    const kind: MediaKind | null = primaryFile ? detectKind(primaryFile) : null
    const isMultiBatch = files.length > 1
    const isVideo = kind === 'video'

    useEffect(() => {
        if (!primaryFile) { setPreviewUrl(null); return }
        const url = URL.createObjectURL(primaryFile)
        setPreviewUrl(url)
        return () => URL.revokeObjectURL(url)
    }, [primaryFile])

    useEffect(() => {
        if (!primaryFile) return
        if (kind === 'image') setOutputFormat('png')
        else if (kind === 'video') setOutputFormat('mp4')
    }, [primaryFile, kind])

    const handlePick = (incoming: FileList | File[] | null) => {
        if (!incoming) return
        const arr = Array.from(incoming).filter((f) => detectKind(f) !== null)
        if (arr.length === 0) {
            setErr('Aucun fichier image/vidéo détecté.')
            return
        }
        setErr(null)
        // Batch only allowed when LUT is loaded OR if user explicitly picks multiple
        if (lutFile || arr.length > 1) {
            setFiles((prev) => [...prev, ...arr])
        } else {
            setFiles(arr.slice(0, 1))
            setGrade(DEFAULT_GRADE)
        }
    }

    const onDrop = (e: React.DragEvent) => {
        e.preventDefault()
        if (busy) return
        handlePick(e.dataTransfer.files)
    }
    const onDragOver = (e: React.DragEvent) => e.preventDefault()

    const cssFilter = useMemo(() => gradeToCssFilter(grade), [grade])
    const tempOverlay = useMemo(() => temperatureToOverlay(grade.temperature), [grade.temperature])
    const liftOverlay = useMemo(() => lggToOverlay(grade.liftColor, grade.liftAmount, 0.20), [grade.liftColor, grade.liftAmount])
    const gainOverlay = useMemo(() => lggToOverlay(grade.gainColor, grade.gainAmount, 0.20), [grade.gainColor, grade.gainAmount])

    const updateGrade = useCallback((patch: Partial<Grade>) => {
        setGrade((g) => ({ ...g, ...patch }))
    }, [])

    // Convert one file, picking the runtime based on the global processingMode.
    const convertOne = useCallback(async (
        file: File,
        fmt: string,
        fileKind: MediaKind,
        progress: (m: string) => void,
    ): Promise<{ downloadUrl: string; filename: string }> => {
        // Frontend path: images only, no LUT (we don't have a CSS-side LUT yet).
        if (
            processingMode === 'frontend' &&
            fileKind === 'image' &&
            !lutFile &&
            isClientSupportedFormat(fmt)
        ) {
            const cg: ClientGrade = {
                exposure: grade.exposure, contrast: grade.contrast,
                highlights: grade.highlights, shadows: grade.shadows,
                whites: grade.whites, blacks: grade.blacks,
                saturation: grade.saturation, temperature: grade.temperature, tint: grade.tint,
                sharpness: grade.sharpness,
                vignette: grade.vignette, grain: grade.grain,
                chromatic: grade.chromatic, glow: grade.glow,
                removeEnabled: grade.removeEnabled,
                removeColor: grade.removeColor,
                removeTolerance: grade.removeTolerance,
            }
            const { blob, filename } = await processImageClientSide(file, cg, fmt, progress)
            const url = URL.createObjectURL(blob)
            return { downloadUrl: url, filename }
        }
        // Backend path: everything else.
        return uploadAndConvert(file, fmt, grade, fileKind, lutFile, progress)
    }, [processingMode, grade, lutFile])

    const apply = useCallback(async () => {
        if (files.length === 0 || !kind || !outputFormat) return
        setBusy(true); setErr(null)
        try {
            if (files.length === 1) {
                const file = files[0]
                const { downloadUrl, filename } = await convertOne(file, outputFormat, kind, setBusyMessage)
                setBatch([{ file, state: 'done', progress: 'Prêt', downloadUrl, filename }])
            } else {
                const initial = files.map<BatchItem>((f) => ({ file: f, state: 'idle', progress: '' }))
                setBatch(initial)
                for (let i = 0; i < files.length; i++) {
                    setBatch((b) => b.map((it, j) => j === i ? { ...it, state: 'busy', progress: 'En cours…' } : it))
                    try {
                        const fileKind = detectKind(files[i])
                        if (!fileKind) throw new Error('type non supporté')
                        const fmt = fileKind === 'video' ? outputFormat : (IMAGE_OUTPUTS.includes(outputFormat as typeof IMAGE_OUTPUTS[number]) ? outputFormat : 'png')
                        const { downloadUrl, filename } = await convertOne(files[i], fmt, fileKind, () => {})
                        setBatch((b) => b.map((it, j) => j === i ? { ...it, state: 'done', progress: 'Prêt', downloadUrl, filename } : it))
                    } catch (e) {
                        setBatch((b) => b.map((it, j) => j === i ? { ...it, state: 'error', progress: '', error: e instanceof Error ? e.message : 'Erreur' } : it))
                    }
                }
            }
            setBusyMessage('Terminé ✓')
        } catch (e) {
            setErr(e instanceof Error ? e.message : 'Erreur inconnue')
        } finally {
            setBusy(false)
        }
    }, [files, kind, outputFormat, convertOne])

    const reset = () => {
        setFiles([]); setGrade(DEFAULT_GRADE)
        setLutFile(null); setBatch([])
        setErr(null); setBusyMessage('')
    }

    const outputs = kind === 'video' ? VIDEO_OUTPUTS : kind === 'image' ? IMAGE_OUTPUTS : []

    return (
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-10">
            <div className="mb-6 text-center">
                <h1 className="inline-flex items-center gap-2 text-3xl font-semibold tracking-tight sm:text-4xl">
                    <IconWand size={24} className="text-primary" />
                    Color Lab
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    Étalonnage couleur image et vidéo avec aperçu temps réel.
                </p>
                <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1 text-[11px]">
                    <span className={`h-1.5 w-1.5 rounded-full ${processingMode === 'frontend' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                    <span className="text-muted-foreground">Mode :</span>
                    <span className="font-semibold text-foreground">
                        {processingMode === 'frontend' ? 'Frontend (navigateur)' : 'Backend (serveur)'}
                    </span>
                    <span className="text-muted-foreground">
                        — {processingMode === 'frontend'
                            ? 'images locales sans upload'
                            : 'images + vidéos avec FFmpeg'}
                    </span>
                </div>
            </div>

            {files.length === 0 && (
                <div
                    onDrop={onDrop} onDragOver={onDragOver}
                    onClick={() => fileInputRef.current?.click()}
                    className="mx-auto flex max-w-3xl cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border bg-card/40 px-6 py-16 text-center transition-colors hover:border-primary/40 hover:bg-card"
                >
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                        <IconImage size={26} />
                    </div>
                    <p className="mt-4 text-sm font-medium text-foreground">Déposez une image ou des vidéos</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Charge un fichier pour l'étalonnage. Importe un LUT pour traiter plusieurs vidéos d'un coup.
                    </p>
                    <input
                        ref={fileInputRef} type="file" multiple
                        accept="image/*,video/*" className="hidden"
                        onChange={(e) => handlePick(e.target.files)}
                    />
                </div>
            )}

            {files.length > 0 && previewUrl && (
                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
                    {/* ── Preview / batch list ── */}
                    <div className="space-y-3">
                        <div className="relative overflow-hidden rounded-2xl border border-border bg-black/60 shadow-sm" style={{ aspectRatio: isVideo ? '16/9' : 'auto' }}>
                            <div className="absolute inset-0 flex items-center justify-center">
                                {kind === 'image' ? (
                                    <img
                                        src={previewUrl} alt="Aperçu"
                                        className="max-h-[70vh] max-w-full object-contain"
                                        style={{ filter: cssFilter }}
                                    />
                                ) : (
                                    <video
                                        src={previewUrl}
                                        controls loop playsInline
                                        className="max-h-[70vh] w-full object-contain"
                                        style={{ filter: cssFilter }}
                                    />
                                )}
                                {/* Temperature overlay */}
                                <div className="pointer-events-none absolute inset-0" style={{ backgroundColor: tempOverlay.rgba, mixBlendMode: tempOverlay.mixBlend }} />
                                {/* LGG hint overlays (approximation) */}
                                <div className="pointer-events-none absolute inset-0" style={{ backgroundColor: liftOverlay.rgba, mixBlendMode: liftOverlay.mixBlend }} />
                                <div className="pointer-events-none absolute inset-0" style={{ backgroundColor: gainOverlay.rgba, mixBlendMode: gainOverlay.mixBlend }} />
                                {/* Vignette overlay (visual hint only) */}
                                {grade.vignette > 0 && (
                                    <div
                                        className="pointer-events-none absolute inset-0"
                                        style={{
                                            background: `radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,${(grade.vignette / 100) * 0.7}) 110%)`,
                                        }}
                                    />
                                )}
                                {/* Grain overlay */}
                                {grade.grain > 0 && (
                                    <div
                                        className="pointer-events-none absolute inset-0 opacity-30"
                                        style={{
                                            backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.5'/></svg>\")",
                                            opacity: grade.grain / 200,
                                            mixBlendMode: 'overlay',
                                        }}
                                    />
                                )}
                            </div>
                        </div>

                        {/* File list */}
                        <div className="space-y-1.5">
                            {files.map((f, i) => {
                                const item = batch[i]
                                return (
                                    <div key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card/60 px-3 py-2 text-xs">
                                        <div className="flex min-w-0 items-center gap-2">
                                            {detectKind(f) === 'video' ? <IconVideo size={13} /> : <IconImage size={13} />}
                                            <span className="truncate font-medium text-foreground">{f.name}</span>
                                            <span className="shrink-0 text-muted-foreground">· {formatSize(f.size)}</span>
                                        </div>
                                        <div className="flex shrink-0 items-center gap-2">
                                            {item?.state === 'done' && item.downloadUrl && (
                                                <a
                                                    href={item.downloadUrl} download={item.filename}
                                                    className="inline-flex h-6 items-center gap-1 rounded-md bg-emerald-500/15 px-2 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/25"
                                                >
                                                    <IconDownload size={11} />
                                                    Télécharger
                                                </a>
                                            )}
                                            {item?.state === 'busy' && (
                                                <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                                            )}
                                            {item?.state === 'error' && (
                                                <span className="text-destructive">{item.error}</span>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}
                                                className="text-muted-foreground hover:text-destructive"
                                                disabled={busy}
                                            >
                                                <IconX size={12} />
                                            </button>
                                        </div>
                                    </div>
                                )
                            })}
                            {(lutFile || isMultiBatch) && (
                                <button
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground"
                                >
                                    + Ajouter d'autres fichiers
                                </button>
                            )}
                        </div>

                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>Aperçu sur le 1er fichier</span>
                            <button type="button" onClick={reset} className="hover:text-destructive">
                                <IconX size={11} className="inline-block mr-1" /> Tout effacer
                            </button>
                        </div>
                    </div>

                    {/* ── Right panel ── */}
                    <div className="space-y-3 self-start lg:sticky lg:top-[80px] max-h-[calc(100vh-7rem)] overflow-y-auto pr-1">
                        <div className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
                            <div className="flex items-center justify-between">
                                <h2 className="text-sm font-semibold">Étalonnage</h2>
                                <button
                                    type="button"
                                    onClick={() => setGrade(DEFAULT_GRADE)}
                                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                                >
                                    <IconRefresh size={11} />
                                    Reset
                                </button>
                            </div>

                            <CollapsibleSection title="Lumière">
                                <Slider label="Exposition" value={grade.exposure} min={-2} max={2} step={0.1} onChange={(v) => updateGrade({ exposure: v })} suffix=" EV" />
                                <Slider label="Contraste" value={grade.contrast} min={-100} max={100} step={1} onChange={(v) => updateGrade({ contrast: v })} />
                                <Slider label="Hautes lumières" value={grade.highlights} min={-100} max={100} step={1} onChange={(v) => updateGrade({ highlights: v })} />
                                <Slider label="Ombres" value={grade.shadows} min={-100} max={100} step={1} onChange={(v) => updateGrade({ shadows: v })} />
                                <Slider label="Blancs" value={grade.whites} min={-100} max={100} step={1} onChange={(v) => updateGrade({ whites: v })} />
                                <Slider label="Noirs" value={grade.blacks} min={-100} max={100} step={1} onChange={(v) => updateGrade({ blacks: v })} />
                            </CollapsibleSection>

                            <CollapsibleSection title="Couleur">
                                <Slider label="Saturation" value={grade.saturation} min={-100} max={100} step={1} onChange={(v) => updateGrade({ saturation: v })} />
                                <Slider label="Température" value={grade.temperature} min={-100} max={100} step={1} onChange={(v) => updateGrade({ temperature: v })} />
                                <Slider label="Teinte" value={grade.tint} min={-100} max={100} step={1} onChange={(v) => updateGrade({ tint: v })} />
                                <Slider label="Hue (°)" value={grade.hue} min={-180} max={180} step={1} onChange={(v) => updateGrade({ hue: v })} suffix="°" disabled={!isVideo} />
                                {!isVideo && <p className="text-[10px] italic text-muted-foreground">Hue n'est dispo que pour la vidéo.</p>}
                            </CollapsibleSection>

                            {isVideo && (
                                <CollapsibleSection title="Color Wheels (DaVinci)">
                                    <ColorSwatch
                                        label="Lift (ombres)"
                                        color={grade.liftColor} amount={grade.liftAmount}
                                        onColorChange={(c) => updateGrade({ liftColor: c })}
                                        onAmountChange={(a) => updateGrade({ liftAmount: a })}
                                        onReset={() => updateGrade({ liftColor: NEUTRAL, liftAmount: 1 })}
                                    />
                                    <ColorSwatch
                                        label="Gamma (mids)"
                                        color={grade.gammaColor} amount={grade.gammaAmount}
                                        onColorChange={(c) => updateGrade({ gammaColor: c })}
                                        onAmountChange={(a) => updateGrade({ gammaAmount: a })}
                                        onReset={() => updateGrade({ gammaColor: NEUTRAL, gammaAmount: 1 })}
                                    />
                                    <ColorSwatch
                                        label="Gain (hautes lumières)"
                                        color={grade.gainColor} amount={grade.gainAmount}
                                        onColorChange={(c) => updateGrade({ gainColor: c })}
                                        onAmountChange={(a) => updateGrade({ gainAmount: a })}
                                        onReset={() => updateGrade({ gainColor: NEUTRAL, gainAmount: 1 })}
                                    />
                                    <p className="text-[10px] italic text-muted-foreground">FFmpeg <code className="font-mono">colorbalance</code>. Couleurs proches du gris = neutre.</p>
                                </CollapsibleSection>
                            )}

                            <CollapsibleSection title="Détail">
                                <Slider label="Netteté" value={grade.sharpness} min={-100} max={100} step={1} onChange={(v) => updateGrade({ sharpness: v })} />
                            </CollapsibleSection>

                            {isVideo && (
                                <CollapsibleSection title="Effets" defaultOpen={false}>
                                    <Slider label="Vignette" value={grade.vignette} min={0} max={100} step={1} onChange={(v) => updateGrade({ vignette: v })} suffix=" %" />
                                    <Slider label="Glow (flou doux)" value={grade.glow} min={0} max={100} step={1} onChange={(v) => updateGrade({ glow: v })} suffix=" %" />
                                    <Slider label="Grain film" value={grade.grain} min={0} max={100} step={1} onChange={(v) => updateGrade({ grain: v })} suffix=" %" />
                                    <Slider label="Aberration chromatique" value={grade.chromatic} min={0} max={20} step={1} onChange={(v) => updateGrade({ chromatic: v })} suffix=" px" />
                                </CollapsibleSection>
                            )}

                            <CollapsibleSection title="Color Remover" defaultOpen={false}>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs">Activer</span>
                                    <label className="relative inline-flex h-5 w-9 cursor-pointer items-center">
                                        <input
                                            type="checkbox"
                                            checked={grade.removeEnabled}
                                            onChange={(e) => updateGrade({ removeEnabled: e.target.checked })}
                                            className="peer sr-only"
                                        />
                                        <span className="absolute inset-0 rounded-full bg-muted peer-checked:bg-primary transition-colors" />
                                        <span className="absolute left-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform peer-checked:translate-x-4" />
                                    </label>
                                </div>
                                {grade.removeEnabled && (
                                    <>
                                        <div className="flex items-center gap-2">
                                            <input type="color"
                                                value={grade.removeColor}
                                                onChange={(e) => updateGrade({ removeColor: e.target.value })}
                                                className="h-8 w-10 shrink-0 rounded border border-border bg-background cursor-pointer"
                                            />
                                            <input
                                                type="text"
                                                value={grade.removeColor}
                                                onChange={(e) => updateGrade({ removeColor: e.target.value })}
                                                placeholder="#ffffff"
                                                className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs"
                                            />
                                        </div>
                                        <Slider label="Tolérance" value={grade.removeTolerance} min={0} max={100} step={1} onChange={(v) => updateGrade({ removeTolerance: v })} suffix=" %" />
                                        <p className="text-[10px] italic text-muted-foreground">
                                            Sortie {kind === 'image' ? 'PNG/WebP' : 'WebM/MOV'} pour préserver la transparence.
                                        </p>
                                    </>
                                )}
                            </CollapsibleSection>

                            <CollapsibleSection title="LUT (.cube)" defaultOpen={false}>
                                {lutFile ? (
                                    <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-background/60 px-2 py-1.5">
                                        <span className="truncate text-xs text-emerald-500">{lutFile.name}</span>
                                        <button type="button" onClick={() => setLutFile(null)} className="text-muted-foreground hover:text-destructive">
                                            <IconX size={12} />
                                        </button>
                                    </div>
                                ) : (
                                    <label className="flex h-9 cursor-pointer items-center justify-center rounded-md border border-dashed border-border bg-background/40 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground">
                                        Charger un fichier .cube…
                                        <input
                                            ref={lutInputRef}
                                            type="file" accept=".cube" className="hidden"
                                            onChange={(e) => {
                                                const f = e.target.files?.[0]
                                                if (f) setLutFile(f)
                                                e.target.value = ''
                                            }}
                                        />
                                    </label>
                                )}
                                <p className="text-[10px] italic text-muted-foreground">
                                    {lutFile
                                        ? "Mode batch actif : tu peux ajouter plusieurs vidéos, le LUT sera appliqué à toutes."
                                        : "Charge un LUT pour appliquer un look pré-fait. En mode LUT tu peux convertir plusieurs vidéos d'un coup."}
                                </p>
                            </CollapsibleSection>

                            <div className="space-y-2 border-t border-border pt-3">
                                <label className="text-xs font-medium text-muted-foreground">Format de sortie</label>
                                <div className="flex flex-wrap gap-1.5">
                                    {outputs.map((fmt) => (
                                        <button
                                            key={fmt} type="button"
                                            onClick={() => setOutputFormat(fmt)}
                                            className={cn(
                                                "rounded-md border px-2.5 py-1 text-xs font-mono font-semibold transition-colors",
                                                outputFormat === fmt
                                                    ? "border-primary bg-primary text-primary-foreground"
                                                    : "border-border bg-background text-muted-foreground hover:border-muted-foreground hover:text-foreground",
                                            )}
                                        >
                                            {fmt.toUpperCase()}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {err && (
                                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                                    {err}
                                </div>
                            )}

                            <Button
                                type="button"
                                onClick={apply}
                                disabled={busy || !outputFormat || files.length === 0}
                                className="w-full h-11 text-sm font-semibold gap-2 rounded-xl"
                            >
                                {busy ? (
                                    <>
                                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground" />
                                        {busyMessage || 'Traitement…'}
                                    </>
                                ) : (
                                    <>
                                        <IconWand size={15} />
                                        {files.length > 1 ? `Traiter ${files.length} fichiers` : 'Appliquer & télécharger'}
                                    </>
                                )}
                            </Button>

                            <p className="text-[11px] leading-4 text-muted-foreground">
                                Aperçu approximatif (CSS). Rendu final précis : FFmpeg pour vidéo, Pillow pour image.
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
