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
import { parseCubeLut, type Lut3D } from '@/lib/cubeLut'
import { createLutRenderer, gradeToExtraFilter, type LutRenderer } from '@/lib/lutGLPreview'
import { cn } from '@/lib/utils'
import { formatSize, getFileType } from '@/types'

// ──────────────────────────────────────────────────────────
// Color Lab — multi-file colour grading workspace.
//
// Highlights:
//   - per-file Grade objects, navigated with ← / → buttons or arrow keys
//   - LUT (.cube) can apply globally (one for all videos) or per file
//   - live WebGL2 LUT preview on video (LUT + brightness/contrast/sat/hue/vignette
//     applied in a fragment shader, real-time at native frame rate)
//   - FPS slider 1..original (estimated client-side via rVFC when available)
// ──────────────────────────────────────────────────────────

type ProcessingMode = 'frontend' | 'backend'

interface ColorLabProps {
    processingMode: ProcessingMode
}

type MediaKind = 'image' | 'video'

interface Grade {
    // Light
    exposure: number
    contrast: number
    highlights: number
    shadows: number
    whites: number
    blacks: number
    // Color
    saturation: number
    temperature: number
    tint: number
    hue: number
    // Color wheels (DaVinci LGG)
    liftColor: string
    liftAmount: number
    gammaColor: string
    gammaAmount: number
    gainColor: string
    gainAmount: number
    // Detail
    sharpness: number
    // Effects
    vignette: number
    glow: number
    grain: number
    chromatic: number
    // Color remover
    removeEnabled: boolean
    removeColor: string
    removeTolerance: number
    // Output
    targetFps: number | null   // null = original; 1..originalFps otherwise
    // Per-file LUT (used only when scope === 'per-file')
    lutFile: File | null
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
    targetFps: null,
    lutFile: null,
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
    const blurPx = g.glow > 0 ? (g.glow / 100) * 3.5 : 0
    const blurPart = blurPx > 0 ? ` blur(${blurPx.toFixed(2)}px)` : ''
    return `brightness(${brightness.toFixed(3)}) contrast(${contrast.toFixed(3)}) saturate(${saturate.toFixed(3)}) hue-rotate(${hueDeg}deg)${blurPart}`
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
                <button type="button" onClick={onReset} className="text-[10px] text-muted-foreground hover:text-destructive">Reset</button>
            </div>
            <div className="flex items-center gap-2">
                <input
                    type="color" value={color}
                    onChange={(e) => onColorChange(e.target.value)}
                    className="h-9 w-9 shrink-0 rounded-md border border-border bg-background cursor-pointer"
                />
                <div className="flex-1">
                    <Slider label="Intensité" value={amount} min={0} max={2} step={0.05} onChange={onAmountChange} />
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
                type="button" onClick={() => setOpen((v) => !v)}
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
    if (lutFile) fd.append('lut_file', lutFile)

    const slidersMap: Record<string, [keyof Grade, string, string]> = {
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
        if (grade.vignette > 0) fd.append('video_vignette', String(grade.vignette))
        if (grade.glow > 0) fd.append('video_glow', String(grade.glow))
        if (grade.grain > 0) fd.append('video_grain', String(grade.grain))
        if (grade.chromatic > 0) fd.append('video_chromatic', String(grade.chromatic))
        if (grade.targetFps && grade.targetFps > 0) fd.append('fps', String(grade.targetFps))
    }

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
    state: 'idle' | 'busy' | 'done' | 'error'
    progress: string
    downloadUrl?: string
    filename?: string
    error?: string
}

// Estimate video FPS via requestVideoFrameCallback if available, falling back to 30.
async function estimateFps(video: HTMLVideoElement): Promise<number> {
    return new Promise((resolve) => {
        const w = video as HTMLVideoElement & {
            requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => void
        }
        if (typeof w.requestVideoFrameCallback !== 'function') {
            resolve(30)
            return
        }
        let count = 0
        let first = -1
        const onFrame = (_now: number, meta: { mediaTime: number }) => {
            if (first < 0) first = meta.mediaTime
            count++
            const dt = meta.mediaTime - first
            if (count > 30 || dt > 1.2) {
                const fps = count / Math.max(0.1, dt)
                resolve(Math.round(Math.max(1, Math.min(240, fps))))
                return
            }
            w.requestVideoFrameCallback!(onFrame)
        }
        w.requestVideoFrameCallback(onFrame)
        const wasPaused = video.paused
        video.muted = true
        video.play().catch(() => resolve(30))
        // Restore pause shortly after if we paused before
        setTimeout(() => { if (wasPaused) video.pause() }, 1500)
    })
}

export function ColorLab({ processingMode }: ColorLabProps) {
    // Files + per-file state
    const [files, setFiles] = useState<File[]>([])
    const [grades, setGrades] = useState<Grade[]>([])
    const [activeIndex, setActiveIndex] = useState(0)
    const [batch, setBatch] = useState<BatchItem[]>([])

    // LUT scope & global LUT file
    const [lutScope, setLutScope] = useState<'global' | 'per-file'>('global')
    const [globalLutFile, setGlobalLutFile] = useState<File | null>(null)
    const [parsedGlobalLut, setParsedGlobalLut] = useState<Lut3D | null>(null)
    const parsedLutCacheRef = useRef<Map<string, Lut3D>>(new Map())

    // FPS estimation
    const [originalFps, setOriginalFps] = useState<Record<number, number>>({})

    // Preview / runtime
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const [busyMessage, setBusyMessage] = useState('')
    const [err, setErr] = useState<string | null>(null)
    const [outputFormat, setOutputFormat] = useState<string>('')
    const fileInputRef = useRef<HTMLInputElement>(null)
    const lutInputRef = useRef<HTMLInputElement>(null)
    const videoRef = useRef<HTMLVideoElement | null>(null)
    const glCanvasRef = useRef<HTMLCanvasElement | null>(null)
    const lutRendererRef = useRef<LutRenderer | null>(null)

    const file = files[activeIndex] || null
    const grade = grades[activeIndex] || DEFAULT_GRADE
    const kind: MediaKind | null = file ? detectKind(file) : null
    const isVideo = kind === 'video'

    // Active LUT (depending on scope)
    const activeLutFile = lutScope === 'global' ? globalLutFile : grade.lutFile
    const activeParsedLut = useMemo(() => {
        if (!activeLutFile) return null
        const key = `${activeLutFile.name}-${activeLutFile.size}-${activeLutFile.lastModified}`
        if (parsedLutCacheRef.current.has(key)) return parsedLutCacheRef.current.get(key)!
        return null
    }, [activeLutFile])

    // Object URL for the active preview
    useEffect(() => {
        if (!file) { setPreviewUrl(null); return }
        const url = URL.createObjectURL(file)
        setPreviewUrl(url)
        return () => URL.revokeObjectURL(url)
    }, [file])

    // Pick a reasonable default output format whenever the active file changes
    useEffect(() => {
        if (!file) return
        if (kind === 'image') setOutputFormat((prev) => prev || 'png')
        else if (kind === 'video') setOutputFormat((prev) => prev || 'mp4')
    }, [file, kind])

    // Parse the active LUT once (cache by file identity)
    useEffect(() => {
        if (!activeLutFile) {
            if (lutScope === 'global') setParsedGlobalLut(null)
            return
        }
        const key = `${activeLutFile.name}-${activeLutFile.size}-${activeLutFile.lastModified}`
        if (parsedLutCacheRef.current.has(key)) {
            if (lutScope === 'global') setParsedGlobalLut(parsedLutCacheRef.current.get(key)!)
            return
        }
        activeLutFile.text().then((txt) => {
            try {
                const lut = parseCubeLut(txt)
                parsedLutCacheRef.current.set(key, lut)
                if (lutScope === 'global') setParsedGlobalLut(lut)
            } catch (e) {
                console.warn('[lut] parse failed:', e)
            }
        })
    }, [activeLutFile, lutScope])

    // WebGL renderer lifecycle — when active file is video and refs exist
    useEffect(() => {
        if (!isVideo || !videoRef.current || !glCanvasRef.current) return
        const r = createLutRenderer(glCanvasRef.current, videoRef.current)
        if (!r) return
        lutRendererRef.current = r
        r.start()
        return () => { r.stop(); lutRendererRef.current = null }
    }, [isVideo, file])

    // Push LUT + filter into renderer whenever they change
    useEffect(() => {
        if (!lutRendererRef.current) return
        lutRendererRef.current.setLut(activeParsedLut || parsedGlobalLut || null)
        lutRendererRef.current.setExtraFilter(
            gradeToExtraFilter({
                exposure: grade.exposure, contrast: grade.contrast, saturation: grade.saturation,
                hue: grade.hue, tint: grade.tint, vignette: grade.vignette,
            }),
        )
    }, [grade, activeParsedLut, parsedGlobalLut])

    // Estimate FPS for the currently active video once it can play
    useEffect(() => {
        if (!isVideo || !videoRef.current || originalFps[activeIndex]) return
        const v = videoRef.current
        const onCanPlay = () => {
            estimateFps(v).then((fps) => {
                setOriginalFps((prev) => ({ ...prev, [activeIndex]: fps }))
            })
        }
        if (v.readyState >= 2) onCanPlay()
        else v.addEventListener('loadeddata', onCanPlay, { once: true })
        return () => v.removeEventListener('loadeddata', onCanPlay)
    }, [isVideo, activeIndex, originalFps])

    // Keyboard arrows to navigate
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.target as HTMLElement)?.tagName === 'INPUT') return
            if (e.key === 'ArrowLeft') setActiveIndex((i) => Math.max(0, i - 1))
            else if (e.key === 'ArrowRight') setActiveIndex((i) => Math.min(files.length - 1, i + 1))
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [files.length])

    const handlePick = (incoming: FileList | File[] | null) => {
        if (!incoming) return
        const arr = Array.from(incoming).filter((f) => detectKind(f) !== null)
        if (arr.length === 0) {
            setErr('Aucun fichier image/vidéo détecté.')
            return
        }
        setErr(null)
        setFiles((prev) => [...prev, ...arr])
        setGrades((prev) => [...prev, ...arr.map(() => ({ ...DEFAULT_GRADE }))])
    }

    const onDrop = (e: React.DragEvent) => {
        e.preventDefault()
        if (busy) return
        handlePick(e.dataTransfer.files)
    }
    const onDragOver = (e: React.DragEvent) => e.preventDefault()

    const updateGrade = useCallback((patch: Partial<Grade>) => {
        setGrades((prev) => prev.map((g, i) => (i === activeIndex ? { ...g, ...patch } : g)))
    }, [activeIndex])

    const removeFile = (idx: number) => {
        setFiles((prev) => prev.filter((_, i) => i !== idx))
        setGrades((prev) => prev.filter((_, i) => i !== idx))
        setBatch((prev) => prev.filter((_, i) => i !== idx))
        setActiveIndex((curr) => {
            if (curr > idx) return curr - 1
            if (curr >= files.length - 1) return Math.max(0, files.length - 2)
            return curr
        })
    }

    const cssFilter = useMemo(() => gradeToCssFilter(grade), [grade])

    const apply = useCallback(async () => {
        if (files.length === 0 || !outputFormat) return
        setBusy(true); setErr(null)
        try {
            const initial: BatchItem[] = files.map(() => ({ state: 'idle', progress: '' }))
            setBatch(initial)

            for (let i = 0; i < files.length; i++) {
                const f = files[i]
                const fKind = detectKind(f)
                if (!fKind) {
                    setBatch((b) => b.map((it, j) => j === i ? { ...it, state: 'error', error: 'type non supporté' } : it))
                    continue
                }
                const fGrade = grades[i] || DEFAULT_GRADE
                const fLut = lutScope === 'global' ? globalLutFile : fGrade.lutFile
                const fmt = fKind === 'video'
                    ? (VIDEO_OUTPUTS.includes(outputFormat as typeof VIDEO_OUTPUTS[number]) ? outputFormat : 'mp4')
                    : (IMAGE_OUTPUTS.includes(outputFormat as typeof IMAGE_OUTPUTS[number]) ? outputFormat : 'png')

                setBatch((b) => b.map((it, j) => j === i ? { ...it, state: 'busy', progress: 'En cours…' } : it))

                try {
                    // Frontend image processing if conditions allow
                    if (
                        processingMode === 'frontend' &&
                        fKind === 'image' &&
                        isClientSupportedFormat(fmt)
                    ) {
                        const cg: ClientGrade = {
                            exposure: fGrade.exposure, contrast: fGrade.contrast,
                            highlights: fGrade.highlights, shadows: fGrade.shadows,
                            whites: fGrade.whites, blacks: fGrade.blacks,
                            saturation: fGrade.saturation, temperature: fGrade.temperature, tint: fGrade.tint,
                            sharpness: fGrade.sharpness,
                            vignette: fGrade.vignette, grain: fGrade.grain,
                            chromatic: fGrade.chromatic, glow: fGrade.glow,
                            removeEnabled: fGrade.removeEnabled,
                            removeColor: fGrade.removeColor,
                            removeTolerance: fGrade.removeTolerance,
                        }
                        const { blob, filename } = await processImageClientSide(f, cg, fmt, undefined, fLut)
                        const url = URL.createObjectURL(blob)
                        setBatch((b) => b.map((it, j) => j === i ? { ...it, state: 'done', progress: 'Prêt', downloadUrl: url, filename } : it))
                        continue
                    }

                    // Frontend video processing via ffmpeg.wasm
                    if (processingMode === 'frontend' && fKind === 'video') {
                        const { processVideoClientSide, isClientSupportedVideoFormat } = await import('@/lib/clientVideoProcessor')
                        if (isClientSupportedVideoFormat(fmt)) {
                            const vg = {
                                exposure: fGrade.exposure, contrast: fGrade.contrast,
                                highlights: fGrade.highlights, shadows: fGrade.shadows,
                                whites: fGrade.whites, blacks: fGrade.blacks,
                                saturation: fGrade.saturation, temperature: fGrade.temperature,
                                tint: fGrade.tint, hue: fGrade.hue,
                                sharpness: fGrade.sharpness,
                                vignette: fGrade.vignette, grain: fGrade.grain,
                                chromatic: fGrade.chromatic, glow: fGrade.glow,
                                targetFps: fGrade.targetFps,
                            }
                            const { blob, filename } = await processVideoClientSide(
                                f, fmt, vg,
                                (msg, ratio) => {
                                    setBatch((b) => b.map((it, j) => j === i
                                        ? { ...it, state: 'busy', progress: ratio != null ? `${Math.round(ratio * 100)} %` : msg }
                                        : it,
                                    ))
                                },
                                fLut,
                            )
                            const url = URL.createObjectURL(blob)
                            setBatch((b) => b.map((it, j) => j === i ? { ...it, state: 'done', progress: 'Prêt', downloadUrl: url, filename } : it))
                            continue
                        }
                    }

                    // Backend fallback
                    const { downloadUrl, filename } = await uploadAndConvert(f, fmt, fGrade, fKind, fLut)
                    setBatch((b) => b.map((it, j) => j === i ? { ...it, state: 'done', progress: 'Prêt', downloadUrl, filename } : it))
                } catch (e) {
                    setBatch((b) => b.map((it, j) => j === i ? { ...it, state: 'error', progress: '', error: e instanceof Error ? e.message : 'Erreur' } : it))
                }
            }
            setBusyMessage('Terminé ✓')
        } catch (e) {
            setErr(e instanceof Error ? e.message : 'Erreur inconnue')
        } finally {
            setBusy(false)
        }
    }, [files, grades, outputFormat, lutScope, globalLutFile, processingMode])

    const reset = () => {
        setFiles([]); setGrades([]); setActiveIndex(0)
        setGlobalLutFile(null); setParsedGlobalLut(null)
        setBatch([]); setErr(null); setBusyMessage('')
        setOriginalFps({})
    }

    const outputs = kind === 'video' ? VIDEO_OUTPUTS : kind === 'image' ? IMAGE_OUTPUTS : []
    const detectedOriginalFps = originalFps[activeIndex] || 60

    return (
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-10">
            <div className="mb-6 text-center">
                <h1 className="inline-flex items-center gap-2 text-3xl font-semibold tracking-tight sm:text-4xl">
                    <IconWand size={24} className="text-primary" />
                    Color Lab
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    Étalonnage couleur image et vidéo avec aperçu temps réel, multi-fichiers et LUT live.
                </p>
                <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1 text-[11px]">
                    <span className={`h-1.5 w-1.5 rounded-full ${processingMode === 'frontend' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                    <span className="text-muted-foreground">Mode :</span>
                    <span className="font-semibold text-foreground">
                        {processingMode === 'frontend' ? 'Frontend (navigateur)' : 'Backend (serveur)'}
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
                    <p className="mt-4 text-sm font-medium text-foreground">Déposez une ou plusieurs images / vidéos</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Naviguez avec les flèches, réglez l'étalonnage par fichier, exportez tout d'un coup.
                    </p>
                    <input
                        ref={fileInputRef} type="file" multiple accept="image/*,video/*"
                        className="hidden"
                        onChange={(e) => handlePick(e.target.files)}
                    />
                </div>
            )}

            {file && previewUrl && (
                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
                    {/* ── Preview ── */}
                    <div className="space-y-3">
                        <div className="relative overflow-hidden rounded-2xl border border-border bg-black/60 shadow-sm" style={{ aspectRatio: isVideo ? '16/9' : 'auto' }}>
                            {kind === 'image' ? (
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <img
                                        src={previewUrl} alt="Aperçu"
                                        className="max-h-[70vh] max-w-full object-contain"
                                        style={{ filter: cssFilter }}
                                    />
                                </div>
                            ) : (
                                <div className="absolute inset-0">
                                    {/* The actual <video> is the media source; hidden visually. */}
                                    <video
                                        ref={videoRef}
                                        src={previewUrl}
                                        controls loop playsInline muted
                                        className="absolute inset-0 h-full w-full object-contain opacity-0 pointer-events-none"
                                    />
                                    {/* WebGL canvas displays the LUT + filter result. */}
                                    <canvas
                                        ref={glCanvasRef}
                                        className="absolute inset-0 h-full w-full"
                                    />
                                    {/* Custom controls bar */}
                                    <VideoControls videoRef={videoRef} />
                                </div>
                            )}
                        </div>

                        {/* Navigation arrows */}
                        {files.length > 1 && (
                            <div className="flex items-center justify-between text-xs">
                                <button
                                    type="button"
                                    onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
                                    disabled={activeIndex === 0}
                                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-30"
                                >
                                    ← Précédent
                                </button>
                                <span className="text-muted-foreground">
                                    Fichier <span className="font-semibold text-foreground">{activeIndex + 1}</span> / {files.length}
                                    <span className="ml-2 hidden sm:inline">— navigue avec ← →</span>
                                </span>
                                <button
                                    type="button"
                                    onClick={() => setActiveIndex((i) => Math.min(files.length - 1, i + 1))}
                                    disabled={activeIndex >= files.length - 1}
                                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-30"
                                >
                                    Suivant →
                                </button>
                            </div>
                        )}

                        {/* File list */}
                        <div className="space-y-1.5">
                            {files.map((f, i) => {
                                const item = batch[i]
                                const isCurrent = i === activeIndex
                                return (
                                    <button
                                        key={`${f.name}-${i}`}
                                        type="button"
                                        onClick={() => setActiveIndex(i)}
                                        className={cn(
                                            'flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                                            isCurrent
                                                ? 'border-primary bg-primary/10'
                                                : 'border-border bg-card/60 hover:bg-card',
                                        )}
                                    >
                                        <div className="flex min-w-0 items-center gap-2">
                                            {detectKind(f) === 'video' ? <IconVideo size={13} /> : <IconImage size={13} />}
                                            <span className="truncate font-medium text-foreground">{f.name}</span>
                                            <span className="shrink-0 text-muted-foreground">· {formatSize(f.size)}</span>
                                        </div>
                                        <div className="flex shrink-0 items-center gap-2">
                                            {item?.state === 'done' && item.downloadUrl && (
                                                <a
                                                    href={item.downloadUrl} download={item.filename}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="inline-flex h-6 items-center gap-1 rounded-md bg-emerald-500/15 px-2 text-[11px] font-semibold text-emerald-600 hover:bg-emerald-500/25 dark:text-emerald-400"
                                                >
                                                    <IconDownload size={11} /> Télécharger
                                                </a>
                                            )}
                                            {item?.state === 'busy' && <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />}
                                            {item?.state === 'error' && <span className="text-destructive">{item.error}</span>}
                                            <span
                                                onClick={(e) => { e.stopPropagation(); removeFile(i) }}
                                                className="text-muted-foreground hover:text-destructive cursor-pointer"
                                            >
                                                <IconX size={12} />
                                            </span>
                                        </div>
                                    </button>
                                )
                            })}
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground"
                            >
                                + Ajouter d'autres fichiers
                            </button>
                        </div>

                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>Aperçu sur le fichier actif</span>
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
                                    onClick={() => updateGrade(DEFAULT_GRADE)}
                                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                                >
                                    <IconRefresh size={11} /> Reset
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
                            </CollapsibleSection>

                            {isVideo && (
                                <CollapsibleSection title="Color Wheels (DaVinci)" defaultOpen={false}>
                                    <ColorSwatch label="Lift (ombres)" color={grade.liftColor} amount={grade.liftAmount}
                                        onColorChange={(c) => updateGrade({ liftColor: c })}
                                        onAmountChange={(a) => updateGrade({ liftAmount: a })}
                                        onReset={() => updateGrade({ liftColor: NEUTRAL, liftAmount: 1 })} />
                                    <ColorSwatch label="Gamma (mids)" color={grade.gammaColor} amount={grade.gammaAmount}
                                        onColorChange={(c) => updateGrade({ gammaColor: c })}
                                        onAmountChange={(a) => updateGrade({ gammaAmount: a })}
                                        onReset={() => updateGrade({ gammaColor: NEUTRAL, gammaAmount: 1 })} />
                                    <ColorSwatch label="Gain (hautes lumières)" color={grade.gainColor} amount={grade.gainAmount}
                                        onColorChange={(c) => updateGrade({ gainColor: c })}
                                        onAmountChange={(a) => updateGrade({ gainAmount: a })}
                                        onReset={() => updateGrade({ gainColor: NEUTRAL, gainAmount: 1 })} />
                                </CollapsibleSection>
                            )}

                            <CollapsibleSection title="Détail" defaultOpen={false}>
                                <Slider label="Netteté" value={grade.sharpness} min={-100} max={100} step={1} onChange={(v) => updateGrade({ sharpness: v })} />
                            </CollapsibleSection>

                            {isVideo && (
                                <CollapsibleSection title="Effets" defaultOpen={false}>
                                    <Slider label="Vignette" value={grade.vignette} min={0} max={100} step={1} onChange={(v) => updateGrade({ vignette: v })} suffix=" %" />
                                    <Slider label="Glow" value={grade.glow} min={0} max={100} step={1} onChange={(v) => updateGrade({ glow: v })} suffix=" %" />
                                    <Slider label="Grain film" value={grade.grain} min={0} max={100} step={1} onChange={(v) => updateGrade({ grain: v })} suffix=" %" />
                                    <Slider label="Aberration chromatique" value={grade.chromatic} min={0} max={20} step={1} onChange={(v) => updateGrade({ chromatic: v })} suffix=" px" />
                                </CollapsibleSection>
                            )}

                            {isVideo && (
                                <CollapsibleSection title="Compression" defaultOpen={false}>
                                    <div className="space-y-1.5">
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs font-medium">FPS de sortie</span>
                                            <span className="text-[11px] font-mono text-muted-foreground tabular-nums">
                                                {grade.targetFps ? `${grade.targetFps} fps` : `original (${detectedOriginalFps} fps)`}
                                            </span>
                                        </div>
                                        <input
                                            type="range"
                                            min={1}
                                            max={detectedOriginalFps}
                                            step={1}
                                            value={grade.targetFps ?? detectedOriginalFps}
                                            onChange={(e) => {
                                                const v = parseInt(e.target.value, 10)
                                                updateGrade({ targetFps: v >= detectedOriginalFps ? null : v })
                                            }}
                                            className="h-1.5 w-full accent-primary"
                                        />
                                        <p className="text-[10px] italic text-muted-foreground">
                                            Baisser le FPS = fichier plus léger. {detectedOriginalFps && `FPS d'origine détecté : ${detectedOriginalFps}.`}
                                        </p>
                                    </div>
                                </CollapsibleSection>
                            )}

                            <CollapsibleSection title="Color Remover" defaultOpen={false}>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs">Activer</span>
                                    <label className="relative inline-flex h-5 w-9 cursor-pointer items-center">
                                        <input type="checkbox" checked={grade.removeEnabled}
                                            onChange={(e) => updateGrade({ removeEnabled: e.target.checked })}
                                            className="peer sr-only" />
                                        <span className="absolute inset-0 rounded-full bg-muted peer-checked:bg-primary transition-colors" />
                                        <span className="absolute left-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform peer-checked:translate-x-4" />
                                    </label>
                                </div>
                                {grade.removeEnabled && (
                                    <>
                                        <div className="flex items-center gap-2">
                                            <input type="color" value={grade.removeColor}
                                                onChange={(e) => updateGrade({ removeColor: e.target.value })}
                                                className="h-8 w-10 shrink-0 rounded border border-border bg-background cursor-pointer" />
                                            <input type="text" value={grade.removeColor}
                                                onChange={(e) => updateGrade({ removeColor: e.target.value })}
                                                placeholder="#ffffff"
                                                className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs" />
                                        </div>
                                        <Slider label="Tolérance" value={grade.removeTolerance} min={0} max={100} step={1} onChange={(v) => updateGrade({ removeTolerance: v })} suffix=" %" />
                                    </>
                                )}
                            </CollapsibleSection>

                            <CollapsibleSection title="LUT (.cube)" defaultOpen>
                                <div className="space-y-2">
                                    <div className="flex items-center gap-1 rounded-md border border-border bg-background/60 p-0.5">
                                        <button
                                            type="button"
                                            onClick={() => setLutScope('global')}
                                            className={cn(
                                                'flex-1 rounded px-2 py-1 text-[11px] font-semibold transition-colors',
                                                lutScope === 'global' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground',
                                            )}
                                        >
                                            Global (tous les fichiers)
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setLutScope('per-file')}
                                            className={cn(
                                                'flex-1 rounded px-2 py-1 text-[11px] font-semibold transition-colors',
                                                lutScope === 'per-file' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground',
                                            )}
                                        >
                                            Par fichier
                                        </button>
                                    </div>

                                    {(() => {
                                        const lutForSlot = lutScope === 'global' ? globalLutFile : grade.lutFile
                                        const setLut = (f: File | null) => {
                                            if (lutScope === 'global') setGlobalLutFile(f)
                                            else updateGrade({ lutFile: f })
                                        }
                                        return lutForSlot ? (
                                            <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-background/60 px-2 py-1.5">
                                                <span className="truncate text-xs text-emerald-500">{lutForSlot.name}</span>
                                                <button type="button" onClick={() => setLut(null)} className="text-muted-foreground hover:text-destructive">
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
                                                        if (f) setLut(f)
                                                        e.target.value = ''
                                                    }}
                                                />
                                            </label>
                                        )
                                    })()}
                                    <p className="text-[10px] italic text-muted-foreground">
                                        L'aperçu vidéo applique le LUT en temps réel (WebGL). Les sliders s'ajoutent par-dessus.
                                    </p>
                                </div>
                            </CollapsibleSection>

                            <div className="space-y-2 border-t border-border pt-3">
                                <label className="text-xs font-medium text-muted-foreground">Format de sortie</label>
                                <div className="flex flex-wrap gap-1.5">
                                    {outputs.map((fmt) => (
                                        <button
                                            key={fmt} type="button"
                                            onClick={() => setOutputFormat(fmt)}
                                            className={cn(
                                                'rounded-md border px-2.5 py-1 text-xs font-mono font-semibold transition-colors',
                                                outputFormat === fmt
                                                    ? 'border-primary bg-primary text-primary-foreground'
                                                    : 'border-border bg-background text-muted-foreground hover:border-muted-foreground hover:text-foreground',
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
                                Chaque fichier garde ses propres réglages (sliders, color wheels, etc.). Le LUT s'applique selon la portée choisie ci-dessus.
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

// ─────────────────────────────────────────────────────────
// Minimal controls underlay for the WebGL canvas: lets the user play/pause
// and seek without showing the hidden <video> tag.
// ─────────────────────────────────────────────────────────
function VideoControls({ videoRef }: { videoRef: React.MutableRefObject<HTMLVideoElement | null> }) {
    const [playing, setPlaying] = useState(false)
    const [progress, setProgress] = useState(0)

    useEffect(() => {
        const v = videoRef.current
        if (!v) return
        const onPlay = () => setPlaying(true)
        const onPause = () => setPlaying(false)
        const onTime = () => {
            if (v.duration) setProgress(v.currentTime / v.duration)
        }
        v.addEventListener('play', onPlay)
        v.addEventListener('pause', onPause)
        v.addEventListener('timeupdate', onTime)
        return () => {
            v.removeEventListener('play', onPlay)
            v.removeEventListener('pause', onPause)
            v.removeEventListener('timeupdate', onTime)
        }
    }, [videoRef])

    const toggle = () => {
        const v = videoRef.current
        if (!v) return
        if (v.paused) v.play().catch(() => { /* ignore */ })
        else v.pause()
    }

    const onScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
        const v = videoRef.current
        if (!v || !v.duration) return
        v.currentTime = v.duration * parseFloat(e.target.value)
    }

    return (
        <div className="pointer-events-auto absolute bottom-2 left-2 right-2 flex items-center gap-3 rounded-lg bg-black/70 px-3 py-2 backdrop-blur-sm">
            <button
                type="button"
                onClick={toggle}
                className="text-white text-base leading-none w-6 text-center"
                aria-label={playing ? 'Pause' : 'Lecture'}
            >
                {playing ? '❚❚' : '▶'}
            </button>
            <input
                type="range" min={0} max={1} step={0.001}
                value={progress}
                onChange={onScrub}
                className="h-1 flex-1 accent-primary"
            />
        </div>
    )
}
