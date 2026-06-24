// ──────────────────────────────────────────────────────────
// Client-side video processor using ffmpeg.wasm.
// First call downloads the wasm core (~30 MB, then cached by the browser).
//
// Requires the server to set:
//   Cross-Origin-Opener-Policy: same-origin
//   Cross-Origin-Embedder-Policy: require-corp
// (already configured in app.py)
// ──────────────────────────────────────────────────────────
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

let ffmpegInstance: FFmpeg | null = null
let loadingPromise: Promise<FFmpeg> | null = null

export interface VideoGrade {
    // Light
    exposure: number       // -2..+2 EV
    contrast: number       // -100..+100
    highlights: number     // -100..+100
    shadows: number        // -100..+100
    whites: number         // -100..+100
    blacks: number         // -100..+100
    // Color
    saturation: number     // -100..+100
    temperature: number    // -100..+100
    tint: number           // -100..+100
    hue: number            // -180..+180°
    // Detail
    sharpness: number      // -100..+100
    // Effects
    vignette: number       // 0..100
    grain: number          // 0..100
    chromatic: number      // 0..20 px
    glow: number           // 0..100
    // Output controls
    targetFps?: number | null  // null/undefined = keep original
}

const ZERO_GRADE: VideoGrade = {
    exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
    saturation: 0, temperature: 0, tint: 0, hue: 0,
    sharpness: 0, vignette: 0, grain: 0, chromatic: 0, glow: 0,
    targetFps: null,
}

async function getFFmpeg(onProgress?: (msg: string) => void): Promise<FFmpeg> {
    if (ffmpegInstance) return ffmpegInstance
    if (loadingPromise) return loadingPromise

    loadingPromise = (async () => {
        const inst = new FFmpeg()
        inst.on('log', ({ message }) => {
            // Forward important lines (progress + errors) to the caller.
            if (message.includes('frame=') || message.includes('time=')) return
            // Could be too verbose, comment out if needed.
            // console.log('[ffmpeg]', message)
        })

        onProgress?.('Téléchargement de FFmpeg WASM (~30 MB, mis en cache)…')

        // Use the multi-thread build if cross-origin isolated, otherwise single-thread.
        const isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated
        const variant = isolated ? 'core-mt' : 'core'
        const base = `https://unpkg.com/@ffmpeg/${variant}@0.12.10/dist/esm`

        await inst.load({
            coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
            ...(isolated && {
                workerURL: await toBlobURL(`${base}/ffmpeg-core.worker.js`, 'text/javascript'),
            }),
        })

        ffmpegInstance = inst
        return inst
    })()

    return loadingPromise
}

function clamp(v: number, min: number, max: number) {
    return v < min ? min : v > max ? max : v
}

function buildVideoFilters(g: VideoGrade): string[] {
    const filters: string[] = []

    if (g.exposure || g.contrast || g.saturation) {
        const brightness = clamp(g.exposure * 0.25, -1, 1)
        const contrast = clamp(1 + g.contrast / 100, 0, 2)
        const saturation = clamp(1 + g.saturation / 100, 0, 3)
        filters.push(`eq=brightness=${brightness.toFixed(3)}:contrast=${contrast.toFixed(3)}:saturation=${saturation.toFixed(3)}`)
    }

    if (g.highlights || g.shadows || g.whites || g.blacks) {
        const shift = (base: number, delta: number) =>
            clamp(base + (delta / 100) * 0.18, 0, 1)
        const p_black = shift(0, g.blacks)
        const p_shadow = shift(0.25, g.shadows)
        const p_high = shift(0.75, g.highlights)
        const p_white = shift(1, g.whites)
        filters.push(`curves=all='0/${p_black.toFixed(3)} 0.25/${p_shadow.toFixed(3)} 0.5/0.500 0.75/${p_high.toFixed(3)} 1/${p_white.toFixed(3)}'`)
    }

    if (g.temperature) {
        const kelvin = clamp(6500 + g.temperature * 35, 1500, 15000)
        filters.push(`colortemperature=temperature=${Math.round(kelvin)}`)
    }
    if (g.tint) filters.push(`hue=h=${(g.tint * 0.45).toFixed(1)}`)
    if (g.hue) filters.push(`hue=h=${g.hue.toFixed(1)}`)

    if (g.sharpness) {
        const amt = (g.sharpness / 100) * 2
        filters.push(`unsharp=5:5:${amt.toFixed(2)}:5:5:0.0`)
    }

    if (g.vignette > 0) {
        const angle = (g.vignette / 100) * (Math.PI / 4)
        filters.push(`vignette=angle=${angle.toFixed(3)}:mode=forward`)
    }
    if (g.grain > 0) {
        const strength = Math.round(g.grain * 0.6)
        filters.push(`noise=alls=${strength}:allf=t+u`)
    }
    if (g.chromatic > 0) {
        const px = Math.round(g.chromatic)
        filters.push(`rgbashift=rh=${px}:rv=0:bh=-${px}:bv=0`)
    }
    if (g.glow > 0) {
        const sigma = 1 + (g.glow / 100) * 4
        filters.push(`gblur=sigma=${sigma.toFixed(2)}:steps=1`)
    }

    return filters
}

function pickCodec(outFormat: string): { codec: string; ext: string } {
    const f = outFormat.toLowerCase()
    if (f === 'mp4' || f === 'mov' || f === 'mkv' || f === 'm4v') return { codec: 'libx264', ext: f }
    if (f === 'webm') return { codec: 'libvpx-vp9', ext: 'webm' }
    if (f === 'avi') return { codec: 'mpeg4', ext: 'avi' }
    if (f === 'gif') return { codec: 'gif', ext: 'gif' }
    return { codec: 'libx264', ext: 'mp4' }
}

export async function processVideoClientSide(
    file: File,
    outputFormat: string,
    grade: Partial<VideoGrade> = {},
    onProgress?: (msg: string, ratio?: number) => void,
    lutFile?: File | null,
): Promise<{ blob: Blob; filename: string }> {
    const ffmpeg = await getFFmpeg(onProgress)
    const g: VideoGrade = { ...ZERO_GRADE, ...grade }
    const filters = buildVideoFilters(g)

    const { codec, ext } = pickCodec(outputFormat)
    const base = file.name.replace(/\.[^.]+$/, '')
    const inputName = `in.${file.name.split('.').pop() || 'mp4'}`
    const outputName = `out.${ext}`

    onProgress?.('Préparation du fichier…')
    await ffmpeg.writeFile(inputName, await fetchFile(file))

    // Optional .cube LUT: write to the wasm FS and prepend lut3d filter.
    let lutName = ''
    if (lutFile) {
        lutName = 'grade.cube'
        await ffmpeg.writeFile(lutName, await fetchFile(lutFile))
        filters.unshift(`lut3d=${lutName}`)
    }

    const progressHandler = ({ progress }: { progress: number }) => {
        onProgress?.(`Conversion ${Math.round(progress * 100)} %`, progress)
    }
    ffmpeg.on('progress', progressHandler)

    try {
        const args: string[] = ['-i', inputName]
        if (filters.length > 0) {
            args.push('-vf', filters.join(','))
        }
        args.push('-c:v', codec)
        if (codec === 'libx264') args.push('-preset', 'veryfast', '-crf', '23')
        if (codec === 'libvpx-vp9') args.push('-b:v', '0', '-crf', '32')
        if (g.targetFps && g.targetFps > 0) {
            args.push('-r', String(g.targetFps))
        }
        // Audio passthrough where possible, else AAC.
        if (ext !== 'gif') {
            args.push('-c:a', 'aac', '-b:a', '128k')
        }
        args.push('-y', outputName)

        onProgress?.('Conversion…', 0)
        await ffmpeg.exec(args)
    } finally {
        ffmpeg.off('progress', progressHandler)
    }

    onProgress?.('Lecture du résultat…')
    const data = await ffmpeg.readFile(outputName)
    // Cleanup
    try { await ffmpeg.deleteFile(inputName) } catch { /* ignore */ }
    try { await ffmpeg.deleteFile(outputName) } catch { /* ignore */ }
    if (lutName) { try { await ffmpeg.deleteFile(lutName) } catch { /* ignore */ } }

    const mime =
        ext === 'mp4' || ext === 'm4v' ? 'video/mp4' :
        ext === 'webm' ? 'video/webm' :
        ext === 'mkv' ? 'video/x-matroska' :
        ext === 'mov' ? 'video/quicktime' :
        ext === 'avi' ? 'video/x-msvideo' :
        ext === 'gif' ? 'image/gif' :
        'application/octet-stream'

    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer)
    const blob = new Blob([bytes], { type: mime })
    return { blob, filename: `${base}.${ext}` }
}

export function isClientSupportedVideoFormat(format: string): boolean {
    return ['mp4', 'mov', 'mkv', 'm4v', 'webm', 'avi', 'gif'].includes(format.toLowerCase())
}

export async function preloadFFmpeg(onProgress?: (msg: string) => void): Promise<void> {
    await getFFmpeg(onProgress)
}
