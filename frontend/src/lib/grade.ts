// ──────────────────────────────────────────────────────────
// Colour grade model (Color Lab) and its translations: canvas preview
// filter, and form fields for the server (FFmpeg / Pillow).
// ──────────────────────────────────────────────────────────
import { gradeToExtraFilter, type ExtraFilter } from './lutCanvas2D'

export const NEUTRAL = '#808080'

export interface Grade {
    // Light
    exposure: number
    contrast: number
    highlights: number
    shadows: number
    whites: number
    blacks: number
    // Colour
    saturation: number
    temperature: number
    tint: number
    hue: number
    // Colour wheels (lift / gamma / gain)
    liftColor: string
    liftAmount: number
    gammaColor: string
    gammaAmount: number
    gainColor: string
    gainAmount: number
    // Detail + effects
    sharpness: number
    vignette: number
    glow: number
    grain: number
    chromatic: number
    // Colour remover (chroma key)
    removeEnabled: boolean
    removeColor: string
    removeTolerance: number
    // Video output
    targetFps: number | null
    trimStart: string
    trimEnd: string
    overlayText: string
    /** Per-file LUT, used when the LUT scope is "per file". */
    lutFile: File | null
}

export const DEFAULT_GRADE: Grade = {
    exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
    saturation: 0, temperature: 0, tint: 0, hue: 0,
    liftColor: NEUTRAL, liftAmount: 1,
    gammaColor: NEUTRAL, gammaAmount: 1,
    gainColor: NEUTRAL, gainAmount: 1,
    sharpness: 0, vignette: 0, glow: 0, grain: 0, chromatic: 0,
    removeEnabled: false, removeColor: '#00ff00', removeTolerance: 20,
    targetFps: null, trimStart: '', trimEnd: '', overlayText: '',
    lutFile: null,
}

/** The look-related part of a grade (what "copy to all files" copies). */
const NON_LOOK_KEYS = new Set<keyof Grade>(['targetFps', 'trimStart', 'trimEnd', 'overlayText', 'lutFile'])

export function lookOf(g: Grade): Partial<Grade> {
    return Object.fromEntries(
        Object.entries(g).filter(([k]) => !NON_LOOK_KEYS.has(k as keyof Grade)),
    ) as Partial<Grade>
}

export function gradeToFilter(g: Grade): ExtraFilter {
    return gradeToExtraFilter(g)
}

export function isNeutral(g: Grade): boolean {
    const d = DEFAULT_GRADE
    return (Object.keys(lookOf(d)) as (keyof Grade)[]).every((k) => {
        const a = g[k]
        const b = d[k]
        return typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : a === b
    })
}

/** Form fields understood by the backend for a graded export. */
export function gradeToServerFields(g: Grade, kind: 'video' | 'image'): Record<string, string> {
    const fields: Record<string, string> = {}
    const put = (key: string, value: number | string) => { fields[key] = String(value) }
    const sliders: [keyof Grade, string][] = [
        ['exposure', 'exposure'], ['contrast', 'contrast'], ['highlights', 'highlights'],
        ['shadows', 'shadows'], ['whites', 'whites'], ['blacks', 'blacks'],
        ['saturation', 'saturation'], ['temperature', 'temperature'], ['tint', 'tint'],
        ['sharpness', 'sharpness'],
    ]
    const prefix = kind === 'video' ? 'video_' : 'photo_'
    for (const [key, name] of sliders) {
        const v = g[key] as number
        if (v) put(prefix + name, v)
    }
    if (kind === 'video') {
        if (g.hue) put('video_hue', g.hue)
        for (const zone of ['lift', 'gamma', 'gain'] as const) {
            const color = g[`${zone}Color`]
            if (color.toLowerCase() !== NEUTRAL) {
                put(`video_${zone}_color`, color)
                put(`video_${zone}_amount`, g[`${zone}Amount`])
            }
        }
        if (g.vignette) put('video_vignette', g.vignette)
        if (g.glow) put('video_glow', g.glow)
        if (g.grain) put('video_grain', g.grain)
        if (g.chromatic) put('video_chromatic', g.chromatic)
        if (g.targetFps) put('fps', g.targetFps)
        if (g.trimStart.trim()) put('trim_start', g.trimStart.trim())
        if (g.trimEnd.trim()) put('trim_end', g.trimEnd.trim())
        if (g.overlayText.trim()) put('overlay_text', g.overlayText.trim())
    }
    if (g.removeEnabled) {
        put('color_remove_color', g.removeColor)
        put('color_remove_tolerance', g.removeTolerance)
    }
    return fields
}
