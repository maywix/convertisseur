// ──────────────────────────────────────────────────────────
// "Convertir" page: options model and the per-file job plan (where to run it
// and which parameters the server gets).
//
// "Simple" mode applies a one-click preset; "Pro" mode works in steps:
// action (convertir / compresser / les deux), output type, output format,
// then every option of that type as dropdowns.
// ──────────────────────────────────────────────────────────
import type { JobPlan } from '@/hooks/useQueue'
import { BROWSER_DECODABLE, BROWSER_ENCODABLE, processImageInBrowser } from '@/lib/clientProcessor'
import type { MetadataPreference, ProcessingPreference } from '@/lib/settings'
import { AUDIO_FORMATS, FORMATS, VIDEO_STILL_FORMATS, extOf, type FormatOption, type MediaKind, type QueueItem } from '@/types'

export type VideoQuality = 'high' | 'balanced' | 'small' | 'crf' | 'bitrate'
export type Action = 'convert' | 'compress' | 'convert_compress'
/** Output type picked in step 2 ("Audio" also turns videos into sound files). */
export type Category = 'video' | 'audio' | 'image' | 'slideshow' | 'document' | '3d'
export type CompressMode = 'level' | 'size' | 'percent'
export type CompressLevel = 'low' | 'medium' | 'high'
export type VideoCodec = 'libx264' | 'libx265' | 'libvpx-vp9' | 'libaom-av1'
export type Rotate = 'none' | '90' | '180' | '270' | 'hflip' | 'vflip'
export type TextPosition = 'bottom' | 'top' | 'center' | 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right'

export interface ConvertOptions {
    action: Action
    category: Category | null
    // ── Compression (Compresser / Convertir + compresser)
    compressMode: CompressMode
    compressLevel: CompressLevel
    compressTargetMb: string
    compressPercent: number
    // ── Vidéo : encodage
    videoQuality: VideoQuality
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
    /** Centre crop to an aspect ratio ("9:16"…), '' = unchanged. */
    aspect: string
    /** Playback speed of videos and sounds ("2" = twice as fast). */
    speed: string
    /** Video → still image: when (s or h:mm:ss), '' = automatic. */
    captureAt: string
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
    action: 'convert',
    category: null,
    compressMode: 'level',
    compressLevel: 'medium',
    compressTargetMb: '25',
    compressPercent: 50,
    videoQuality: 'balanced',
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
    aspect: '',
    speed: '1',
    captureAt: '',
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

// ── Steps: output types and their formats ─────────────────

/** Which files each output type applies to. */
export const CATEGORY_KINDS: Record<Category, MediaKind[]> = {
    video: ['video'],
    audio: ['audio', 'video'],
    image: ['image'],
    slideshow: ['image'],
    document: ['document', 'pdf'],
    '3d': ['3d'],
}

export const CATEGORY_FORMATS: Record<Category, FormatOption[]> = {
    video: FORMATS.video.filter((f) => !AUDIO_FORMATS.has(f.value)),
    audio: FORMATS.audio,
    image: FORMATS.image,
    slideshow: FORMATS.video.filter((f) => ['mp4', 'webm', 'gif'].includes(f.value)),
    document: [{ value: 'pdf', label: 'PDF' }],
    '3d': FORMATS['3d'],
}

const KIND_CATEGORY: Record<MediaKind, Category> = {
    video: 'video', audio: 'audio', image: 'image', pdf: 'document', document: 'document', '3d': '3d',
}

/** Output type of one file, from its kind and target format. */
export function categoryOfItem(item: QueueItem): Category | null {
    if (item.kind === 'unknown') return null
    if (item.kind === 'sequence') return 'slideshow'
    if (item.kind === 'video' && AUDIO_FORMATS.has(item.targetFormat)) return 'audio'
    return KIND_CATEGORY[item.kind]
}

/** Output type to preselect for a queue: videos first, else the first file decides. */
export function inferCategory(items: QueueItem[]): Category | null {
    if (items.some((it) => it.kind === 'video' && !AUDIO_FORMATS.has(it.targetFormat))) return 'video'
    for (const it of items) {
        const c = categoryOfItem(it)
        if (c) return c
    }
    return null
}

/** Groups of options, in display order. "timing" = cut + playback speed. */
export type GroupKey = 'video' | 'gif' | 'frames' | 'capture' | 'image' | 'audio' | 'slideshow' | 'trim' | 'timing'

export function groupsFor(category: Category | null, format: string, o: ConvertOptions): GroupKey[] {
    const withAudio = !o.removeAudio && !o.audioCopy
    switch (category) {
        case 'video':
            if (format === 'gif') return ['gif', 'trim']
            if (format === 'zip') return ['frames', 'trim']
            if (VIDEO_STILL_FORMATS.has(format)) return ['capture']
            return withAudio ? ['video', 'audio', 'timing'] : ['video', 'timing']
        case 'audio':
            return ['audio', 'timing']
        case 'image':
            return ['image']
        case 'slideshow':
            return ['slideshow']
        default:
            return []
    }
}

/** "Compresser" keeps each file's format: options of every kind present. */
export function groupsForKinds(kinds: MediaKind[], o: ConvertOptions): GroupKey[] {
    const out: GroupKey[] = []
    if (kinds.includes('video')) out.push('video')
    if (kinds.includes('image')) out.push('image')
    if ((kinds.includes('video') && !o.removeAudio && !o.audioCopy) || kinds.includes('audio')) out.push('audio')
    if (kinds.includes('video') || kinds.includes('audio')) out.push('timing')
    return out
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

const LEVEL_VIDEO_QUALITY: Record<CompressLevel, string> = { low: 'balanced', medium: 'small', high: 'tiny' }
const LEVEL_IMAGE_QUALITY: Record<CompressLevel, number> = { low: 85, medium: 70, high: 50 }

function compressFields(o: ConvertOptions): Record<string, string> {
    if (o.compressMode === 'size' && num(o.compressTargetMb)) return { comp_mode: 'size', comp_value: String(num(o.compressTargetMb)) }
    if (o.compressMode === 'percent') return { comp_mode: 'percent', comp_value: String(o.compressPercent) }
    return { comp_mode: 'crf', comp_value: o.compressLevel }
}

function trimFields(o: ConvertOptions): Record<string, string> {
    const f: Record<string, string> = {}
    if (o.trimStart.trim()) f.trim_start = o.trimStart.trim()
    if (o.trimEnd.trim()) f.trim_end = o.trimEnd.trim()
    return f
}

/** Cut + playback speed (videos and sounds). */
function timingFields(o: ConvertOptions): Record<string, string> {
    const f = trimFields(o)
    if (num(o.speed) && num(o.speed) !== 1) f.speed = String(num(o.speed))
    return f
}

function audioFields(o: ConvertOptions, forVideo: boolean, compressing = false): Record<string, string> {
    const f: Record<string, string> = {}
    if (forVideo && o.audioCopy) {
        f.audio_codec = 'copy'
        return f
    }
    // When compressing, the server picks the bitrate from the target.
    if (!compressing) f.audio_bitrate = o.audioBitrate
    if (o.audioSampleRate) f.audio_sample_rate = o.audioSampleRate
    if (o.audioChannels) f.audio_channels = o.audioChannels
    if (o.audioVolume) f.audio_volume = String(o.audioVolume)
    if (o.audioNormalize) f.audio_normalize = '1'
    return f
}

function videoFields(o: ConvertOptions, fmt: string, compressing = false): Record<string, string> {
    const f: Record<string, string> = { ...timingFields(o) }
    if (compressing) {
        // The compression target decides the quality.
        if (o.compressMode === 'level') f.video_quality = LEVEL_VIDEO_QUALITY[o.compressLevel]
    } else if (o.videoQuality === 'high' || o.videoQuality === 'balanced' || o.videoQuality === 'small') {
        f.video_quality = o.videoQuality
    } else if (o.videoQuality === 'crf') {
        f.video_crf = String(Math.round(o.videoCrf))
    } else if (o.videoQuality === 'bitrate' && num(o.videoBitrateK)) {
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
    if (o.aspect) f.aspect = o.aspect
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
    else Object.assign(f, audioFields(o, true, compressing))
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
        && !o.aspect && (num(o.speed) || 1) === 1
}

/** JPEG photos carry the date / camera / location: the browser path would drop them. */
const CAMERA_PHOTO_EXTS = new Set(['jpg', 'jpeg'])

export function planForItem(
    item: QueueItem,
    o: ConvertOptions,
    processing: ProcessingPreference,
    metadata: MetadataPreference = 'nogps',
): JobPlan {
    const compressing = o.action !== 'convert'
    // "Compresser" keeps the file's own format (the server keeps its extension).
    const keepFormat = o.action === 'compress'
    const fmt = keepFormat ? extOf(item.name) : item.targetFormat
    const format = keepFormat ? '' : fmt
    const action = o.action
    const comp = compressing ? compressFields(o) : {}
    const src = extOf(item.name)

    switch (item.kind) {
        case 'video': {
            if (!keepFormat && fmt === 'gif') {
                const speed = num(o.gifSpeed) || 1
                const fields: Record<string, string> = {
                    ...trimFields(o), gif_fps: o.gifFps, gif_speed: (1 / speed).toFixed(3),
                    gif_colors: String(o.gifColors), gif_dither: o.gifDither, gif_loop: o.gifLoop,
                }
                if (o.gifWidth !== '0') fields.gif_width = o.gifWidth
                else fields.gif_resolution = '-1'
                if (o.aspect) fields.aspect = o.aspect
                return { server: { action: 'convert', format: 'gif', fields } }
            }
            if (!keepFormat && fmt === 'zip') {
                return { server: { action: 'convert', format: 'zip', fields: { ...trimFields(o), sequence_fps: o.frameFps } } }
            }
            if (!keepFormat && VIDEO_STILL_FORMATS.has(fmt)) {
                const fields: Record<string, string> = {}
                if (o.captureAt.trim()) fields.capture_at = o.captureAt.trim()
                if (o.aspect) fields.aspect = o.aspect
                if (o.rotate !== 'none') fields.rotate = o.rotate
                if (o.videoMaxHeight) fields.video_max_height = o.videoMaxHeight
                return { server: { action: 'convert', format: fmt, fields } }
            }
            if (AUDIO_FORMATS.has(fmt)) {
                return { server: { action, format, fields: { ...timingFields(o), ...audioFields(o, false, compressing), ...comp } } }
            }
            const plan: JobPlan = { server: { action, format, fields: { ...videoFields(o, fmt, compressing), ...comp } } }
            if (!compressing && processing === 'browser' && browserVideoCompatible(o)) {
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
            return { server: { action, format, fields: { ...timingFields(o), ...audioFields(o, false, compressing), ...comp } } }
        case 'image': {
            const fields: Record<string, string> = {
                image_quality: String(compressing ? LEVEL_IMAGE_QUALITY[o.compressLevel] : o.imageQuality),
            }
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
            if (compressing) return { server: { action, format, fields: { ...fields, ...comp } } }
            const target = num(o.imageTargetMb)
            const plan: JobPlan = target && ['jpg', 'jpeg', 'webp', 'png', 'avif'].includes(fmt)
                ? { server: { action: 'convert_compress', format: fmt, fields: { ...fields, comp_mode: 'size', comp_value: String(target) } } }
                : { server: { action: 'convert', format: fmt, fields } }
            const browserOk = o.imageUpscale === '1' && !target && !(o.imageLossless && fmt === 'webp')
                && !(o.imageResizeMode === 'percent' && o.imagePercent !== 100) && fmt !== 'ico'
                && (metadata === 'strip' || !CAMERA_PHOTO_EXTS.has(src))
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
            // A PDF "to PDF" is a compression (Ghostscript), at the chosen level.
            return fmt === 'pdf' || keepFormat
                ? { server: { action: 'compress', format: '', fields: compressing ? compressFields(o) : { comp_mode: 'crf', comp_value: 'medium' } } }
                : { server: { action: 'convert', format: fmt, fields: {} } }
        case 'sequence':
            return { server: { action: 'convert', format: item.targetFormat, fields: { sequence_fps: o.slideshowFps } } }
        case 'document':
        case '3d':
            // Nothing to compress: always converted to their format.
            return { server: { action: 'convert', format: item.targetFormat, fields: {} } }
        default:
            return {}
    }
}
