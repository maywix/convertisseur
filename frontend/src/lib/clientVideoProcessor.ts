// ──────────────────────────────────────────────────────────
// Optional in-browser video conversion with ffmpeg.wasm (settings →
// "Navigateur"). The server is faster and handles any size; this path exists
// to avoid uploading through a slow tunnel. Every failure throws so the
// caller can fall back to the server — never return an empty file.
// ──────────────────────────────────────────────────────────
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'
// Self-hosted core (served by our own server, cached by Cloudflare): no
// dependency on a public CDN that may be blocked or slow.
import coreURL from '@ffmpeg/core?url'
import wasmURL from '@ffmpeg/core/wasm?url'
import { parseCubeLut, serializeCubeLut } from './cubeLut'
import { gradeToServerFields, type Grade } from './grade'

/** ffmpeg.wasm keeps input + output in memory: stay well under the wasm heap. */
export const BROWSER_VIDEO_MAX_BYTES = 700 * 1024 * 1024
export const BROWSER_VIDEO_FORMATS = new Set(['mp4', 'mov', 'mkv', 'm4v', 'webm', 'gif'])

let ffmpegInstance: FFmpeg | null = null
let loadingPromise: Promise<FFmpeg> | null = null
const recentLogs: string[] = []

async function getFFmpeg(onStatus?: (msg: string) => void): Promise<FFmpeg> {
    if (ffmpegInstance) return ffmpegInstance
    if (loadingPromise) return loadingPromise

    loadingPromise = (async () => {
        const inst = new FFmpeg()
        inst.on('log', ({ message }) => {
            recentLogs.push(message)
            if (recentLogs.length > 40) recentLogs.shift()
        })
        onStatus?.('Chargement du moteur vidéo (~30 Mo, mis en cache ensuite)…')
        // Single-thread core: the multi-thread build is faster but hangs or
        // aborts on long encodes, which produced empty (0 KB) files.
        await inst.load({ coreURL, wasmURL })
        ffmpegInstance = inst
        return inst
    })()
    try {
        return await loadingPromise
    } catch (e) {
        loadingPromise = null
        throw e
    }
}

function lastError(): string {
    const useful = recentLogs.filter((l) => /error|invalid|failed|unable|not found/i.test(l))
    return (useful.slice(-2).join(' | ') || 'ffmpeg.wasm a échoué').slice(0, 300)
}

/** The same filter chain the backend builds (see app.py _grading_filters). */
function buildFilters(grade: Grade | null, hasLut: boolean, maxHeight: number): string[] {
    const filters: string[] = []
    if (hasLut) filters.push('lut3d=file=grade.cube')
    if (grade) {
        const f = gradeToServerFields(grade, 'video')
        const n = (k: string) => parseFloat(f[k] ?? '0') || 0
        const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
        const temp = n('video_temperature') / 100
        const tint = n('video_tint') / 100
        if (temp || tint) {
            const r = (1 + temp * 0.22) * (1 + tint * 0.08)
            const g = (1 - temp * 0.04) * (1 - tint * 0.18)
            const b = (1 - temp * 0.22) * (1 + tint * 0.08)
            filters.push(`lutrgb=r='clip(val*${r.toFixed(4)},0,255)':g='clip(val*${g.toFixed(4)},0,255)':b='clip(val*${b.toFixed(4)},0,255)'`)
        }
        if (n('video_exposure')) filters.push(`eq=brightness=${(n('video_exposure') * 0.25).toFixed(3)}`)
        const hl = n('video_highlights'), sh = n('video_shadows'), wh = n('video_whites'), bl = n('video_blacks')
        if (hl || sh || wh || bl) {
            const M = 0.3
            let pBlack = 0, pShadow = 0.25, pHigh = 0.75, pWhite = 1
            pHigh = clamp(pHigh + (hl / 100) * M, 0, 1)
            pShadow = clamp(pShadow + (sh / 100) * M, 0, 1)
            if (wh > 0) pHigh = clamp(pHigh + (wh / 100) * M * 0.5, 0, 1)
            else if (wh < 0) pWhite = clamp(pWhite + (wh / 100) * M, 0, 1)
            if (bl > 0) pShadow = clamp(pShadow - (bl / 100) * M * 0.5, 0, 1)
            else if (bl < 0) pBlack = clamp(pBlack - (bl / 100) * M, 0, 1)
            filters.push(`curves=all='0/${pBlack.toFixed(3)} 0.25/${pShadow.toFixed(3)} 0.5/0.500 0.75/${pHigh.toFixed(3)} 1/${pWhite.toFixed(3)}'`)
        }
        const cb: string[] = []
        for (const [zone, p] of [['lift', 's'], ['gamma', 'm'], ['gain', 'h']] as const) {
            const hex = f[`video_${zone}_color`]
            if (!hex) continue
            const amount = parseFloat(f[`video_${zone}_amount`] ?? '1')
            const c = hex.replace('#', '')
            const [r, g, b] = [0, 2, 4].map((i) => clamp(((parseInt(c.slice(i, i + 2), 16) - 128) / 127) * amount, -1, 1))
            cb.push(`r${p}=${r.toFixed(3)}:g${p}=${g.toFixed(3)}:b${p}=${b.toFixed(3)}`)
        }
        if (cb.length) filters.push(`colorbalance=${cb.join(':')}`)
        if (n('video_contrast') || n('video_saturation')) {
            filters.push(`eq=contrast=${(1 + n('video_contrast') / 100).toFixed(3)}:saturation=${(1 + n('video_saturation') / 100).toFixed(3)}`)
        }
        if (n('video_hue')) filters.push(`hue=h=${n('video_hue').toFixed(1)}`)
        if (n('video_sharpness')) filters.push(`unsharp=5:5:${((n('video_sharpness') / 100) * 2).toFixed(2)}:5:5:0.0`)
        if (n('video_vignette')) filters.push(`vignette=angle=${((n('video_vignette') / 100) * (Math.PI / 4)).toFixed(3)}:mode=forward`)
        if (n('video_grain')) filters.push(`noise=alls=${Math.round(n('video_grain') * 0.6)}:allf=t+u`)
        if (n('video_chromatic')) {
            const px = Math.round(n('video_chromatic'))
            filters.push(`rgbashift=rh=${px}:rv=0:bh=-${px}:bv=0`)
        }
        if (n('video_glow')) filters.push(`gblur=sigma=${(1 + (n('video_glow') / 100) * 4).toFixed(2)}:steps=1`)
    }
    if (maxHeight > 0) {
        filters.push(`scale=w='if(gt(iw,ih),-2,min(iw,${maxHeight}))':h='if(gt(iw,ih),min(ih,${maxHeight}),-2)'`)
    }
    return filters
}

export interface BrowserVideoOptions {
    grade?: Grade | null
    lutFile?: File | null
    maxHeight?: number
    crf?: number
    removeAudio?: boolean
    onProgress?: (ratio: number) => void
    onStatus?: (msg: string) => void
}

export async function processVideoInBrowser(
    file: File,
    outputFormat: string,
    opts: BrowserVideoOptions = {},
): Promise<{ blob: Blob; filename: string }> {
    const fmt = outputFormat.toLowerCase()
    if (!BROWSER_VIDEO_FORMATS.has(fmt)) throw new Error(`format ${fmt} non géré dans le navigateur`)
    if (file.size > BROWSER_VIDEO_MAX_BYTES) throw new Error('fichier trop gros pour le navigateur')

    const ffmpeg = await getFFmpeg(opts.onStatus)
    const grade = opts.grade ?? null
    const inputName = `in.${file.name.split('.').pop() || 'mp4'}`
    const outputName = `out.${fmt}`

    let hasLut = false
    if (opts.lutFile) {
        // Same normalisation as the server: Resolve LUTs break FFmpeg's parser.
        const lut = parseCubeLut(await opts.lutFile.text())
        await ffmpeg.writeFile('grade.cube', serializeCubeLut(lut))
        hasLut = true
    }
    await ffmpeg.writeFile(inputName, await fetchFile(file))

    const onProgress = ({ progress }: { progress: number }) => {
        if (progress >= 0 && progress <= 1) opts.onProgress?.(progress)
    }
    ffmpeg.on('progress', onProgress)
    recentLogs.length = 0

    try {
        const args: string[] = []
        if (grade?.trimStart.trim()) args.push('-ss', grade.trimStart.trim())
        if (grade?.trimEnd.trim()) args.push('-to', grade.trimEnd.trim())
        args.push('-i', inputName, '-map', '0:V:0')
        const filters = buildFilters(grade, hasLut, opts.maxHeight ?? 0)

        if (fmt === 'gif') {
            filters.push('fps=15', "scale='min(iw,480)':-1:flags=lanczos", 'split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=sierra2_4a')
            args.push('-vf', filters.join(','), '-loop', '0')
        } else {
            if (grade?.overlayText.trim()) {
                // No font in the wasm build: leave text overlays to the server.
                throw new Error('texte incrusté : rendu serveur')
            }
            if (filters.length) args.push('-vf', filters.join(','))
            if (grade?.targetFps) args.push('-r', String(grade.targetFps))
            const crf = String(opts.crf ?? 23)
            if (fmt === 'webm') args.push('-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String((opts.crf ?? 23) + 10), '-deadline', 'realtime', '-cpu-used', '8')
            else args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', crf)
            args.push('-pix_fmt', 'yuv420p')
            if (opts.removeAudio) args.push('-an')
            else args.push('-map', '0:a:0?', '-c:a', fmt === 'webm' ? 'libopus' : 'aac', '-b:a', '160k')
            if (fmt === 'mp4' || fmt === 'mov' || fmt === 'm4v') args.push('-movflags', '+faststart')
        }
        args.push('-y', outputName)

        const code = await ffmpeg.exec(args)
        if (code !== 0) throw new Error(lastError())

        const data = await ffmpeg.readFile(outputName)
        const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data))
        if (bytes.byteLength === 0) throw new Error('ffmpeg.wasm a produit un fichier vide')
        const mime =
            fmt === 'webm' ? 'video/webm' :
            fmt === 'mkv' ? 'video/x-matroska' :
            fmt === 'mov' ? 'video/quicktime' :
            fmt === 'gif' ? 'image/gif' :
            'video/mp4'
        const base = file.name.replace(/\.[^.]+$/, '')
        return { blob: new Blob([new Uint8Array(bytes)], { type: mime }), filename: `${base}.${fmt}` }
    } finally {
        ffmpeg.off('progress', onProgress)
        for (const name of [inputName, outputName, 'grade.cube']) {
            try { await ffmpeg.deleteFile(name) } catch { /* not created */ }
        }
    }
}
