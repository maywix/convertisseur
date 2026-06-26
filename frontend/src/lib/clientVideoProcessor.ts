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
    // DaVinci Lift / Gamma / Gain (hex + amount). Neutral grey = #808080.
    liftColor?: string
    liftAmount?: number
    gammaColor?: string
    gammaAmount?: number
    gainColor?: string
    gainAmount?: number
    // Detail
    sharpness: number      // -100..+100
    // Effects
    vignette: number       // 0..100
    grain: number          // 0..100
    chromatic: number      // 0..20 px
    glow: number           // 0..100
    // Output controls
    targetFps?: number | null  // null/undefined = keep original
    // Trim + overlay text
    trimStart?: string         // "" or "HH:MM:SS" / seconds
    trimEnd?: string
    overlayText?: string
    overlayTextX?: string
    overlayTextY?: string
    // Color remover (passes through to backend OR — here — through the
    // optional colorkey filter for codecs that keep alpha).
    removeEnabled?: boolean
    removeColor?: string
    removeTolerance?: number
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

    // === Order matches Canvas2D preview exactly ===
    // temp → exposure → HSWB → LGG → contrast → saturation → hue → vignette → grain → glow

    // 1. Temperature + tint (per-channel multiply).
    if (g.temperature || g.tint) {
        const tempN = g.temperature / 100
        const tintN = g.tint / 100
        const rMul = (1 + tempN * 0.22) * (1 + tintN * 0.08)
        const gMul = (1 - tempN * 0.04) * (1 - tintN * 0.18)
        const bMul = (1 - tempN * 0.22) * (1 + tintN * 0.08)
        filters.push(
            `lutrgb=r='clip(val*${rMul.toFixed(4)}, 0, 255)':g='clip(val*${gMul.toFixed(4)}, 0, 255)':b='clip(val*${bMul.toFixed(4)}, 0, 255)'`,
        )
    }

    // 2. Exposure (additive brightness).
    if (g.exposure) {
        const brightness = clamp(g.exposure * 0.25, -1, 1)
        filters.push(`eq=brightness=${brightness.toFixed(3)}`)
    }

    // 3. Tone curve.
    if (g.highlights || g.shadows || g.whites || g.blacks) {
        const MAX = 0.30
        let pBlack = 0
        let pShadow = 0.25
        let pHigh = 0.75
        let pWhite = 1
        pHigh = clamp(pHigh + (g.highlights / 100) * MAX, 0, 1)
        pShadow = clamp(pShadow + (g.shadows / 100) * MAX, 0, 1)
        if (g.whites > 0) pHigh = clamp(pHigh + (g.whites / 100) * MAX * 0.5, 0, 1)
        else if (g.whites < 0) pWhite = clamp(pWhite + (g.whites / 100) * MAX, 0, 1)
        if (g.blacks > 0) pShadow = clamp(pShadow - (g.blacks / 100) * MAX * 0.5, 0, 1)
        else if (g.blacks < 0) pBlack = clamp(pBlack - (g.blacks / 100) * MAX, 0, 1)
        filters.push(`curves=all='0/${pBlack.toFixed(3)} 0.25/${pShadow.toFixed(3)} 0.5/0.500 0.75/${pHigh.toFixed(3)} 1/${pWhite.toFixed(3)}'`)
    }

    // 4. DaVinci Lift / Gamma / Gain via FFmpeg colorbalance.
    const hexToBalance = (hex?: string): [number, number, number] => {
        if (!hex) return [0, 0, 0]
        const c = hex.replace('#', '')
        if (c.length !== 6) return [0, 0, 0]
        return [
            (parseInt(c.slice(0, 2), 16) - 128) / 127,
            (parseInt(c.slice(2, 4), 16) - 128) / 127,
            (parseInt(c.slice(4, 6), 16) - 128) / 127,
        ]
    }
    const [lr, lg_, lb] = hexToBalance(g.liftColor)
    const [mr, mg, mb] = hexToBalance(g.gammaColor)
    const [hr, hg, hb] = hexToBalance(g.gainColor)
    const la = g.liftAmount ?? 1, ma = g.gammaAmount ?? 1, ha = g.gainAmount ?? 1
    const cbParts: string[] = []
    if (lr || lg_ || lb) cbParts.push(`rs=${(lr * la).toFixed(3)}:gs=${(lg_ * la).toFixed(3)}:bs=${(lb * la).toFixed(3)}`)
    if (mr || mg || mb) cbParts.push(`rm=${(mr * ma).toFixed(3)}:gm=${(mg * ma).toFixed(3)}:bm=${(mb * ma).toFixed(3)}`)
    if (hr || hg || hb) cbParts.push(`rh=${(hr * ha).toFixed(3)}:gh=${(hg * ha).toFixed(3)}:bh=${(hb * ha).toFixed(3)}`)
    if (cbParts.length > 0) filters.push(`colorbalance=${cbParts.join(':')}`)

    // 5. Contrast + saturation AFTER tone + LGG.
    if (g.contrast || g.saturation) {
        const contrast = clamp(1 + g.contrast / 100, 0, 2)
        const saturation = clamp(1 + g.saturation / 100, 0, 3)
        filters.push(`eq=contrast=${contrast.toFixed(3)}:saturation=${saturation.toFixed(3)}`)
    }

    // 6. Hue.
    if (g.hue) filters.push(`hue=h=${g.hue.toFixed(1)}`)

    // 7. Sharpness.
    if (g.sharpness) {
        const amt = (g.sharpness / 100) * 2
        filters.push(`unsharp=5:5:${amt.toFixed(2)}:5:5:0.0`)
    }

    // Color remover (chroma key) when the user enabled it.
    if (g.removeEnabled && g.removeColor) {
        const c = g.removeColor.replace('#', '').toLowerCase()
        if (c.length === 6) {
            const tol = clamp((g.removeTolerance ?? 15) / 100, 0.01, 1)
            filters.push(`colorkey=0x${c}:${tol.toFixed(3)}:0.1`)
        }
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

    // Overlay text on top (drawtext). Position defaults to bottom-center.
    if (g.overlayText && g.overlayText.trim()) {
        const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/%/g, '\\%')
        const text = escape(g.overlayText.trim())
        const x = g.overlayTextX || '(w-text_w)/2'
        const y = g.overlayTextY || 'h-(text_h*2)'
        filters.push(`drawtext=text='${text}':x=${x}:y=${y}:fontsize=36:fontcolor=white:box=1:boxcolor=black@0.35:boxborderw=8`)
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
        const args: string[] = []
        if (g.trimStart) args.push('-ss', g.trimStart)
        if (g.trimEnd) args.push('-to', g.trimEnd)
        args.push('-i', inputName)
        if (filters.length > 0) {
            const filterChain = filters.join(',')
            // eslint-disable-next-line no-console
            console.info('[ffmpeg.wasm -vf]', filterChain)
            args.push('-vf', filterChain)
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
