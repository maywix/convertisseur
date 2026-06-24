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
import { cn } from '@/lib/utils'
import { formatSize, getFileType } from '@/types'

// ──────────────────────────────────────────────────────────
// Color Lab — Lightroom-style colour grading with live preview.
// Image: full slider set (all photo_* params).
// Video: subset supported by FFmpeg filters (curves + colortemperature + hue + unsharp + eq).
// ──────────────────────────────────────────────────────────

type MediaKind = 'image' | 'video'

interface Grade {
    // Light
    exposure: number      // -2..+2 EV
    contrast: number      // -100..+100
    highlights: number    // -100..+100
    shadows: number       // -100..+100
    whites: number        // -100..+100
    blacks: number        // -100..+100
    // Color
    saturation: number    // -100..+100
    temperature: number   // -100..+100 cool/warm
    tint: number          // -100..+100 green/magenta
    hue: number           // -180..+180°
    // Detail
    sharpness: number     // -100..+100
}

const DEFAULT_GRADE: Grade = {
    exposure: 0, contrast: 0,
    highlights: 0, shadows: 0, whites: 0, blacks: 0,
    saturation: 0, temperature: 0, tint: 0, hue: 0,
    sharpness: 0,
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

// Build CSS filter string approximating the grade. Highlights/shadows/whites/blacks
// can't be done in pure CSS — we mix them into contrast/brightness for a hint.
function gradeToCssFilter(g: Grade): string {
    const exposureBoost = g.exposure * 0.25
    const whitesBoost = g.whites * 0.0020
    const blacksBoost = g.blacks * -0.0015
    const brightness = clamp(1 + exposureBoost + whitesBoost + blacksBoost, 0.1, 2.5)

    const highlightsContrast = g.highlights * -0.0020   // lifting highlights ~= less contrast
    const shadowsContrast = g.shadows * -0.0020
    const contrast = clamp(1 + g.contrast / 100 + highlightsContrast + shadowsContrast, 0, 2)

    const saturate = clamp(1 + g.saturation / 100, 0, 3)
    const hueDeg = clamp(g.hue + g.tint * 0.45, -180, 180)

    return `brightness(${brightness.toFixed(3)}) contrast(${contrast.toFixed(3)}) saturate(${saturate.toFixed(3)}) hue-rotate(${hueDeg}deg)`
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

function Slider({
    label,
    value,
    min,
    max,
    step,
    onChange,
    suffix,
    disabled,
}: {
    label: string
    value: number
    min: number
    max: number
    step: number
    onChange: (v: number) => void
    suffix?: string
    disabled?: boolean
}) {
    const display = `${value > 0 ? '+' : ''}${value.toFixed(step < 1 ? 1 : 0)}${suffix ?? ''}`
    return (
        <div className={cn('space-y-1.5', disabled && 'opacity-40 pointer-events-none')}>
            <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-foreground">{label}</span>
                <span className="text-[11px] font-mono text-muted-foreground tabular-nums">{display}</span>
            </div>
            <input
                type="range"
                min={min} max={max} step={step}
                value={value}
                onChange={(e) => onChange(parseFloat(e.target.value))}
                disabled={disabled}
                className="h-1.5 w-full accent-primary"
            />
        </div>
    )
}

function CollapsibleSection({
    title,
    defaultOpen = true,
    children,
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
    onProgress?: (state: string) => void,
): Promise<{ downloadUrl: string; filename: string }> {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('action', 'convert')
    fd.append('format', targetFormat)

    // Map slider keys to backend param names depending on media type.
    const map: Record<keyof Grade, string> = kind === 'video'
        ? {
            exposure: 'video_exposure', contrast: 'video_contrast',
            highlights: 'video_highlights', shadows: 'video_shadows',
            whites: 'video_whites', blacks: 'video_blacks',
            saturation: 'video_saturation', temperature: 'video_temperature',
            tint: 'video_tint', hue: 'video_hue',
            sharpness: 'video_sharpness',
        }
        : {
            exposure: 'photo_exposure', contrast: 'photo_contrast',
            highlights: 'photo_highlights', shadows: 'photo_shadows',
            whites: 'photo_whites', blacks: 'photo_blacks',
            saturation: 'photo_saturation', temperature: 'photo_temperature',
            tint: 'photo_tint', hue: '',  // no photo_hue, skip
            sharpness: 'photo_sharpness',
        }

    for (const k of Object.keys(grade) as (keyof Grade)[]) {
        const v = grade[k]
        const param = map[k]
        if (param && v !== 0) fd.append(param, String(v))
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

export function ColorLab() {
    const [file, setFile] = useState<File | null>(null)
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)
    const [grade, setGrade] = useState<Grade>(DEFAULT_GRADE)
    const [busy, setBusy] = useState(false)
    const [busyMessage, setBusyMessage] = useState('')
    const [err, setErr] = useState<string | null>(null)
    const [resultUrl, setResultUrl] = useState<string | null>(null)
    const [resultName, setResultName] = useState<string | null>(null)
    const [outputFormat, setOutputFormat] = useState<string>('')
    const fileInputRef = useRef<HTMLInputElement>(null)

    const kind: MediaKind | null = file ? detectKind(file) : null

    useEffect(() => {
        if (!file) { setPreviewUrl(null); return }
        const url = URL.createObjectURL(file)
        setPreviewUrl(url)
        return () => URL.revokeObjectURL(url)
    }, [file])

    useEffect(() => {
        if (!file) return
        if (kind === 'image') setOutputFormat('png')
        else if (kind === 'video') setOutputFormat('mp4')
    }, [file, kind])

    const handlePick = (incoming: FileList | File[] | null) => {
        if (!incoming) return
        const arr = Array.from(incoming)
        if (arr.length === 0) return
        const f = arr[0]
        if (!detectKind(f)) {
            setErr('Type de fichier non supporté ici. Utilisez une image ou une vidéo.')
            return
        }
        setErr(null); setResultUrl(null); setResultName(null)
        setFile(f); setGrade(DEFAULT_GRADE)
    }

    const onDrop = (e: React.DragEvent) => {
        e.preventDefault()
        if (busy) return
        handlePick(e.dataTransfer.files)
    }
    const onDragOver = (e: React.DragEvent) => e.preventDefault()

    const cssFilter = useMemo(() => gradeToCssFilter(grade), [grade])
    const overlay = useMemo(() => temperatureToOverlay(grade.temperature), [grade.temperature])

    const updateGrade = useCallback((patch: Partial<Grade>) => {
        setGrade((g) => ({ ...g, ...patch }))
    }, [])

    const apply = useCallback(async () => {
        if (!file || !kind || !outputFormat) return
        setBusy(true); setErr(null); setResultUrl(null); setResultName(null)
        try {
            const { downloadUrl, filename } = await uploadAndConvert(file, outputFormat, grade, kind, setBusyMessage)
            setResultUrl(downloadUrl); setResultName(filename)
            setBusyMessage('Prêt à télécharger ✓')
        } catch (e) {
            setErr(e instanceof Error ? e.message : 'Erreur inconnue')
        } finally {
            setBusy(false)
        }
    }, [file, kind, outputFormat, grade])

    const reset = () => {
        setFile(null); setGrade(DEFAULT_GRADE)
        setErr(null); setResultUrl(null); setResultName(null); setBusyMessage('')
    }

    const outputs = kind === 'video' ? VIDEO_OUTPUTS : kind === 'image' ? IMAGE_OUTPUTS : []
    const isVideo = kind === 'video'

    return (
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-10">
            <div className="mb-6 text-center">
                <h1 className="inline-flex items-center gap-2 text-3xl font-semibold tracking-tight sm:text-4xl">
                    <IconWand size={24} className="text-primary" />
                    Color Lab
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    Étalonnage couleur image et vidéo avec aperçu temps réel. Tous les réglages style Lightroom.
                </p>
            </div>

            {!file && (
                <div
                    onDrop={onDrop} onDragOver={onDragOver}
                    onClick={() => fileInputRef.current?.click()}
                    className="mx-auto flex max-w-3xl cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border bg-card/40 px-6 py-16 text-center transition-colors hover:border-primary/40 hover:bg-card"
                >
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                        <IconImage size={26} />
                    </div>
                    <p className="mt-4 text-sm font-medium text-foreground">Déposez une image ou une vidéo</p>
                    <p className="mt-1 text-xs text-muted-foreground">JPG, PNG, WebP, HEIC, MP4, MOV, WebM…</p>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*,video/*"
                        className="hidden"
                        onChange={(e) => handlePick(e.target.files)}
                    />
                </div>
            )}

            {file && previewUrl && (
                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
                    {/* ── Preview ── */}
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
                                <div
                                    className="pointer-events-none absolute inset-0 transition-opacity"
                                    style={{ backgroundColor: overlay.rgba, mixBlendMode: overlay.mixBlend }}
                                />
                            </div>
                        </div>
                        <div className="flex items-center justify-between gap-3 text-xs">
                            <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
                                {isVideo ? <IconVideo size={13} /> : <IconImage size={13} />}
                                <span className="truncate font-medium text-foreground">{file.name}</span>
                                <span className="shrink-0">· {formatSize(file.size)}</span>
                            </div>
                            <button
                                type="button"
                                onClick={reset}
                                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-muted-foreground hover:text-destructive"
                            >
                                <IconX size={12} />
                                Changer
                            </button>
                        </div>
                    </div>

                    {/* ── Sliders panel ── */}
                    <div className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-sm self-start lg:sticky lg:top-[80px] max-h-[calc(100vh-7rem)] overflow-y-auto">
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
                            <Slider label="Contraste" value={grade.contrast} min={-100} max={100} step={1} onChange={(v) => updateGrade({ contrast: v })} suffix="" />
                            <Slider label="Hautes lumières" value={grade.highlights} min={-100} max={100} step={1} onChange={(v) => updateGrade({ highlights: v })} suffix="" />
                            <Slider label="Ombres" value={grade.shadows} min={-100} max={100} step={1} onChange={(v) => updateGrade({ shadows: v })} suffix="" />
                            <Slider label="Blancs" value={grade.whites} min={-100} max={100} step={1} onChange={(v) => updateGrade({ whites: v })} suffix="" />
                            <Slider label="Noirs" value={grade.blacks} min={-100} max={100} step={1} onChange={(v) => updateGrade({ blacks: v })} suffix="" />
                        </CollapsibleSection>

                        <CollapsibleSection title="Couleur">
                            <Slider label="Saturation" value={grade.saturation} min={-100} max={100} step={1} onChange={(v) => updateGrade({ saturation: v })} suffix="" />
                            <Slider label="Température" value={grade.temperature} min={-100} max={100} step={1} onChange={(v) => updateGrade({ temperature: v })} suffix="" />
                            <Slider label="Teinte" value={grade.tint} min={-100} max={100} step={1} onChange={(v) => updateGrade({ tint: v })} suffix="" />
                            <Slider label="Hue (°)" value={grade.hue} min={-180} max={180} step={1} onChange={(v) => updateGrade({ hue: v })} suffix="°" disabled={kind === 'image'} />
                            {kind === 'image' && (
                                <p className="text-[10px] italic text-muted-foreground">Hue n'est disponible que pour la vidéo.</p>
                            )}
                        </CollapsibleSection>

                        <CollapsibleSection title="Détail">
                            <Slider label="Netteté" value={grade.sharpness} min={-100} max={100} step={1} onChange={(v) => updateGrade({ sharpness: v })} suffix="" />
                        </CollapsibleSection>

                        <div className="space-y-2 border-t border-border pt-3">
                            <label className="text-xs font-medium text-muted-foreground">Format de sortie</label>
                            <div className="flex flex-wrap gap-1.5">
                                {outputs.map((fmt) => (
                                    <button
                                        key={fmt}
                                        type="button"
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

                        {!resultUrl ? (
                            <Button
                                type="button"
                                onClick={apply}
                                disabled={busy || !outputFormat}
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
                                        Appliquer & télécharger
                                    </>
                                )}
                            </Button>
                        ) : (
                            <a
                                href={resultUrl}
                                download={resultName || undefined}
                                className="inline-flex w-full h-11 items-center justify-center gap-2 rounded-xl bg-emerald-500/15 px-4 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/25 dark:text-emerald-400"
                            >
                                <IconDownload size={15} />
                                Télécharger {resultName || 'le résultat'}
                            </a>
                        )}

                        <p className="text-[11px] leading-4 text-muted-foreground">
                            Aperçu en CSS (rapide, approximatif). Le rendu final est précis (FFmpeg pour vidéo, Pillow pour image).
                        </p>
                    </div>
                </div>
            )}
        </div>
    )
}
