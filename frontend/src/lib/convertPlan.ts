// ──────────────────────────────────────────────────────────
// "Convertir" page: options model and the per-file job plan (where to run it
// and which parameters the server gets).
//
// The main card shows the common choices; "Réglages avancés" exposes every
// parameter the backend understands. Everything set applies, whether the
// advanced block is open or not (advancedCount tells how many are active).
// ──────────────────────────────────────────────────────────
import type { JobPlan } from '@/hooks/useQueue'
import { BROWSER_DECODABLE, BROWSER_ENCODABLE, processImageInBrowser } from '@/lib/clientProcessor'
import type { ProcessingPreference } from '@/lib/settings'
import { AUDIO_FORMATS, extOf, type QueueItem } from '@/types'

export type VideoQuality = 'high' | 'balanced' | 'small' | 'size' | 'crf' | 'bitrate' | 'percent'
export type VideoCodec = 'libx264' | 'libx265' | 'libvpx-vp9' | 'libaom-av1'
export type Rotate = 'none' | '90' | '180' | '270' | 'hflip' | 'vflip'
export type TextPosition = 'bottom' | 'top' | 'center' | 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right'

export interface ConvertOptions {
    advanced: boolean
    // ── Vidéo : encodage
    videoQuality: VideoQuality
    videoTargetMb: string
    videoPercent: number
    videoCrf: number
    videoBitrateK: string
    twoPass: boolean
    videoCodec: VideoCodec
    videoPreset: string
    videoProfile: 'auto' | 'baseline' | 'main' | 'high'
    videoTune: string
    pixelFormat: 'auto' | 'yuv420p' | 'yuv422p' | 'yuv444p' | 'yuv420p10le'
    // ── Vidéo : image
    resizeMode: 'max' | 'exact'
    videoMaxHeight: string
    resizeWidth: string
    resizeHeight: string
    videoFps: string
    rotate: Rotate
    cropTop: string
    cropBottom: string
    cropLeft: string
    cropRight: string
    deinterlace: boolean
    denoise: 'none' | 'light' | 'medium' | 'strong'
    hdr: 'auto' | 'off'
    overlayText: string
    overlayPosition: TextPosition
    removeAudio: boolean
    // ── Son
    audioBitrate: string
    audioCopy: boolean
    audioSampleRate: string
    audioChannels: string
    audioVolume: number
    audioNormalize: boolean
    // ── GIF
    gifWidth: string
    gifFps: string
    gifSpeed: string
    gifColors: number
    gifDither: string
    gifLoop: string
    // ── Images
    imageQuality: number
    imageLossless: boolean
    imageResizeMode: 'max' | 'percent'
    imageMaxSize: string
    imagePercent: number
    imageUpscale: string
    imageTargetMb: string
    icoSize: string
    // ── Divers
    trimStart: string
    trimEnd: string
    slideshow: boolean
    slideshowFormat: 'mp4' | 'webm' | 'gif'
    slideshowFps: string
    frameFps: string
}

export const DEFAULT_CONVERT_OPTIONS: ConvertOptions = {
    advanced: false,
    videoQuality: 'balanced',
    videoTargetMb: '25',
    videoPercent: 50,
    videoCrf: 23,
    videoBitrateK: '4000',
    twoPass: false,
    videoCodec: 'libx264',
    videoPreset: '',
    videoProfile: 'auto',
    videoTune: 'none',
    pixelFormat: 'auto',
    resizeMode: 'max',
    videoMaxHeight: '',
    resizeWidth: '',
    resizeHeight: '',
    videoFps: '',
    rotate: 'none',
    cropTop: '',
    cropBottom: '',
    cropLeft: '',
    cropRight: '',
    deinterlace: false,
    denoise: 'none',
    hdr: 'auto',
    overlayText: '',
    overlayPosition: 'bottom',
    removeAudio: false,
    audioBitrate: '192k',
    audioCopy: false,
    audioSampleRate: '',
    audioChannels: '',
    audioVolume: 0,
    audioNormalize: false,
    gifWidth: '480',
    gifFps: '15',
    gifSpeed: '1',
    gifColors: 256,
    gifDither: 'sierra2_4a',
    gifLoop: '0',
    imageQuality: 90,
    imageLossless: false,
    imageResizeMode: 'max',
    imageMaxSize: '',
    imagePercent: 50,
    imageUpscale: '1',
    imageTargetMb: '',
    icoSize: '256',
    trimStart: '',
    trimEnd: '',
    slideshow: false,
    slideshowFormat: 'mp4',
    slideshowFps: '1',
    frameFps: '1',
}

/** Settings that only exist in the advanced block. */
const ADVANCED_ONLY: (keyof ConvertOptions)[] = [
    'videoCrf', 'videoBitrateK', 'videoPercent', 'twoPass', 'videoPreset', 'videoProfile', 'videoTune', 'pixelFormat',
    'resizeMode', 'resizeWidth', 'resizeHeight', 'cropTop', 'cropBottom', 'cropLeft', 'cropRight',
    'deinterlace', 'denoise', 'hdr', 'overlayText', 'overlayPosition',
    'audioCopy', 'audioSampleRate', 'audioChannels', 'audioVolume',
    'gifDither', 'gifLoop', 'imageLossless', 'imageResizeMode', 'imagePercent', 'imageTargetMb', 'icoSize',
]

const SIMPLE_VIDEO_QUALITY: VideoQuality[] = ['high', 'balanced', 'small', 'size']
export const SIMPLE_VIDEO_FPS = ['', '60', '30', '25', '24']
export const SIMPLE_AUDIO_BITRATES = ['128k', '192k', '256k', '320k']
export const SIMPLE_GIF_COLORS = [64, 128, 256]

function differs(o: ConvertOptions, key: keyof ConvertOptions): boolean {
    return o[key] !== DEFAULT_CONVERT_OPTIONS[key]
}

/** How many advanced settings currently differ from their default. */
export function advancedCount(o: ConvertOptions): number {
    let n = 0
    for (const key of ADVANCED_ONLY) {
        if (key === 'videoCrf' || key === 'videoBitrateK' || key === 'videoPercent' || key === 'twoPass') continue
        if (key === 'overlayPosition' || key === 'resizeWidth' || key === 'resizeHeight' || key === 'imagePercent') continue
        if (differs(o, key)) n++
    }
    if (!SIMPLE_VIDEO_QUALITY.includes(o.videoQuality)) n++
    if (o.videoCodec === 'libvpx-vp9' || o.videoCodec === 'libaom-av1') n++
    if (o.rotate === 'vflip') n++
    if (!SIMPLE_VIDEO_FPS.includes(o.videoFps)) n++
    if (!SIMPLE_AUDIO_BITRATES.includes(o.audioBitrate)) n++
    if (!SIMPLE_GIF_COLORS.includes(o.gifColors)) n++
    return n
}

/** Back to defaults for everything that lives in the advanced block. */
export function resetAdvanced(o: ConvertOptions): ConvertOptions {
    const next = { ...o } as unknown as Record<string, unknown>
    const d = DEFAULT_CONVERT_OPTIONS as unknown as Record<string, unknown>
    for (const key of ADVANCED_ONLY) next[key] = d[key]
    const e = next as unknown as ConvertOptions
    if (!SIMPLE_VIDEO_QUALITY.includes(e.videoQuality)) e.videoQuality = 'balanced'
    if (e.videoCodec !== 'libx264' && e.videoCodec !== 'libx265') e.videoCodec = 'libx264'
    if (e.rotate === 'vflip') e.rotate = 'none'
    if (!SIMPLE_VIDEO_FPS.includes(e.videoFps)) e.videoFps = ''
    if (!SIMPLE_AUDIO_BITRATES.includes(e.audioBitrate)) e.audioBitrate = '192k'
    if (!SIMPLE_GIF_COLORS.includes(e.gifColors)) e.gifColors = 256
    return e
}

const CODEC_CONTAINERS: Record<VideoCodec, Set<string>> = {
    libx264: new Set(['mp4', 'mov', 'mkv', 'm4v', 'ts', 'flv', 'avi']),
    libx265: new Set(['mp4', 'mov', 'mkv', 'm4v', 'ts']),
    'libvpx-vp9': new Set(['webm', 'mkv', 'mp4']),
    'libaom-av1': new Set(['webm', 'mkv', 'mp4']),
}

export function codecFits(codec: VideoCodec, container: string): boolean {
    return CODEC_CONTAINERS[codec].has(container)
}

const TEXT_POSITIONS: Record<TextPosition, [string, string]> = {
    bottom: ['(w-text_w)/2', 'h-(text_h*2)'],
    top: ['(w-text_w)/2', 'text_h'],
    center: ['(w-text_w)/2', '(h-text_h)/2'],
    'bottom-left': ['text_h', 'h-(text_h*2)'],
    'bottom-right': ['w-text_w-text_h', 'h-(text_h*2)'],
    'top-left': ['text_h', 'text_h'],
    'top-right': ['w-text_w-text_h', 'text_h'],
}

const num = (s: string) => {
    const n = parseFloat(s.replace(',', '.'))
    return Number.isFinite(n) && n > 0 ? n : 0
}

function trimFields(o: ConvertOptions): Record<string, string> {
    const f: Record<string, string> = {}
    if (o.trimStart.trim()) f.trim_start = o.trimStart.trim()
    if (o.trimEnd.trim()) f.trim_end = o.trimEnd.trim()
    return f
}

function audioFields(o: ConvertOptions, forVideo: boolean): Record<string, string> {
    const f: Record<string, string> = {}
    if (forVideo && o.audioCopy) {
        f.audio_codec = 'copy'
        return f
    }
    f.audio_bitrate = o.audioBitrate
    if (o.audioSampleRate) f.audio_sample_rate = o.audioSampleRate
    if (o.audioChannels) f.audio_channels = o.audioChannels
    if (o.audioVolume) f.audio_volume = String(o.audioVolume)
    if (o.audioNormalize) f.audio_normalize = '1'
    return f
}

function videoFields(o: ConvertOptions, fmt: string): Record<string, string> {
    const f: Record<string, string> = { ...trimFields(o) }
    if (o.videoQuality === 'high' || o.videoQuality === 'balanced' || o.videoQuality === 'small') f.video_quality = o.videoQuality
    if (o.videoQuality === 'crf') f.video_crf = String(Math.round(o.videoCrf))
    if (o.videoQuality === 'bitrate' && num(o.videoBitrateK)) {
        f.video_quality_mode = 'bitrate'
        f.video_bitrate_k = String(Math.round(num(o.videoBitrateK)))
        if (o.twoPass) f.two_pass = '1'
    }
    if (codecFits(o.videoCodec, fmt)) f.video_codec = o.videoCodec
    if (o.videoPreset) f.video_preset = o.videoPreset
    if (o.videoProfile !== 'auto') f.video_profile = o.videoProfile
    if (o.videoTune !== 'none') f.video_tune = o.videoTune
    if (o.pixelFormat !== 'auto') f.video_pixel_format = o.pixelFormat
    if (o.resizeMode === 'exact' && (num(o.resizeWidth) || num(o.resizeHeight))) {
        if (num(o.resizeWidth)) f.video_resize_width = String(Math.round(num(o.resizeWidth)))
        if (num(o.resizeHeight)) f.video_resize_height = String(Math.round(num(o.resizeHeight)))
    } else if (o.videoMaxHeight) {
        f.video_max_height = o.videoMaxHeight
    }
    if (num(o.videoFps)) f.fps = String(num(o.videoFps))
    if (o.rotate !== 'none') f.rotate = o.rotate
    for (const [key, value] of [['crop_top', o.cropTop], ['crop_bottom', o.cropBottom], ['crop_left', o.cropLeft], ['crop_right', o.cropRight]]) {
        if (num(value)) f[key] = String(Math.round(num(value)))
    }
    if (o.deinterlace) f.deinterlace = '1'
    if (o.denoise !== 'none') f.denoise = o.denoise
    if (o.hdr === 'off') f.hdr_to_sdr = '0'
    if (o.overlayText.trim()) {
        const [x, y] = TEXT_POSITIONS[o.overlayPosition]
        f.overlay_text = o.overlayText.trim()
        f.overlay_text_x = x
        f.overlay_text_y = y
    }
    if (o.removeAudio) f.remove_audio = '1'
    else Object.assign(f, audioFields(o, true))
    return f
}

/** True when a video job only uses what the in-browser encoder supports. */
function browserVideoCompatible(o: ConvertOptions): boolean {
    const d = DEFAULT_CONVERT_OPTIONS
    return (o.videoQuality === 'high' || o.videoQuality === 'balanced' || o.videoQuality === 'small')
        && o.videoCodec === 'libx264' && !o.trimStart && !o.trimEnd && o.rotate === 'none' && !o.videoFps
        && !o.audioNormalize && o.resizeMode === d.resizeMode && !o.cropTop && !o.cropBottom && !o.cropLeft
        && !o.cropRight && !o.deinterlace && o.denoise === 'none' && !o.overlayText.trim()
        && o.pixelFormat === 'auto' && !o.videoPreset && o.videoProfile === 'auto' && o.videoTune === 'none'
        && !o.audioCopy && !o.audioSampleRate && !o.audioChannels && !o.audioVolume
}

export function planForItem(item: QueueItem, o: ConvertOptions, processing: ProcessingPreference): JobPlan {
    const fmt = item.targetFormat
    const src = extOf(item.name)

    switch (item.kind) {
        case 'video': {
            if (fmt === 'gif') {
                const speed = num(o.gifSpeed) || 1
                const fields: Record<string, string> = {
                    ...trimFields(o), gif_fps: o.gifFps, gif_speed: (1 / speed).toFixed(3),
                    gif_colors: String(o.gifColors), gif_dither: o.gifDither, gif_loop: o.gifLoop,
                }
                if (o.gifWidth !== '0') fields.gif_width = o.gifWidth
                else fields.gif_resolution = '-1'
                return { server: { action: 'convert', format: 'gif', fields } }
            }
            if (AUDIO_FORMATS.has(fmt)) {
                return { server: { action: 'convert', format: fmt, fields: { ...trimFields(o), ...audioFields(o, false) } } }
            }
            if (fmt === 'zip') {
                return { server: { action: 'convert', format: 'zip', fields: { ...trimFields(o), sequence_fps: o.frameFps } } }
            }
            const fields = videoFields(o, fmt)
            const sizeTarget = o.videoQuality === 'size' && num(o.videoTargetMb) > 0
            const percent = o.videoQuality === 'percent'
            const plan: JobPlan = {
                server: sizeTarget
                    ? { action: 'convert_compress', format: fmt, fields: { ...fields, comp_mode: 'size', comp_value: String(num(o.videoTargetMb)) } }
                    : percent
                        ? { action: 'convert_compress', format: fmt, fields: { ...fields, comp_mode: 'percent', comp_value: String(o.videoPercent) } }
                        : { action: 'convert', format: fmt, fields },
            }
            if (processing === 'browser' && browserVideoCompatible(o)) {
                plan.local = {
                    run: async ({ file, onProgress }) => {
                        const { processVideoInBrowser } = await import('@/lib/clientVideoProcessor')
                        const crf = { high: 20, balanced: 23, small: 28 }[o.videoQuality as 'high' | 'balanced' | 'small']
                        return processVideoInBrowser(file, fmt, {
                            crf, maxHeight: parseInt(o.videoMaxHeight, 10) || 0, removeAudio: o.removeAudio, onProgress,
                        })
                    },
                }
            }
            return plan
        }
        case 'audio':
            return { server: { action: 'convert', format: fmt, fields: { ...trimFields(o), ...audioFields(o, false) } } }
        case 'image': {
            const fields: Record<string, string> = { image_quality: String(o.imageQuality) }
            if (o.imageResizeMode === 'percent' && o.imagePercent !== 100) {
                fields.image_resize_mode = 'percent'
                fields.image_resize_percent = String(o.imagePercent)
            } else if (o.imageMaxSize) {
                fields.image_resize_mode = 'dimension'
                fields.image_max_size = o.imageMaxSize
            }
            if (o.imageUpscale !== '1') fields.image_upscale = o.imageUpscale
            if (o.imageLossless && fmt === 'webp') fields.lossless = '1'
            if (fmt === 'ico') fields.ico_size = o.icoSize
            const target = num(o.imageTargetMb)
            const plan: JobPlan = target && ['jpg', 'jpeg', 'webp', 'png', 'avif'].includes(fmt)
                ? { server: { action: 'convert_compress', format: fmt, fields: { ...fields, comp_mode: 'size', comp_value: String(target) } } }
                : { server: { action: 'convert', format: fmt, fields } }
            const browserOk = o.imageUpscale === '1' && !target && !(o.imageLossless && fmt === 'webp')
                && !(o.imageResizeMode === 'percent' && o.imagePercent !== 100) && fmt !== 'ico'
            if (processing !== 'server' && browserOk && BROWSER_DECODABLE.has(src) && BROWSER_ENCODABLE.has(fmt)) {
                plan.local = {
                    run: ({ file }) => processImageInBrowser(file, fmt, {
                        quality: o.imageQuality,
                        maxSide: parseInt(o.imageMaxSize, 10) || 0,
                    }),
                }
            }
            return plan
        }
        case 'pdf':
            return fmt === 'pdf'
                ? { server: { action: 'compress', format: '', fields: { comp_mode: 'crf', comp_value: 'high' } } }
                : { server: { action: 'convert', format: fmt, fields: {} } }
        case 'sequence':
            return { server: { action: 'convert', format: fmt, fields: { sequence_fps: o.slideshowFps } } }
        case 'document':
        case '3d':
            return { server: { action: 'convert', format: fmt, fields: {} } }
        default:
            return {}
    }
}
