// ──────────────────────────────────────────────────────────
// "Convertir" page: options model and the per-file job plan (where to run it
// and which parameters the server gets).
// ──────────────────────────────────────────────────────────
import type { JobPlan } from '@/hooks/useQueue'
import { BROWSER_DECODABLE, BROWSER_ENCODABLE, processImageInBrowser } from '@/lib/clientProcessor'
import type { ProcessingPreference } from '@/lib/settings'
import { AUDIO_FORMATS, extOf, type QueueItem } from '@/types'

export type VideoQuality = 'high' | 'balanced' | 'small' | 'size'

export interface ConvertOptions {
    videoQuality: VideoQuality
    videoTargetMb: string
    videoMaxHeight: string
    videoFps: string
    videoCodec: 'libx264' | 'libx265'
    removeAudio: boolean
    trimStart: string
    trimEnd: string
    rotate: 'none' | '90' | '180' | '270' | 'hflip'
    gifWidth: string
    gifFps: string
    gifSpeed: string
    gifColors: string
    audioBitrate: string
    audioNormalize: boolean
    imageQuality: number
    imageMaxSize: string
    imageUpscale: string
    slideshow: boolean
    slideshowFormat: 'mp4' | 'webm' | 'gif'
    slideshowFps: string
    frameFps: string
}

export const DEFAULT_CONVERT_OPTIONS: ConvertOptions = {
    videoQuality: 'balanced',
    videoTargetMb: '25',
    videoMaxHeight: '',
    videoFps: '',
    videoCodec: 'libx264',
    removeAudio: false,
    trimStart: '',
    trimEnd: '',
    rotate: 'none',
    gifWidth: '480',
    gifFps: '15',
    gifSpeed: '1',
    gifColors: '256',
    audioBitrate: '192k',
    audioNormalize: false,
    imageQuality: 90,
    imageMaxSize: '',
    imageUpscale: '1',
    slideshow: false,
    slideshowFormat: 'mp4',
    slideshowFps: '1',
    frameFps: '1',
}

const H26X_CONTAINERS = new Set(['mp4', 'mov', 'mkv', 'm4v', 'ts'])

function trimFields(o: ConvertOptions): Record<string, string> {
    const f: Record<string, string> = {}
    if (o.trimStart.trim()) f.trim_start = o.trimStart.trim()
    if (o.trimEnd.trim()) f.trim_end = o.trimEnd.trim()
    return f
}

export function planForItem(item: QueueItem, o: ConvertOptions, processing: ProcessingPreference): JobPlan {
    const fmt = item.targetFormat
    const src = extOf(item.name)

    switch (item.kind) {
        case 'video': {
            if (fmt === 'gif') {
                const speed = parseFloat(o.gifSpeed) || 1
                return {
                    server: {
                        action: 'convert', format: 'gif',
                        fields: {
                            ...trimFields(o), gif_width: o.gifWidth, gif_fps: o.gifFps,
                            gif_speed: (1 / speed).toFixed(3), gif_colors: o.gifColors, gif_loop: '0',
                        },
                    },
                }
            }
            if (AUDIO_FORMATS.has(fmt)) {
                return {
                    server: {
                        action: 'convert', format: fmt,
                        fields: { ...trimFields(o), audio_bitrate: o.audioBitrate, ...(o.audioNormalize ? { audio_normalize: '1' } : {}) },
                    },
                }
            }
            if (fmt === 'zip') {
                return { server: { action: 'convert', format: 'zip', fields: { ...trimFields(o), sequence_fps: o.frameFps } } }
            }
            const fields: Record<string, string> = { ...trimFields(o), audio_bitrate: o.audioBitrate }
            if (o.videoQuality !== 'size') fields.video_quality = o.videoQuality
            if (o.videoMaxHeight) fields.video_max_height = o.videoMaxHeight
            if (o.videoFps) fields.fps = o.videoFps
            if (o.videoCodec === 'libx265' && H26X_CONTAINERS.has(fmt)) fields.video_codec = 'libx265'
            if (o.removeAudio) fields.remove_audio = '1'
            if (o.rotate !== 'none') fields.rotate = o.rotate
            if (o.audioNormalize) fields.audio_normalize = '1'
            const sizeTarget = o.videoQuality === 'size' && parseFloat(o.videoTargetMb) > 0
            const plan: JobPlan = {
                server: sizeTarget
                    ? { action: 'convert_compress', format: fmt, fields: { ...fields, comp_mode: 'size', comp_value: o.videoTargetMb } }
                    : { action: 'convert', format: fmt, fields },
            }
            const simple = !sizeTarget && !o.trimStart && !o.trimEnd && o.rotate === 'none' && !o.videoFps
                && o.videoCodec === 'libx264' && !o.audioNormalize
            if (processing === 'browser' && simple) {
                plan.local = {
                    run: async ({ file, onProgress }) => {
                        const { processVideoInBrowser } = await import('@/lib/clientVideoProcessor')
                        const crf = { high: 20, balanced: 23, small: 28, size: 23 }[o.videoQuality]
                        return processVideoInBrowser(file, fmt, {
                            crf, maxHeight: parseInt(o.videoMaxHeight, 10) || 0, removeAudio: o.removeAudio, onProgress,
                        })
                    },
                }
            }
            return plan
        }
        case 'audio':
            return {
                server: {
                    action: 'convert', format: fmt,
                    fields: { ...trimFields(o), audio_bitrate: o.audioBitrate, ...(o.audioNormalize ? { audio_normalize: '1' } : {}) },
                },
            }
        case 'image': {
            const fields: Record<string, string> = { image_quality: String(o.imageQuality) }
            if (o.imageMaxSize) {
                fields.image_resize_mode = 'dimension'
                fields.image_max_size = o.imageMaxSize
            }
            if (o.imageUpscale !== '1') fields.image_upscale = o.imageUpscale
            if (fmt === 'ico') fields.ico_size = '256'
            const plan: JobPlan = { server: { action: 'convert', format: fmt, fields } }
            if (processing !== 'server' && BROWSER_DECODABLE.has(src) && BROWSER_ENCODABLE.has(fmt) && o.imageUpscale === '1') {
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
