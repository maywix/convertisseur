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
import { createCanvas2DLutRenderer, gradeToExtraFilter, type Canvas2DLutRenderer } from '@/lib/lutCanvas2D'
import { cn } from '@/lib/utils'
import { formatSize, getFileType, type QueueItem } from '@/types'

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
    /** Shared queue so files added in Simple / Pro also show up here, and vice versa. */
    queue: QueueItem[]
    onFilesAdded: (files: FileList | File[]) => Promise<void> | void
    onRemove: (id: string) => void
    onClearAll: () => void
    /** Persisted grading state (lifted to App so it survives mode switches). */
    gradesMap: Record<string, Grade>
    setGradesMap: React.Dispatch<React.SetStateAction<Record<string, Grade>>>
    lutScope: 'global' | 'per-file'
    setLutScope: (scope: 'global' | 'per-file') => void
    globalLutFile: File | null
    setGlobalLutFile: (f: File | null) => void
}

type MediaKind = 'image' | 'video'

export interface Grade {
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
    // Advanced: trim + text overlay
    trimStart: string          // "" or "HH:MM:SS"
    trimEnd: string
    overlayText: string
    overlayTextX: string
    overlayTextY: string
}

export const NEUTRAL = '#808080'

export const DEFAULT_GRADE: Grade = {
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
    trimStart: '', trimEnd: '',
    overlayText: '', overlayTextX: '(w-text_w)/2', overlayTextY: 'h-(text_h*2)',
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
        if (grade.trimStart) fd.append('trim_start', grade.trimStart)
        if (grade.trimEnd) fd.append('trim_end', grade.trimEnd)
        if (grade.overlayText) {
            fd.append('overlay_text', grade.overlayText)
            fd.append('overlay_text_x', grade.overlayTextX || '(w-text_w)/2')
            fd.append('overlay_text_y', grade.overlayTextY || 'h-(text_h*2)')
        }
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

export function ColorLab({
    processingMode, queue, onFilesAdded, onRemove, onClearAll,
    gradesMap, setGradesMap, lutScope, setLutScope, globalLutFile, setGlobalLutFile,
}: ColorLabProps) {
    // Lab works on the subset of the shared queue that contains images or videos.
    const labItems = useMemo(
        () => queue.filter((it) => detectKind(it.file) !== null),
        [queue],
    )
    const files = useMemo(() => labItems.map((it) => it.file), [labItems])

    // Local UI state (active selection, batch results — these don't need to outlive a mode switch).
    const [activeIndex, setActiveIndex] = useState(0)
    const [batch, setBatch] = useState<Record<string, BatchItem>>({})

    // Initialise grade for any new item that enters the queue.
    useEffect(() => {
        setGradesMap((prev) => {
            const next: Record<string, Grade> = { ...prev }
            let changed = false
            for (const it of labItems) {
                if (!next[it.id]) { next[it.id] = { ...DEFAULT_GRADE }; changed = true }
            }
            return changed ? next : prev
        })
    }, [labItems])

    // Keep activeIndex within bounds.
    useEffect(() => {
        if (activeIndex >= labItems.length && labItems.length > 0) setActiveIndex(labItems.length - 1)
    }, [labItems.length, activeIndex])

    const grades = labItems.map((it) => gradesMap[it.id] || DEFAULT_GRADE)

    // LUT parsing cache (lifted to component lifetime; the Lut3D blob is heavy).
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
    const lutRendererRef = useRef<Canvas2DLutRenderer | null>(null)
    const [videoError, setVideoError] = useState<string | null>(null)
    const [videoReady, setVideoReady] = useState(false)

    const file = files[activeIndex] || null
    const grade = grades[activeIndex] || DEFAULT_GRADE
    const kind: MediaKind | null = file ? detectKind(file) : null
    const isVideo = kind === 'video'

    // Active LUT (depending on scope) — parsed asynchronously into a state so
    // React re-renders the preview once it's ready.
    const activeLutFile = lutScope === 'global' ? globalLutFile : grade.lutFile
    const [activeParsedLut, setActiveParsedLut] = useState<Lut3D | null>(null)

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
            setActiveParsedLut(null)
            if (lutScope === 'global') setParsedGlobalLut(null)
            return
        }
        const key = `${activeLutFile.name}-${activeLutFile.size}-${activeLutFile.lastModified}`
        if (parsedLutCacheRef.current.has(key)) {
            const cached = parsedLutCacheRef.current.get(key)!
            setActiveParsedLut(cached)
            if (lutScope === 'global') setParsedGlobalLut(cached)
            return
        }
        activeLutFile.text().then((txt) => {
            try {
                const lut = parseCubeLut(txt)
                parsedLutCacheRef.current.set(key, lut)
                setActiveParsedLut(lut)
                if (lutScope === 'global') setParsedGlobalLut(lut)
            } catch (e) {
                console.warn('[lut] parse failed:', e)
            }
        })
    }, [activeLutFile, lutScope])

    // Reset video state when the active file changes
    useEffect(() => { setVideoError(null); setVideoReady(false) }, [file])

    // Use the Canvas 2D preview path for *any* video the browser can decode.
    // This makes every slider (incl. temperature, tint) visible live, and the
    // optional LUT is just one more pass on top of the post-process.
    const activeLutForRender = lutScope === 'global' ? globalLutFile : grade.lutFile
    const useGLPreview = isVideo && videoReady && !videoError

    // Build the shape the renderer wants out of the current Grade.
    const currentExtraFilter = useMemo(() => gradeToExtraFilter({
        exposure: grade.exposure, contrast: grade.contrast, saturation: grade.saturation,
        temperature: grade.temperature, tint: grade.tint, hue: grade.hue,
        highlights: grade.highlights, shadows: grade.shadows,
        whites: grade.whites, blacks: grade.blacks,
        liftColor: grade.liftColor, liftAmount: grade.liftAmount,
        gammaColor: grade.gammaColor, gammaAmount: grade.gammaAmount,
        gainColor: grade.gainColor, gainAmount: grade.gainAmount,
        vignette: grade.vignette, grain: grade.grain,
        chromatic: grade.chromatic, glow: grade.glow,
        removeEnabled: grade.removeEnabled,
        removeColor: grade.removeColor,
        removeTolerance: grade.removeTolerance,
    }), [grade])

    // Refs that the renderer-creation effect reads, so it always picks up the
    // latest LUT / filter without listing them as deps (we don't want to
    // recreate the renderer every time a slider moves).
    const filterStateRef = useRef({ lut: null as Lut3D | null, filter: currentExtraFilter })
    useEffect(() => {
        filterStateRef.current = {
            lut: activeParsedLut || parsedGlobalLut || null,
            filter: currentExtraFilter,
        }
    }, [activeParsedLut, parsedGlobalLut, currentExtraFilter])

    useEffect(() => {
        if (!useGLPreview || !videoRef.current || !glCanvasRef.current) return
        const r = createCanvas2DLutRenderer(glCanvasRef.current, videoRef.current)
        lutRendererRef.current = r
        // Apply whatever's currently in state before the renderer's first frame.
        r.setLut(filterStateRef.current.lut)
        r.setExtraFilter(filterStateRef.current.filter)
        r.start()
        videoRef.current.play().catch(() => { /* silent */ })
        return () => { r.stop(); lutRendererRef.current = null }
    }, [useGLPreview, file])

    // Live updates to the renderer when grade or LUT change without a remount.
    useEffect(() => {
        if (!lutRendererRef.current) return
        lutRendererRef.current.setLut(activeParsedLut || parsedGlobalLut || null)
        lutRendererRef.current.setExtraFilter(currentExtraFilter)
    }, [currentExtraFilter, activeParsedLut, parsedGlobalLut])

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

    const handlePick = async (incoming: FileList | File[] | null) => {
        if (!incoming) return
        const arr = Array.from(incoming).filter((f) => detectKind(f) !== null)
        if (arr.length === 0) {
            setErr('Aucun fichier image/vidéo détecté.')
            return
        }
        setErr(null)
        // Delegate to the shared queue — items appear in Simple / Pro too.
        await onFilesAdded(arr)
    }

    const onDrop = (e: React.DragEvent) => {
        e.preventDefault()
        if (busy) return
        void handlePick(e.dataTransfer.files)
    }
    const onDragOver = (e: React.DragEvent) => e.preventDefault()

    const updateGrade = useCallback((patch: Partial<Grade>) => {
        const item = labItems[activeIndex]
        if (!item) return
        setGradesMap((prev) => ({
            ...prev,
            [item.id]: { ...(prev[item.id] || DEFAULT_GRADE), ...patch },
        }))
    }, [activeIndex, labItems])

    const removeFile = (idx: number) => {
        const item = labItems[idx]
        if (!item) return
        onRemove(item.id)
        setBatch((prev) => {
            const next = { ...prev }; delete next[item.id]; return next
        })
        setGradesMap((prev) => {
            const next = { ...prev }; delete next[item.id]; return next
        })
        setActiveIndex((curr) => {
            if (curr > idx) return curr - 1
            if (curr >= labItems.length - 1) return Math.max(0, labItems.length - 2)
            return curr
        })
    }

    const cssFilter = useMemo(() => gradeToCssFilter(grade), [grade])

    const apply = useCallback(async () => {
        if (labItems.length === 0 || !outputFormat) return
        setBusy(true); setErr(null)
        try {
            const initial: Record<string, BatchItem> = {}
            for (const it of labItems) initial[it.id] = { state: 'idle', progress: '' }
            setBatch(initial)

            for (let i = 0; i < labItems.length; i++) {
                const item = labItems[i]
                const f = item.file
                const fKind = detectKind(f)
                if (!fKind) {
                    setBatch((b) => ({ ...b, [item.id]: { state: 'error', progress: '', error: 'type non supporté' } }))
                    continue
                }
                const fGrade = gradesMap[item.id] || DEFAULT_GRADE
                const fLut = lutScope === 'global' ? globalLutFile : fGrade.lutFile
                const fmt = fKind === 'video'
                    ? (VIDEO_OUTPUTS.includes(outputFormat as typeof VIDEO_OUTPUTS[number]) ? outputFormat : 'mp4')
                    : (IMAGE_OUTPUTS.includes(outputFormat as typeof IMAGE_OUTPUTS[number]) ? outputFormat : 'png')

                setBatch((b) => ({ ...b, [item.id]: { state: 'busy', progress: 'En cours…' } }))

                // eslint-disable-next-line no-console
                console.info('[ColorLab.apply]', {
                    file: f.name, kind: fKind, fmt, processingMode,
                    path: processingMode === 'frontend'
                        ? (fKind === 'image' && isClientSupportedFormat(fmt) ? 'frontend-image' : fKind === 'video' ? 'frontend-video' : 'backend')
                        : 'backend',
                })

                try {
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
                        setBatch((b) => ({ ...b, [item.id]: { state: 'done', progress: 'Prêt', downloadUrl: url, filename } }))
                        continue
                    }

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
                                trimStart: fGrade.trimStart, trimEnd: fGrade.trimEnd,
                                overlayText: fGrade.overlayText,
                                overlayTextX: fGrade.overlayTextX,
                                overlayTextY: fGrade.overlayTextY,
                            }
                            const { blob, filename } = await processVideoClientSide(
                                f, fmt, vg,
                                (msg, ratio) => {
                                    setBatch((b) => ({
                                        ...b,
                                        [item.id]: { state: 'busy', progress: ratio != null ? `${Math.round(ratio * 100)} %` : msg },
                                    }))
                                },
                                fLut,
                            )
                            const url = URL.createObjectURL(blob)
                            setBatch((b) => ({ ...b, [item.id]: { state: 'done', progress: 'Prêt', downloadUrl: url, filename } }))
                            continue
                        }
                    }

                    // Backend path (default in Backend mode, or fallback)
                    const { downloadUrl, filename } = await uploadAndConvert(f, fmt, fGrade, fKind, fLut)
                    setBatch((b) => ({ ...b, [item.id]: { state: 'done', progress: 'Prêt', downloadUrl, filename } }))
                } catch (e) {
                    setBatch((b) => ({
                        ...b,
                        [item.id]: { state: 'error', progress: '', error: e instanceof Error ? e.message : 'Erreur' },
                    }))
                }
            }
            setBusyMessage('Terminé ✓')
        } catch (e) {
            setErr(e instanceof Error ? e.message : 'Erreur inconnue')
        } finally {
            setBusy(false)
        }
    }, [labItems, gradesMap, outputFormat, lutScope, globalLutFile, processingMode])

    const reset = () => {
        onClearAll()
        setGradesMap({})
        setActiveIndex(0)
        setGlobalLutFile(null); setParsedGlobalLut(null)
        setBatch({}); setErr(null); setBusyMessage('')
        setOriginalFps({})
    }

    const outputs = kind === 'video' ? VIDEO_OUTPUTS : kind === 'image' ? IMAGE_OUTPUTS : []
    const detectedOriginalFps = originalFps[activeIndex] || 60

    return (
        <div className="mx-auto w-full max-w-[1500px] px-4 lg:px-6 py-4 pb-12">
            {/* ─── Header ─── */}
            <div className="mb-4 flex items-center justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="inline-flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
                        <IconWand size={20} className="text-primary" />
                        Color Lab
                    </h1>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                        Étalonnage multi-fichiers, LUT live, montage léger.
                    </p>
                </div>
                <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-2.5 py-0.5 text-[10px]">
                    <span className={`h-1.5 w-1.5 rounded-full ${processingMode === 'frontend' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                    <span className="text-muted-foreground">Mode :</span>
                    <span className="font-semibold text-foreground">
                        {processingMode === 'frontend' ? 'Frontend (navigateur)' : 'Backend (serveur)'}
                    </span>
                </div>
            </div>

            {/* ─── Empty drop zone ─── */}
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
                        Étalonnage par fichier, LUT live, export en lot.
                    </p>
                    <input
                        ref={fileInputRef} type="file" multiple accept="image/*,video/*"
                        className="hidden"
                        onChange={(e) => handlePick(e.target.files)}
                    />
                </div>
            )}

            {file && previewUrl && (
                <div className="grid gap-4 lg:grid-cols-[400px_minmax(0,1fr)] items-start">
                    {/* ───── LEFT: Controls panel (sticky) ───── */}
                    <aside className="space-y-3 lg:sticky lg:top-[68px] lg:max-h-[calc(100vh-84px)] overflow-y-auto pr-1">
                        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm space-y-3">
                            <div className="flex items-center justify-between">
                                <h2 className="text-sm font-semibold">Réglages</h2>
                                <button
                                    type="button"
                                    onClick={() => updateGrade(DEFAULT_GRADE)}
                                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                                >
                                    <IconRefresh size={11} /> Reset
                                </button>
                            </div>

                            <CollapsibleSection title="Lumière" defaultOpen>
                                <Slider label="Exposition" value={grade.exposure} min={-2} max={2} step={0.1} onChange={(v) => updateGrade({ exposure: v })} suffix=" EV" />
                                <Slider label="Contraste" value={grade.contrast} min={-100} max={100} step={1} onChange={(v) => updateGrade({ contrast: v })} />
                                <Slider label="Hautes lumières" value={grade.highlights} min={-100} max={100} step={1} onChange={(v) => updateGrade({ highlights: v })} />
                                <Slider label="Ombres" value={grade.shadows} min={-100} max={100} step={1} onChange={(v) => updateGrade({ shadows: v })} />
                                <Slider label="Blancs" value={grade.whites} min={-100} max={100} step={1} onChange={(v) => updateGrade({ whites: v })} />
                                <Slider label="Noirs" value={grade.blacks} min={-100} max={100} step={1} onChange={(v) => updateGrade({ blacks: v })} />
                            </CollapsibleSection>

                            <CollapsibleSection title="Couleur" defaultOpen>
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
                                    <ColorSwatch label="Gain (highlights)" color={grade.gainColor} amount={grade.gainAmount}
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
                                            type="range" min={1} max={detectedOriginalFps} step={1}
                                            value={grade.targetFps ?? detectedOriginalFps}
                                            onChange={(e) => {
                                                const v = parseInt(e.target.value, 10)
                                                updateGrade({ targetFps: v >= detectedOriginalFps ? null : v })
                                            }}
                                            className="h-1.5 w-full accent-primary"
                                        />
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

                            <CollapsibleSection title="LUT (.cube) scope" defaultOpen={false}>
                                <div className="flex items-center gap-1 rounded-md border border-border bg-background/60 p-0.5">
                                    <button type="button"
                                        onClick={() => setLutScope('global')}
                                        className={cn(
                                            'flex-1 rounded px-2 py-1 text-[10px] font-semibold transition-colors',
                                            lutScope === 'global' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground',
                                        )}
                                    >
                                        Global
                                    </button>
                                    <button type="button"
                                        onClick={() => setLutScope('per-file')}
                                        className={cn(
                                            'flex-1 rounded px-2 py-1 text-[10px] font-semibold transition-colors',
                                            lutScope === 'per-file' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground',
                                        )}
                                    >
                                        Par fichier
                                    </button>
                                </div>
                                <p className="text-[10px] italic text-muted-foreground">
                                    Le LUT se charge via le bouton en haut à gauche de la vidéo.
                                </p>
                            </CollapsibleSection>

                            {isVideo && (
                                <CollapsibleSection title="Avancé : montage" defaultOpen={false}>
                                    <div className="space-y-2">
                                        <p className="text-[11px] font-semibold text-muted-foreground">Trim</p>
                                        <div className="grid grid-cols-2 gap-2">
                                            <div>
                                                <label className="text-[10px] text-muted-foreground">Début</label>
                                                <input type="text"
                                                    value={grade.trimStart}
                                                    onChange={(e) => updateGrade({ trimStart: e.target.value })}
                                                    placeholder="00:00:05"
                                                    className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] text-muted-foreground">Fin</label>
                                                <input type="text"
                                                    value={grade.trimEnd}
                                                    onChange={(e) => updateGrade({ trimEnd: e.target.value })}
                                                    placeholder="00:01:30"
                                                    className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    <div className="space-y-2 pt-2 border-t border-border">
                                        <p className="text-[11px] font-semibold text-muted-foreground">Texte incrusté</p>
                                        <input type="text"
                                            value={grade.overlayText}
                                            onChange={(e) => updateGrade({ overlayText: e.target.value })}
                                            placeholder="Texte à afficher…"
                                            className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                                        />
                                        {grade.overlayText && (
                                            <div className="grid grid-cols-2 gap-2">
                                                <input type="text"
                                                    value={grade.overlayTextX}
                                                    onChange={(e) => updateGrade({ overlayTextX: e.target.value })}
                                                    placeholder="X"
                                                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                                                />
                                                <input type="text"
                                                    value={grade.overlayTextY}
                                                    onChange={(e) => updateGrade({ overlayTextY: e.target.value })}
                                                    placeholder="Y"
                                                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                                                />
                                            </div>
                                        )}
                                    </div>
                                </CollapsibleSection>
                            )}
                        </div>
                    </aside>

                    {/* ───── RIGHT: Preview + controls + queue ───── */}
                    <div className="space-y-3 min-w-0">
                        {/* Preview — big */}
                        <div
                            className="relative overflow-hidden rounded-2xl border border-border bg-black/60 shadow-sm w-full"
                            style={{ aspectRatio: isVideo ? '16 / 9' : undefined, maxHeight: isVideo ? undefined : '78vh' }}
                        >
                            {kind === 'image' ? (
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <img
                                        src={previewUrl} alt="Aperçu"
                                        className="max-h-[78vh] max-w-full object-contain"
                                        style={{ filter: cssFilter }}
                                    />
                                </div>
                            ) : (
                                <div className="absolute inset-0">
                                    <video
                                        ref={videoRef}
                                        src={previewUrl}
                                        controls loop playsInline muted
                                        onError={() => {
                                            setVideoReady(false)
                                            setVideoError("Format vidéo non décodable par le navigateur. Le rendu en backend fonctionnera quand même.")
                                        }}
                                        onLoadedData={(e) => {
                                            const v = e.currentTarget
                                            if (v.videoWidth > 0) setVideoReady(true)
                                        }}
                                        className={cn(
                                            "absolute inset-0 h-full w-full object-contain transition-opacity",
                                            useGLPreview ? "opacity-0 pointer-events-none" : "opacity-100",
                                        )}
                                        style={!useGLPreview ? { filter: cssFilter } : undefined}
                                    />
                                    {useGLPreview && (
                                        <>
                                            <canvas
                                                ref={glCanvasRef}
                                                className="absolute inset-0 h-full w-full object-contain"
                                            />
                                            <VideoControls videoRef={videoRef} />
                                        </>
                                    )}
                                    {videoError && (
                                        <div className="absolute inset-0 flex items-center justify-center p-6 pointer-events-none">
                                            <div className="max-w-md rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-center text-xs text-amber-300">
                                                {videoError}
                                            </div>
                                        </div>
                                    )}
                                    {activeLutForRender && (
                                        <div className="absolute top-2 right-2 rounded-md bg-emerald-500/15 px-2 py-1 text-[10px] font-semibold text-emerald-400 pointer-events-none">
                                            LUT {useGLPreview ? 'live ✓' : 'actif'}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* LUT picker overlay — top-left */}
                            {isVideo && (
                                <div className="absolute top-2 left-2 z-10 flex items-center gap-1">
                                    {activeLutForRender ? (
                                        <div className="flex items-center gap-1 rounded-md bg-black/70 px-2 py-1 backdrop-blur-sm">
                                            <span className="text-[10px] font-medium text-white max-w-[140px] truncate">{activeLutForRender.name}</span>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (lutScope === 'global') setGlobalLutFile(null)
                                                    else updateGrade({ lutFile: null })
                                                }}
                                                className="text-white/70 hover:text-destructive"
                                                aria-label="Retirer le LUT"
                                            >
                                                <IconX size={11} />
                                            </button>
                                        </div>
                                    ) : (
                                        <label className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-black/70 px-2 py-1 text-[10px] font-semibold text-white backdrop-blur-sm hover:bg-black/85">
                                            <IconWand size={11} />
                                            Charger LUT (.cube)
                                            <input
                                                type="file" accept=".cube" className="hidden"
                                                onChange={(e) => {
                                                    const f = e.target.files?.[0]
                                                    if (f) {
                                                        if (lutScope === 'global') setGlobalLutFile(f)
                                                        else updateGrade({ lutFile: f })
                                                    }
                                                    e.target.value = ''
                                                }}
                                            />
                                        </label>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Carousel + Lancer */}
                        <div className="flex items-center justify-center gap-3 flex-wrap">
                            <button
                                type="button"
                                onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
                                disabled={activeIndex === 0}
                                className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-card text-foreground transition-colors hover:bg-muted disabled:opacity-30"
                                aria-label="Fichier précédent"
                            >
                                ←
                            </button>

                            <Button
                                type="button"
                                onClick={apply}
                                disabled={busy || !outputFormat || labItems.length === 0}
                                className="h-11 text-sm font-semibold gap-2 rounded-xl px-6 min-w-[240px]"
                            >
                                {busy ? (
                                    <>
                                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground" />
                                        {busyMessage || 'Traitement…'}
                                    </>
                                ) : (
                                    <>
                                        <IconWand size={15} />
                                        {labItems.length > 1 ? `Lancer le traitement (${labItems.length})` : 'Lancer le traitement'}
                                    </>
                                )}
                            </Button>

                            <button
                                type="button"
                                onClick={() => setActiveIndex((i) => Math.min(labItems.length - 1, i + 1))}
                                disabled={activeIndex >= labItems.length - 1}
                                className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-card text-foreground transition-colors hover:bg-muted disabled:opacity-30"
                                aria-label="Fichier suivant"
                            >
                                →
                            </button>
                        </div>

                        <div className="flex items-center justify-between text-[11px] text-muted-foreground px-1">
                            <span>
                                Fichier <span className="font-semibold text-foreground">{activeIndex + 1}</span> / {labItems.length}
                            </span>
                            <button type="button" onClick={reset} className="hover:text-destructive">
                                <IconX size={11} className="inline-block mr-1" />Tout effacer
                            </button>
                        </div>

                        {/* Format de sortie */}
                        <div className="rounded-xl border border-border bg-card p-3">
                            <div className="flex items-center gap-3 flex-wrap">
                                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Format de sortie</span>
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
                        </div>

                        {err && (
                            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                                {err}
                            </div>
                        )}

                        {/* File queue — horizontal carousel below the preview */}
                        <div className="rounded-xl border border-border bg-card p-3">
                            <div className="mb-2 flex items-center justify-between">
                                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    File d'attente ({labItems.length})
                                </h3>
                                <button
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    className="text-[11px] font-medium text-primary hover:underline"
                                >
                                    + Ajouter
                                </button>
                            </div>
                            <div className="flex gap-2 overflow-x-auto pb-1">
                                {labItems.map((labItem, i) => {
                                    const f = labItem.file
                                    const isCurrent = i === activeIndex
                                    const itemBatch = batch[labItem.id]
                                    const itemKind = detectKind(f)
                                    return (
                                        <button
                                            key={`${f.name}-${i}`}
                                            type="button"
                                            onClick={() => setActiveIndex(i)}
                                            className={cn(
                                                'shrink-0 w-32 rounded-lg border overflow-hidden text-left transition-all',
                                                isCurrent
                                                    ? 'border-primary shadow-md ring-2 ring-primary/20'
                                                    : 'border-border hover:border-muted-foreground',
                                            )}
                                        >
                                            <div className="flex h-16 w-full items-center justify-center bg-black/70 text-muted-foreground">
                                                {itemKind === 'video' ? <IconVideo size={20} /> : <IconImage size={20} />}
                                            </div>
                                            <div className="px-2 py-1.5 bg-card">
                                                <p className="truncate text-[11px] font-medium text-foreground">{f.name}</p>
                                                <p className="text-[10px] text-muted-foreground">{formatSize(f.size)}</p>
                                                {itemBatch?.state === 'done' && itemBatch.downloadUrl && (
                                                    <a
                                                        href={itemBatch.downloadUrl} download={itemBatch.filename}
                                                        onClick={(e) => e.stopPropagation()}
                                                        className="mt-1 inline-flex h-5 items-center gap-0.5 rounded bg-emerald-500/15 px-1 text-[10px] font-semibold text-emerald-600 hover:bg-emerald-500/25 dark:text-emerald-400"
                                                    >
                                                        <IconDownload size={10} /> DL
                                                    </a>
                                                )}
                                                {itemBatch?.state === 'busy' && (
                                                    <span className="mt-1 inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                                                )}
                                                {itemBatch?.state === 'error' && (
                                                    <p className="mt-0.5 text-[9px] text-destructive truncate">{itemBatch.error}</p>
                                                )}
                                            </div>
                                        </button>
                                    )
                                })}
                            </div>
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
