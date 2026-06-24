// ──────────────────────────────────────────────────────────
// Canvas 2D LUT preview — robust fallback to the WebGL path.
// Pulls frames from a <video>, applies the LUT and the full grade pipeline
// in JS pixel space, paints to a <canvas>. Works on any codec the browser
// can decode.
//
// The post-process pipeline below mirrors the backend (Pillow + FFmpeg) as
// closely as a single-pass JS loop allows:
//   1. LUT 3D lookup (if any)
//   2. Color remover (early alpha=0 on matching pixels)
//   3. Temperature / tint (per-channel multiply)
//   4. Exposure (2^EV scale)
//   5. Highlights / shadows / whites / blacks (luma-mask blend)
//   6. Color wheels Lift / Gamma / Gain (zone-based additive shift)
//   7. Contrast (around 128)
//   8. Saturation (mix toward luma)
//   9. Hue rotation
//  10. Vignette (radial dim)
//  11. Grain (random additive noise)
// Chromatic aberration is a pre-pass (multi-source read).
// Glow is a post-pass canvas composite.
// ──────────────────────────────────────────────────────────
import { applyLutInPlace, type Lut3D } from './cubeLut'

export interface ExtraFilter {
    brightness: number      // -1..1 additive (exposure mapped to ~0.25× EV)
    contrast: number        // 0..2 (1 = neutral)
    saturation: number      // 0..3 (1 = neutral)
    temperature: number     // -1..1 (cool→warm)
    tint: number            // -1..1 (green→magenta)
    hueDeg: number          // -180..180
    // Lightroom tone region sliders (raw -100..+100 values)
    highlights: number
    shadows: number
    whites: number
    blacks: number
    // DaVinci-style color wheels (hex colours, neutral = #808080)
    liftColor: string
    liftAmount: number      // 0..2
    gammaColor: string
    gammaAmount: number
    gainColor: string
    gainAmount: number
    // Effects
    vignette: number        // 0..1
    grain: number           // 0..100
    chromatic: number       // 0..20 px
    glow: number            // 0..100
    // Color remover
    removeEnabled: boolean
    removeColor: string
    removeTolerance: number // 0..100
}

const DEFAULT_FILTER: ExtraFilter = {
    brightness: 0, contrast: 1, saturation: 1,
    temperature: 0, tint: 0,
    hueDeg: 0,
    highlights: 0, shadows: 0, whites: 0, blacks: 0,
    liftColor: '#808080', liftAmount: 1,
    gammaColor: '#808080', gammaAmount: 1,
    gainColor: '#808080', gainAmount: 1,
    vignette: 0, grain: 0, chromatic: 0, glow: 0,
    removeEnabled: false, removeColor: '#ffffff', removeTolerance: 15,
}

export interface Canvas2DLutRenderer {
    setLut(lut: Lut3D | null): void
    setExtraFilter(f: Partial<ExtraFilter>): void
    start(): void
    stop(): void
}

function clamp(v: number, min: number, max: number) {
    return v < min ? min : v > max ? max : v
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
    const c = hex.replace('#', '')
    if (c.length !== 6) return { r: 128, g: 128, b: 128 }
    return {
        r: parseInt(c.slice(0, 2), 16),
        g: parseInt(c.slice(2, 4), 16),
        b: parseInt(c.slice(4, 6), 16),
    }
}

// Chromatic aberration pre-pass: writes shifted R and B channels from src to dst.
function applyChromatic(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, px: number) {
    if (px <= 0) { dst.set(src); return }
    const shift = Math.round(px)
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const di = (y * w + x) * 4
            const srcR = clamp(x - shift, 0, w - 1)
            const srcB = clamp(x + shift, 0, w - 1)
            dst[di]     = src[(y * w + srcR) * 4]
            dst[di + 1] = src[(y * w + x) * 4 + 1]
            dst[di + 2] = src[(y * w + srcB) * 4 + 2]
            dst[di + 3] = src[(y * w + x) * 4 + 3]
        }
    }
}

// Single-pass full pipeline (steps 2-11 from header comment).
function applyPost(data: Uint8ClampedArray, w: number, h: number, f: ExtraFilter) {
    // ── Pre-compute coefficients ──
    const briAdd = f.brightness * 255
    const con = f.contrast
    const sat = f.saturation

    const tempPresent = Math.abs(f.temperature) > 0.001 || Math.abs(f.tint) > 0.001
    const tempR = 1 + f.temperature * 0.22 + f.tint * 0.08
    const tempG = 1 - f.temperature * 0.04 - f.tint * 0.18
    const tempB = 1 - f.temperature * 0.22 + f.tint * 0.08

    const huePresent = Math.abs(f.hueDeg) > 0.5
    let m00 = 1, m01 = 0, m02 = 0, m10 = 0, m11 = 1, m12 = 0, m20 = 0, m21 = 0, m22 = 1
    if (huePresent) {
        const r = (f.hueDeg * Math.PI) / 180
        const cosA = Math.cos(r), sinA = Math.sin(r)
        m00 = 0.213 + cosA * 0.787 - sinA * 0.213
        m01 = 0.715 - cosA * 0.715 - sinA * 0.715
        m02 = 0.072 - cosA * 0.072 + sinA * 0.928
        m10 = 0.213 - cosA * 0.213 + sinA * 0.143
        m11 = 0.715 + cosA * 0.285 + sinA * 0.140
        m12 = 0.072 - cosA * 0.072 - sinA * 0.283
        m20 = 0.213 - cosA * 0.213 - sinA * 0.787
        m21 = 0.715 - cosA * 0.715 + sinA * 0.715
        m22 = 0.072 + cosA * 0.928 + sinA * 0.072
    }

    const hasTone = f.highlights || f.shadows || f.whites || f.blacks
    const hsh = f.highlights / 100
    const ssh = f.shadows / 100
    const wsh = f.whites / 100
    const bsh = f.blacks / 100

    // Lift / Gamma / Gain: only active when colour is not neutral.
    const liftRgb = hexToRgb(f.liftColor)
    const gammaRgb = hexToRgb(f.gammaColor)
    const gainRgb = hexToRgb(f.gainColor)
    const liftDr = (liftRgb.r - 128) / 127 * f.liftAmount
    const liftDg = (liftRgb.g - 128) / 127 * f.liftAmount
    const liftDb = (liftRgb.b - 128) / 127 * f.liftAmount
    const gammaDr = (gammaRgb.r - 128) / 127 * f.gammaAmount
    const gammaDg = (gammaRgb.g - 128) / 127 * f.gammaAmount
    const gammaDb = (gammaRgb.b - 128) / 127 * f.gammaAmount
    const gainDr = (gainRgb.r - 128) / 127 * f.gainAmount
    const gainDg = (gainRgb.g - 128) / 127 * f.gainAmount
    const gainDb = (gainRgb.b - 128) / 127 * f.gainAmount
    const hasLgg = Math.abs(liftDr) + Math.abs(liftDg) + Math.abs(liftDb) +
                   Math.abs(gammaDr) + Math.abs(gammaDg) + Math.abs(gammaDb) +
                   Math.abs(gainDr) + Math.abs(gainDg) + Math.abs(gainDb) > 0.001

    const vignettePresent = f.vignette > 0.001
    let cx = 0, cy = 0, maxDist = 1
    if (vignettePresent) {
        cx = w / 2; cy = h / 2
        maxDist = Math.sqrt(cx * cx + cy * cy)
    }

    const grainPresent = f.grain > 0
    const grainStrength = (f.grain / 100) * 40

    // Color remover prep
    const rmEnabled = f.removeEnabled
    let rmR = 0, rmG = 0, rmB = 0, rmTolSq = 0
    if (rmEnabled) {
        const rgb = hexToRgb(f.removeColor)
        rmR = rgb.r; rmG = rgb.g; rmB = rgb.b
        const tol = (f.removeTolerance / 100) * 441.67
        rmTolSq = tol * tol
    }

    const expScale = f.brightness === 0 ? 1 : Math.pow(2, f.brightness / 0.25)

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4
            let r = data[i]
            let g = data[i + 1]
            let b = data[i + 2]
            const a = data[i + 3]

            // 2. Color remover
            if (rmEnabled && a > 0) {
                const dr = r - rmR, dg = g - rmG, db = b - rmB
                if (dr * dr + dg * dg + db * db <= rmTolSq) {
                    data[i + 3] = 0
                    continue
                }
            }

            // 3. Temperature/tint (per-channel multiply)
            if (tempPresent) {
                r *= tempR; g *= tempG; b *= tempB
            }

            // 4. Exposure (2^EV)
            if (expScale !== 1) {
                r *= expScale; g *= expScale; b *= expScale
            }

            // 5. Highlights/shadows/whites/blacks via luma masks
            if (hasTone) {
                const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
                const highMask = clamp((luma - 0.55) / 0.45, 0, 1)
                const shadMask = clamp((0.45 - luma) / 0.45, 0, 1)
                const whiteMask = clamp((luma - 0.80) / 0.20, 0, 1)
                const blackMask = clamp((0.25 - luma) / 0.25, 0, 1)

                // helper: brighten toward 255 or darken toward 0
                if (hsh) {
                    const k = Math.abs(hsh) * highMask
                    if (hsh > 0) { r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k }
                    else { r -= r * k; g -= g * k; b -= b * k }
                }
                if (ssh) {
                    const k = Math.abs(ssh) * shadMask
                    if (ssh > 0) { r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k }
                    else { r -= r * k; g -= g * k; b -= b * k }
                }
                if (wsh) {
                    const k = Math.abs(wsh) * whiteMask
                    if (wsh > 0) { r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k }
                    else { r -= r * k; g -= g * k; b -= b * k }
                }
                if (bsh) {
                    const k = Math.abs(bsh) * blackMask
                    if (bsh > 0) { r -= r * k; g -= g * k; b -= b * k }
                    else { r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k }
                }
            }

            // 6. Color wheels — Lift on shadows, Gamma on midtones, Gain on highlights
            if (hasLgg) {
                const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
                const sMask = clamp((0.5 - luma) / 0.5, 0, 1)
                const mMask = 1 - Math.abs(luma - 0.5) * 2
                const hMask = clamp((luma - 0.5) / 0.5, 0, 1)
                const lscale = 128 * sMask
                const mscale = 128 * mMask
                const hscale = 128 * hMask
                r += liftDr * lscale + gammaDr * mscale + gainDr * hscale
                g += liftDg * lscale + gammaDg * mscale + gainDg * hscale
                b += liftDb * lscale + gammaDb * mscale + gainDb * hscale
            }

            // 7. Brightness extra (additive)
            if (briAdd) { r += briAdd; g += briAdd; b += briAdd }

            // 8. Contrast around 128
            if (con !== 1) {
                r = (r - 128) * con + 128
                g = (g - 128) * con + 128
                b = (b - 128) * con + 128
            }

            // 9. Saturation
            if (sat !== 1) {
                const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
                r = lum + (r - lum) * sat
                g = lum + (g - lum) * sat
                b = lum + (b - lum) * sat
            }

            // 10. Hue rotation
            if (huePresent) {
                const nr = r * m00 + g * m01 + b * m02
                const ng = r * m10 + g * m11 + b * m12
                const nb = r * m20 + g * m21 + b * m22
                r = nr; g = ng; b = nb
            }

            // 11. Vignette
            if (vignettePresent) {
                const dx = x - cx, dy = y - cy
                const dist = Math.sqrt(dx * dx + dy * dy) / maxDist
                const vig = clamp((dist - 0.4) / 0.6, 0, 1) * f.vignette
                const dim = 1 - vig * 0.85
                r *= dim; g *= dim; b *= dim
            }

            // 12. Grain
            if (grainPresent) {
                const n = (Math.random() - 0.5) * grainStrength
                r += n; g += n; b += n
            }

            data[i] = clamp(r, 0, 255)
            data[i + 1] = clamp(g, 0, 255)
            data[i + 2] = clamp(b, 0, 255)
        }
    }
}

// Glow: blur composite using canvas filter.
function applyGlow(canvas: HTMLCanvasElement, intensity: number) {
    if (intensity <= 0) return
    const ctx = canvas.getContext('2d')!
    const blurAmount = 4 + (intensity / 100) * 16
    const opacity = (intensity / 100) * 0.5

    const blurCanvas = document.createElement('canvas')
    blurCanvas.width = canvas.width
    blurCanvas.height = canvas.height
    const blurCtx = blurCanvas.getContext('2d')!
    blurCtx.filter = `blur(${blurAmount}px)`
    blurCtx.drawImage(canvas, 0, 0)

    ctx.save()
    ctx.globalCompositeOperation = 'screen'
    ctx.globalAlpha = opacity
    ctx.drawImage(blurCanvas, 0, 0)
    ctx.restore()
}

export function createCanvas2DLutRenderer(
    canvas: HTMLCanvasElement,
    video: HTMLVideoElement,
): Canvas2DLutRenderer {
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) {
        return { setLut() { }, setExtraFilter() { }, start() { }, stop() { } }
    }

    let lut: Lut3D | null = null
    let extra: ExtraFilter = { ...DEFAULT_FILTER }
    let rafId = 0
    let running = false
    const MAX_W = 1280

    function ensureSize() {
        const vw = video.videoWidth, vh = video.videoHeight
        if (vw === 0 || vh === 0) return
        const scale = vw > MAX_W ? MAX_W / vw : 1
        const w = Math.round(vw * scale)
        const h = Math.round(vh * scale)
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w; canvas.height = h
        }
    }

    function render() {
        if (!running) return
        try {
            if (video.readyState >= 2 && video.videoWidth > 0) {
                ensureSize()
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

                const needsPixelOps =
                    lut ||
                    extra.chromatic > 0 ||
                    extra.removeEnabled ||
                    extra.brightness ||
                    extra.contrast !== 1 ||
                    extra.saturation !== 1 ||
                    Math.abs(extra.temperature) > 0.001 ||
                    Math.abs(extra.tint) > 0.001 ||
                    Math.abs(extra.hueDeg) > 0.5 ||
                    extra.highlights || extra.shadows || extra.whites || extra.blacks ||
                    extra.liftColor.toLowerCase() !== '#808080' ||
                    extra.gammaColor.toLowerCase() !== '#808080' ||
                    extra.gainColor.toLowerCase() !== '#808080' ||
                    extra.vignette > 0 ||
                    extra.grain > 0

                if (needsPixelOps) {
                    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)

                    // Pre-pass: chromatic aberration (multi-source read)
                    if (extra.chromatic > 0) {
                        const tmp = new Uint8ClampedArray(imageData.data.length)
                        applyChromatic(imageData.data, tmp, canvas.width, canvas.height, extra.chromatic)
                        imageData.data.set(tmp)
                    }

                    // Main pass: LUT + full grading pipeline
                    if (lut) applyLutInPlace(imageData.data, lut)
                    applyPost(imageData.data, canvas.width, canvas.height, extra)

                    ctx.putImageData(imageData, 0, 0)
                }

                // Post-pass: glow (canvas composite)
                if (extra.glow > 0) applyGlow(canvas, extra.glow)
            }
        } catch (e) {
            console.warn('[lut-canvas] frame skipped:', e)
        }
        rafId = requestAnimationFrame(render)
    }

    return {
        setLut(l) { lut = l },
        setExtraFilter(f) { extra = { ...extra, ...f } },
        start() {
            if (running) return
            running = true
            render()
        },
        stop() {
            running = false
            if (rafId) cancelAnimationFrame(rafId)
        },
    }
}

// Convert our Grade values into the canvas filter uniforms.
export function gradeToExtraFilter(g: {
    exposure: number; contrast: number; saturation: number;
    temperature: number; tint: number; hue: number;
    highlights: number; shadows: number; whites: number; blacks: number;
    liftColor: string; liftAmount: number;
    gammaColor: string; gammaAmount: number;
    gainColor: string; gainAmount: number;
    vignette: number; grain: number; chromatic: number; glow: number;
    removeEnabled: boolean; removeColor: string; removeTolerance: number;
}): ExtraFilter {
    return {
        brightness: g.exposure * 0.25,
        contrast: clamp(1 + g.contrast / 100, 0, 2),
        saturation: clamp(1 + g.saturation / 100, 0, 3),
        temperature: clamp(g.temperature / 100, -1, 1),
        tint: clamp(g.tint / 100, -1, 1),
        hueDeg: g.hue,
        highlights: g.highlights,
        shadows: g.shadows,
        whites: g.whites,
        blacks: g.blacks,
        liftColor: g.liftColor,
        liftAmount: g.liftAmount,
        gammaColor: g.gammaColor,
        gammaAmount: g.gammaAmount,
        gainColor: g.gainColor,
        gainAmount: g.gainAmount,
        vignette: clamp(g.vignette / 100, 0, 1),
        grain: g.grain,
        chromatic: g.chromatic,
        glow: g.glow,
        removeEnabled: g.removeEnabled,
        removeColor: g.removeColor,
        removeTolerance: g.removeTolerance,
    }
}
