// ──────────────────────────────────────────────────────────
// In-browser image conversion: decode -> (optional grade + LUT) -> encode.
// Uses the same pixel pipeline as the Color Lab preview, so a graded
// export matches what was on screen. Anything the browser can't do
// (HEIC/RAW input, AVIF encode on some browsers, huge canvases) throws, and
// the caller falls back to the server.
// ──────────────────────────────────────────────────────────
import type { Lut3D } from './cubeLut'
import { DEFAULT_FILTER, renderStill, type ExtraFilter } from './lutCanvas2D'

/** Inputs every current browser decodes. GIF is left to the server (animation). */
export const BROWSER_DECODABLE = new Set(['jpg', 'jpeg', 'png', 'webp', 'bmp', 'avif'])
export const BROWSER_ENCODABLE = new Set(['png', 'jpg', 'jpeg', 'webp', 'avif', 'bmp', 'ico', 'tiff', 'tif', 'gif', 'pdf'])
const OPAQUE_FORMATS = new Set(['jpg', 'jpeg', 'bmp', 'pdf'])

export interface BrowserImageOptions {
    /** 1-100, lossy formats only. */
    quality?: number
    /** Fit inside this many pixels (long side). 0 = keep. */
    maxSide?: number
    filter?: ExtraFilter
    sharpness?: number
    lut?: Lut3D | null
}

export async function decodeImage(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
    if (typeof createImageBitmap === 'function') {
        try {
            const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
            return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() }
        } catch {
            // fall through to <img>
        }
    }
    const url = URL.createObjectURL(file)
    try {
        const img = new Image()
        img.decoding = 'async'
        img.src = url
        await img.decode()
        return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => undefined }
    } catch {
        throw new Error('image illisible par le navigateur')
    } finally {
        URL.revokeObjectURL(url)
    }
}

export async function processImageInBrowser(
    file: File,
    outputFormat: string,
    opts: BrowserImageOptions = {},
): Promise<{ blob: Blob; filename: string }> {
    const fmt = outputFormat.toLowerCase()
    if (!BROWSER_ENCODABLE.has(fmt)) throw new Error(`format ${fmt} non géré par le navigateur`)
    const img = await decodeImage(file)
    try {
        const canvas = document.createElement('canvas')
        renderStill(
            img.source, img.width, img.height, canvas,
            opts.lut ?? null, opts.filter ?? DEFAULT_FILTER, opts.sharpness ?? 0, opts.maxSide ?? 0,
        )
        if (canvas.width === 0 || canvas.height === 0) throw new Error('image trop grande pour le navigateur')
        if (OPAQUE_FORMATS.has(fmt)) flattenOnWhite(canvas)
        const blob = await encodeCanvas(canvas, fmt, opts.quality ?? 92)
        if (!blob.size) throw new Error('encodage vide')
        const base = file.name.replace(/\.[^.]+$/, '')
        return { blob, filename: `${base}.${fmt === 'jpeg' ? 'jpg' : fmt}` }
    } finally {
        img.close()
    }
}

function flattenOnWhite(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.save()
    ctx.globalCompositeOperation = 'destination-over'
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.restore()
}

// ──────────────────────────────────────────────────────────
// Multi-format Canvas encoder.
// Native via canvas.toBlob: png, jpg, webp, avif.
// Extra via libs: gif (gifenc), tiff (utif), pdf (jspdf), bmp & ico hand-rolled.
// ──────────────────────────────────────────────────────────
async function encodeCanvas(canvas: HTMLCanvasElement, format: string, quality: number): Promise<Blob> {
    const fmt = format.toLowerCase()

    // Native browser encoders.
    if (fmt === 'png' || fmt === 'jpg' || fmt === 'jpeg' || fmt === 'webp' || fmt === 'avif') {
        const mime =
            fmt === 'jpg' || fmt === 'jpeg' ? 'image/jpeg' :
            fmt === 'webp' ? 'image/webp' :
            fmt === 'avif' ? 'image/avif' :
            'image/png'
        const q = mime === 'image/png' ? undefined : Math.max(0.1, Math.min(1, quality / 100))
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, q))
        // Browsers silently fall back to PNG for types they can't encode
        // (AVIF on Chrome, WebP on older Safari): never ship a mislabelled file.
        if (!blob || blob.type !== mime) throw new Error(`encodage ${fmt} non supporté par ce navigateur`)
        return blob
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
    const pngBlob = await new Promise<Blob | null>((r) => tmp.toBlob(r, 'image/png'))
    if (!pngBlob) throw new Error('encodage ICO impossible')
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
    const UTIF = (await import('utif')).default
    const ctx = canvas.getContext('2d')!
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const tiff: ArrayBuffer = UTIF.encodeImage(data.buffer, width, height)
    return new Blob([tiff], { type: 'image/tiff' })
}

// ── GIF (single frame, adaptive palette via gifenc) ──
async function encodeGifStatic(canvas: HTMLCanvasElement): Promise<Blob> {
    const { GIFEncoder, quantize, applyPalette } = await import('gifenc')
    const ctx = canvas.getContext('2d')!
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const gif = GIFEncoder()
    const palette = quantize(data, 256)
    const index = applyPalette(data, palette)
    gif.writeFrame(index, width, height, { palette })
    gif.finish()
    return new Blob([new Uint8Array(gif.bytes())], { type: 'image/gif' })
}

// ── PDF via jspdf ──
async function encodePdf(canvas: HTMLCanvasElement): Promise<Blob> {
    const { jsPDF } = await import('jspdf')
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

