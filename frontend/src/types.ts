// ──────────────────────────────────────────────────────────
// Shared types + the media/format catalogue.
// ──────────────────────────────────────────────────────────

export type MediaKind = 'video' | 'audio' | 'image' | 'pdf' | 'document' | '3d'

export type ItemStatus = 'pending' | 'uploading' | 'queued' | 'processing' | 'done' | 'error'

export interface QueueItem {
    id: string
    /** null when the item was restored from a previous visit (only the result exists). */
    file: File | null
    name: string
    size: number
    kind: MediaKind | 'sequence' | 'unknown'
    relativePath: string
    targetFormat: string
    status: ItemStatus
    /** 0-100 within the current phase (upload or processing). */
    progress: number
    jobId: string | null
    /** Processed in the browser: downloadUrl is a blob: URL. */
    local: boolean
    downloadUrl: string | null
    outputName: string | null
    outputSize: number | null
    error: string | null
    /** Images of an "images → vidéo" slideshow (the first one is `file`). */
    extraFiles?: File[]
}

const EXT: Record<MediaKind, string[]> = {
    video: [
        'mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'flv', 'm4v', 'mpeg', 'mpg', '3gp', '3g2', 'ts', 'mts',
        'm2ts', 'vob', 'ogv', 'divx', 'xvid', 'asf', 'rm', 'rmvb', 'f4v',
    ],
    audio: [
        'mp3', 'wav', 'm4a', 'flac', 'aac', 'ogg', 'wma', 'aiff', 'aif', 'opus', 'ac3', 'eac3', 'dts', 'amr',
        'ape', 'mka', 'mpa', 'au', 'ra', 'mid', 'midi',
    ],
    image: [
        'png', 'jpg', 'jpeg', 'gif', 'tiff', 'tif', 'bmp', 'psd', 'heic', 'heif', 'webp', 'avif', 'ico', 'jp2',
        'j2k', 'jpf', 'jpm', 'raw', 'cr2', 'nef', 'arw', 'dng', 'orf', 'rw2', 'pef', 'tga', 'sgi', 'qtif',
        'pict', 'icns', 'svg',
    ],
    pdf: ['pdf'],
    document: ['docx', 'doc', 'odt', 'rtf', 'xlsx', 'xls', 'ods', 'csv', 'pptx', 'ppt', 'odp'],
    '3d': ['obj', 'stl', 'ply', 'glb', 'gltf', '3mf', 'off'],
}

const KIND_BY_EXT = new Map<string, MediaKind>()
for (const [kind, exts] of Object.entries(EXT) as [MediaKind, string[]][]) {
    for (const ext of exts) KIND_BY_EXT.set(ext, kind)
}

export const ACCEPT_ATTR = Object.values(EXT).flat().map((e) => `.${e}`).join(',')

export function extOf(name: string): string {
    const dot = name.lastIndexOf('.')
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function kindOf(name: string): MediaKind | 'unknown' {
    return KIND_BY_EXT.get(extOf(name)) ?? 'unknown'
}

export interface FormatOption {
    value: string
    label: string
    group?: string
}

const opt = (value: string, label = value.toUpperCase(), group?: string): FormatOption => ({ value, label, group })

export const FORMATS: Record<MediaKind, FormatOption[]> = {
    video: [
        opt('mp4', 'MP4', 'Vidéo'), opt('webm', 'WebM', 'Vidéo'), opt('mov', 'MOV', 'Vidéo'),
        opt('mkv', 'MKV', 'Vidéo'), opt('avi', 'AVI', 'Vidéo'), opt('m4v', 'M4V', 'Vidéo'),
        opt('wmv', 'WMV', 'Vidéo'), opt('flv', 'FLV', 'Vidéo'), opt('mpeg', 'MPEG', 'Vidéo'),
        opt('ogv', 'OGV', 'Vidéo'), opt('ts', 'TS', 'Vidéo'),
        opt('gif', 'GIF animé', 'Animation'),
        opt('mp3', 'MP3', 'Son seul'), opt('m4a', 'M4A', 'Son seul'), opt('wav', 'WAV', 'Son seul'),
        opt('flac', 'FLAC', 'Son seul'), opt('ogg', 'OGG', 'Son seul'), opt('opus', 'Opus', 'Son seul'),
        opt('zip', 'PNG (zip)', 'Images'),
    ],
    audio: [
        opt('mp3', 'MP3'), opt('m4a', 'M4A'), opt('aac', 'AAC'), opt('wav', 'WAV'), opt('flac', 'FLAC'),
        opt('ogg', 'OGG'), opt('opus', 'Opus'), opt('aiff', 'AIFF'), opt('wma', 'WMA'), opt('ac3', 'AC3'),
    ],
    image: [
        opt('jpg', 'JPG'), opt('png', 'PNG'), opt('webp', 'WebP'), opt('avif', 'AVIF'), opt('gif', 'GIF'),
        opt('bmp', 'BMP'), opt('tiff', 'TIFF'), opt('ico', 'ICO'), opt('pdf', 'PDF'),
    ],
    pdf: [opt('pdf', 'PDF compressé'), opt('txt', 'Texte (TXT)')],
    document: [opt('pdf', 'PDF')],
    '3d': [opt('glb', 'GLB'), opt('obj', 'OBJ'), opt('stl', 'STL'), opt('ply', 'PLY'), opt('3mf', '3MF'), opt('off', 'OFF')],
}

export const DEFAULT_FORMAT: Record<MediaKind, string> = {
    video: 'mp4',
    audio: 'mp3',
    image: 'jpg',
    pdf: 'pdf',
    document: 'pdf',
    '3d': 'glb',
}

export const KIND_LABEL: Record<MediaKind, string> = {
    video: 'Vidéos',
    audio: 'Audio',
    image: 'Images',
    pdf: 'PDF',
    document: 'Documents',
    '3d': 'Modèles 3D',
}

export const AUDIO_FORMATS = new Set(['mp3', 'aac', 'm4a', 'opus', 'ogg', 'flac', 'wav', 'wma', 'ac3', 'eac3', 'aiff'])

export function formatLabel(kind: QueueItem['kind'], value: string): string {
    const list = kind === 'sequence' ? FORMATS.video : kind === 'unknown' ? [] : FORMATS[kind]
    return list.find((f) => f.value === value)?.label ?? value.toUpperCase()
}

export function formatSize(bytes: number): string {
    if (!bytes) return '0 o'
    const units = ['o', 'Ko', 'Mo', 'Go']
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
    const value = bytes / 1024 ** i
    return `${value.toLocaleString('fr-FR', { maximumFractionDigits: value < 10 && i > 0 ? 1 : 0 })} ${units[i]}`
}

export function isActive(status: ItemStatus): boolean {
    return status === 'uploading' || status === 'queued' || status === 'processing'
}
