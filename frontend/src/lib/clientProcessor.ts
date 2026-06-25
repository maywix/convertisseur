// ──────────────────────────────────────────────────────────
// Client-side image processor — runs everything in the browser via Canvas
// without uploading to the server. Implements the same Lightroom-style
// adjustments + effects we have on the backend, with comparable maths.
//
// Limitations:
//   - Works on images only (no video — that needs ffmpeg.wasm, too heavy here).
//   - Single CPU thread; large images (>20 MP) can take a few hundred ms.
// ──────────────────────────────────────────────────────────

export interface ClientGrade {
    exposure: number       // -2..+2 EV
    contrast: number       // -100..+100
    highlights: number     // -100..+100
    shadows: number        // -100..+100
    whites: number         // -100..+100
    blacks: number         // -100..+100
    saturation: number     // -100..+100
    temperature: number    // -100..+100 cool/warm
    tint: number           // -100..+100 green/magenta
    hue?: number           // -180..180 (image: skipped, but accepted to share Grade)
    sharpness: number      // -100..+100
    vignette: number       // 0..100
    grain: number          // 0..100
    chromatic: number      // 0..20 px
    glow: number           // 0..100
    // DaVinci-style color wheels
    liftColor?: string     // hex
    liftAmount?: number    // 0..2
    gammaColor?: string
    gammaAmount?: number
    gainColor?: string
    gainAmount?: number
    // Color remover
    removeEnabled: boolean
    removeColor: string    // hex
    removeTolerance: number // 0..100
}

function loadImage(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image()
        const url = URL.createObjectURL(file)
        img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image load failed')) }
        img.src = url
    })
}

function clamp(v: number, min: number, max: number): number {
    return v < min ? min : v > max ? max : v
}

function hexToDelta(hex?: string, amount = 1): [number, number, number] {
    if (!hex) return [0, 0, 0]
    const c = hex.replace('#', '')
    if (c.length !== 6) return [0, 0, 0]
    const r = parseInt(c.substring(0, 2), 16)
    const g = parseInt(c.substring(2, 4), 16)
    const b = parseInt(c.substring(4, 6), 16)
    return [(r - 128) / 127 * amount, (g - 128) / 127 * amount, (b - 128) / 127 * amount]
}

// Apply Lightroom-style adjustments to RGBA pixel data in-place.
function applyAdjustments(data: Uint8ClampedArray, w: number, h: number, g: ClientGrade) {
    const exposureScale = Math.pow(2, g.exposure)
    const contrastFactor = 1 + g.contrast / 100
    const satFactor = 1 + g.saturation / 100
    const tempR = 1 + (g.temperature / 100) * 0.22
    const tempG = 1 - (g.temperature / 100) * 0.04
    const tempB = 1 - (g.temperature / 100) * 0.22
    const tintR = 1 + (g.tint / 100) * 0.08
    const tintG = 1 - (g.tint / 100) * 0.18
    const tintB = 1 + (g.tint / 100) * 0.08

    // DaVinci-style Lift / Gamma / Gain shifts (zone-based).
    const [liftDr, liftDg, liftDb] = hexToDelta(g.liftColor, g.liftAmount ?? 1)
    const [gammaDr, gammaDg, gammaDb] = hexToDelta(g.gammaColor, g.gammaAmount ?? 1)
    const [gainDr, gainDg, gainDb] = hexToDelta(g.gainColor, g.gainAmount ?? 1)
    const hasLgg = Math.abs(liftDr) + Math.abs(liftDg) + Math.abs(liftDb) +
                   Math.abs(gammaDr) + Math.abs(gammaDg) + Math.abs(gammaDb) +
                   Math.abs(gainDr) + Math.abs(gainDg) + Math.abs(gainDb) > 0.001

    // Color remover prep
    const rmEnabled = g.removeEnabled
    let rmR = 0, rmG = 0, rmB = 0, rmTolSq = 0
    if (rmEnabled) {
        const c = g.removeColor.replace('#', '')
        if (c.length === 6) {
            rmR = parseInt(c.substring(0, 2), 16)
            rmG = parseInt(c.substring(2, 4), 16)
            rmB = parseInt(c.substring(4, 6), 16)
            const tol = (g.removeTolerance / 100) * 441.67
            rmTolSq = tol * tol
        }
    }

    for (let i = 0; i < data.length; i += 4) {
        let r = data[i]
        let g_ = data[i + 1]
        let b = data[i + 2]

        // Color remover: makes matching pixels transparent (before colour adjustments).
        if (rmEnabled && data[i + 3] > 0) {
            const dr = r - rmR
            const dg = g_ - rmG
            const db = b - rmB
            if (dr * dr + dg * dg + db * db <= rmTolSq) {
                data[i + 3] = 0
                continue
            }
        }

        // Temperature + tint (linear scaling per channel).
        r *= tempR * tintR
        g_ *= tempG * tintG
        b *= tempB * tintB

        // Exposure (multiplicative).
        r *= exposureScale
        g_ *= exposureScale
        b *= exposureScale

        // Highlights / shadows / whites / blacks based on luma.
        const lumaPre = (0.2126 * r + 0.7152 * g_ + 0.0722 * b) / 255

        if (g.highlights || g.shadows || g.whites || g.blacks) {
            const hMask = clamp((lumaPre - 0.55) / 0.45, 0, 1)
            const sMask = clamp((0.45 - lumaPre) / 0.45, 0, 1)
            const wMask = clamp((lumaPre - 0.80) / 0.20, 0, 1)
            const bMask = clamp((0.25 - lumaPre) / 0.25, 0, 1)

            const apply = (delta: number, mask: number, brighten: boolean) => {
                if (delta === 0 || mask === 0) return
                const amount = Math.abs(delta) / 100 * mask
                if (delta > 0) {
                    if (brighten) { r += (255 - r) * amount; g_ += (255 - g_) * amount; b += (255 - b) * amount }
                    else { r -= r * amount; g_ -= g_ * amount; b -= b * amount }
                } else {
                    if (brighten) { r -= r * amount; g_ -= g_ * amount; b -= b * amount }
                    else { r += (255 - r) * amount; g_ += (255 - g_) * amount; b += (255 - b) * amount }
                }
            }
            apply(g.highlights, hMask, true)
            apply(g.shadows, sMask, true)
            apply(g.whites, wMask, true)
            apply(g.blacks, bMask, false)
        }

        // DaVinci Lift / Gamma / Gain — additive shift by zone (luma).
        if (hasLgg) {
            const lumaPost = (0.2126 * r + 0.7152 * g_ + 0.0722 * b) / 255
            const sZone = clamp((0.5 - lumaPost) / 0.5, 0, 1)
            const mZone = 1 - Math.abs(lumaPost - 0.5) * 2
            const hZone = clamp((lumaPost - 0.5) / 0.5, 0, 1)
            const lScale = 128 * sZone
            const mScale = 128 * mZone
            const hScale = 128 * hZone
            r += liftDr * lScale + gammaDr * mScale + gainDr * hScale
            g_ += liftDg * lScale + gammaDg * mScale + gainDg * hScale
            b += liftDb * lScale + gammaDb * mScale + gainDb * hScale
        }

        // Contrast around 0.5 (midpoint).
        if (contrastFactor !== 1) {
            r = (r - 128) * contrastFactor + 128
            g_ = (g_ - 128) * contrastFactor + 128
            b = (b - 128) * contrastFactor + 128
        }

        // Saturation in HSL-ish (simple): mix toward luma.
        if (satFactor !== 1) {
            const luma = 0.2126 * r + 0.7152 * g_ + 0.0722 * b
            r = luma + (r - luma) * satFactor
            g_ = luma + (g_ - luma) * satFactor
            b = luma + (b - luma) * satFactor
        }

        data[i] = clamp(r, 0, 255)
        data[i + 1] = clamp(g_, 0, 255)
        data[i + 2] = clamp(b, 0, 255)
    }
}

// Vignette: darken pixels by distance to centre.
function applyVignette(data: Uint8ClampedArray, w: number, h: number, intensity: number) {
    if (intensity <= 0) return
    const cx = w / 2
    const cy = h / 2
    const maxDist = Math.sqrt(cx * cx + cy * cy)
    const strength = intensity / 100
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const dx = x - cx
            const dy = y - cy
            const dist = Math.sqrt(dx * dx + dy * dy) / maxDist
            const dim = 1 - clamp((dist - 0.4) / 0.6, 0, 1) * strength * 0.85
            const i = (y * w + x) * 4
            data[i] = data[i] * dim
            data[i + 1] = data[i + 1] * dim
            data[i + 2] = data[i + 2] * dim
        }
    }
}

// Film grain: per-pixel additive noise.
function applyGrain(data: Uint8ClampedArray, intensity: number) {
    if (intensity <= 0) return
    const amount = intensity / 100 * 40   // 0..40
    for (let i = 0; i < data.length; i += 4) {
        const n = (Math.random() - 0.5) * amount
        data[i] = clamp(data[i] + n, 0, 255)
        data[i + 1] = clamp(data[i + 1] + n, 0, 255)
        data[i + 2] = clamp(data[i + 2] + n, 0, 255)
    }
}

// Chromatic aberration: shift R and B channels horizontally.
function applyChromatic(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, px: number) {
    if (px <= 0) {
        dst.set(src)
        return
    }
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

// Glow: Gaussian blur of original, then screen-blend at low opacity.
async function applyGlow(canvas: HTMLCanvasElement, intensity: number) {
    if (intensity <= 0) return
    const ctx = canvas.getContext('2d')!
    const blurAmount = 4 + (intensity / 100) * 16  // 4..20 px
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

export async function processImageClientSide(
    file: File,
    grade: ClientGrade,
    outputFormat: string,
    onProgress?: (msg: string) => void,
    lutFile?: File | null,
): Promise<{ blob: Blob; filename: string }> {
    onProgress?.('Décodage…')
    const img = await loadImage(file)
    const w = img.naturalWidth
    const h = img.naturalHeight

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(img, 0, 0)

    onProgress?.('Lecture des pixels…')
    const imageData = ctx.getImageData(0, 0, w, h)

    // Stage 0: LUT (.cube) — applied first so subsequent edits work in the
    // graded colour space.
    if (lutFile) {
        try {
            onProgress?.('Application LUT…')
            const { loadLutFromFile, applyLutInPlace } = await import('@/lib/cubeLut')
            const lut = await loadLutFromFile(lutFile)
            applyLutInPlace(imageData.data, lut)
        } catch (e) {
            console.warn('[lut] échec — on continue sans :', e)
        }
    }

    // Stage 1: chromatic aberration (operates on a copy)
    if (grade.chromatic > 0) {
        const tmp = new Uint8ClampedArray(imageData.data.length)
        applyChromatic(imageData.data, tmp, w, h, grade.chromatic)
        imageData.data.set(tmp)
    }

    onProgress?.('Application des ajustements…')
    applyAdjustments(imageData.data, w, h, grade)

    if (grade.vignette > 0) {
        onProgress?.('Vignette…')
        applyVignette(imageData.data, w, h, grade.vignette)
    }

    if (grade.grain > 0) {
        onProgress?.('Grain…')
        applyGrain(imageData.data, grade.grain)
    }

    ctx.putImageData(imageData, 0, 0)

    if (grade.glow > 0) {
        onProgress?.('Glow…')
        await applyGlow(canvas, grade.glow)
    }

    // Sharpness via canvas filter (approx).
    if (grade.sharpness !== 0) {
        // No native sharpen — skip for the client side (would need conv kernel).
    }

    onProgress?.('Encodage…')
    const blob = await encodeCanvas(canvas, outputFormat)

    const base = file.name.replace(/\.[^.]+$/, '')
    const ext = outputFormat === 'jpeg' ? 'jpg' : outputFormat
    const filename = `${base}.${ext}`
    return { blob, filename }
}

// ──────────────────────────────────────────────────────────
// Multi-format Canvas encoder.
// Native via canvas.toBlob: png, jpg, webp, avif.
// Extra via libs: gif (gifenc), tiff (utif), pdf (jspdf), bmp & ico hand-rolled.
// ──────────────────────────────────────────────────────────
async function encodeCanvas(canvas: HTMLCanvasElement, format: string): Promise<Blob> {
    const fmt = format.toLowerCase()

    // Native browser encoders.
    if (fmt === 'png' || fmt === 'jpg' || fmt === 'jpeg' || fmt === 'webp' || fmt === 'avif') {
        const mime =
            fmt === 'jpg' || fmt === 'jpeg' ? 'image/jpeg' :
            fmt === 'webp' ? 'image/webp' :
            fmt === 'avif' ? 'image/avif' :
            'image/png'
        const quality = mime === 'image/png' ? undefined : 0.92
        return new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((b) => b ? resolve(b) : reject(new Error('encode failed')), mime, quality)
        })
    }

    if (fmt === 'bmp') return encodeBmp(canvas)
    if (fmt === 'ico') return encodeIco(canvas)
    if (fmt === 'tiff' || fmt === 'tif') return encodeTiff(canvas)
    if (fmt === 'gif') return encodeGifStatic(canvas)
    if (fmt === 'pdf') return encodePdf(canvas)

    throw new Error(`format de sortie non supporté côté client : ${fmt}`)
}

// ── BMP (24-bit BGR, hand-rolled, ~50 lines) ──
function encodeBmp(canvas: HTMLCanvasElement): Blob {
    const w = canvas.width
    const h = canvas.height
    const ctx = canvas.getContext('2d')!
    const { data } = ctx.getImageData(0, 0, w, h)

    const rowSize = ((24 * w + 31) >> 5) << 2   // 4-byte aligned
    const pixelSize = rowSize * h
    const fileSize = 54 + pixelSize

    const buf = new ArrayBuffer(fileSize)
    const view = new DataView(buf)
    // BMP header
    view.setUint8(0, 0x42); view.setUint8(1, 0x4D)         // 'BM'
    view.setUint32(2, fileSize, true)
    view.setUint32(10, 54, true)                            // pixel data offset
    view.setUint32(14, 40, true)                            // DIB header size
    view.setInt32(18, w, true)
    view.setInt32(22, -h, true)                             // negative = top-down
    view.setUint16(26, 1, true)                             // planes
    view.setUint16(28, 24, true)                            // bpp
    view.setUint32(34, pixelSize, true)
    view.setInt32(38, 2835, true)                           // 72 dpi
    view.setInt32(42, 2835, true)

    let p = 54
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4
            view.setUint8(p++, data[i + 2])                 // B
            view.setUint8(p++, data[i + 1])                 // G
            view.setUint8(p++, data[i])                     // R
        }
        p += rowSize - w * 3                                // row padding
    }
    return new Blob([buf], { type: 'image/bmp' })
}

// ── ICO (single 256-max PNG embedded) ──
async function encodeIco(canvas: HTMLCanvasElement): Promise<Blob> {
    // Resize to max 256x256 then embed as PNG inside ICO wrapper.
    const max = Math.max(canvas.width, canvas.height)
    const scale = max > 256 ? 256 / max : 1
    const w = Math.round(canvas.width * scale)
    const h = Math.round(canvas.height * scale)
    const tmp = document.createElement('canvas')
    tmp.width = w; tmp.height = h
    tmp.getContext('2d')!.drawImage(canvas, 0, 0, w, h)
    const pngBlob = await new Promise<Blob>((r) => tmp.toBlob((b) => r(b!), 'image/png'))
    const pngBytes = new Uint8Array(await pngBlob.arrayBuffer())

    // ICO header (6 bytes) + 1 directory entry (16 bytes) + PNG data
    const header = new Uint8Array(6 + 16)
    const dv = new DataView(header.buffer)
    dv.setUint16(0, 0, true)       // reserved
    dv.setUint16(2, 1, true)       // type 1 = .ICO
    dv.setUint16(4, 1, true)       // num images
    // entry
    dv.setUint8(6, w === 256 ? 0 : w)
    dv.setUint8(7, h === 256 ? 0 : h)
    dv.setUint8(8, 0)              // colour palette count
    dv.setUint8(9, 0)              // reserved
    dv.setUint16(10, 1, true)      // color planes
    dv.setUint16(12, 32, true)     // bpp
    dv.setUint32(14, pngBytes.length, true)
    dv.setUint32(18, 22, true)     // offset to data

    return new Blob([header, pngBytes], { type: 'image/x-icon' })
}

// ── TIFF via utif ──
async function encodeTiff(canvas: HTMLCanvasElement): Promise<Blob> {
    const UTIF: any = (await import('utif')).default
    const ctx = canvas.getContext('2d')!
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const tiff = UTIF.encodeImage(data.buffer, width, height)
    return new Blob([tiff], { type: 'image/tiff' })
}

// ── GIF (single frame, adaptive palette via gifenc) ──
async function encodeGifStatic(canvas: HTMLCanvasElement): Promise<Blob> {
    const { GIFEncoder, quantize, applyPalette }: any = await import('gifenc')
    const ctx = canvas.getContext('2d')!
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const gif = GIFEncoder()
    const palette = quantize(data, 256)
    const index = applyPalette(data, palette)
    gif.writeFrame(index, width, height, { palette })
    gif.finish()
    return new Blob([gif.bytes()], { type: 'image/gif' })
}

// ── PDF via jspdf ──
async function encodePdf(canvas: HTMLCanvasElement): Promise<Blob> {
    const { jsPDF }: any = await import('jspdf')
    const png = canvas.toDataURL('image/png')
    // Use point units; convert pixel size to points (1 px = 0.75 pt).
    const pt = (px: number) => px * 0.75
    const pdf = new jsPDF({
        orientation: canvas.width >= canvas.height ? 'landscape' : 'portrait',
        unit: 'pt',
        format: [pt(canvas.width), pt(canvas.height)],
    })
    pdf.addImage(png, 'PNG', 0, 0, pt(canvas.width), pt(canvas.height))
    return pdf.output('blob')
}

export function isClientSupportedFormat(format: string): boolean {
    return ['png', 'jpg', 'jpeg', 'webp', 'avif', 'bmp', 'ico', 'tiff', 'tif', 'gif', 'pdf']
        .includes(format.toLowerCase())
}
