import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { UploadZone } from '@/components/UploadZone'
import { IconDownload, IconImage, IconPlay, IconTrash, IconVideo, IconX } from '@/components/icons'
import { cn } from '@/lib/utils'

type MediaKind = 'image' | 'video'
type BandTone = 'white' | 'black' | 'transparent'
type CaptionZone = 'top' | 'center' | 'bottom'
type CropSettings = { top: number; right: number; bottom: number; left: number }
type MediaPosition = { x: number; y: number; scale: number }
type CropDragMode = 'frame' | 'media'
type GridImage = { id: string; file: File; url: string; x: number; y: number; scale: number }

interface MemeCaption {
    id: string
    text: string
    start: number
    end: number
    color: string
    zone: CaptionZone
}

const FONT_OPTIONS = [
    { label: 'Impact', value: 'Impact, Haettenschweiler, Arial Black, sans-serif' },
    { label: 'Arial Black', value: '"Arial Black", Arial, sans-serif' },
    { label: 'Inter', value: 'Inter, ui-sans-serif, system-ui, sans-serif' },
    { label: 'Georgia', value: 'Georgia, serif' },
    { label: 'Mono', value: '"SFMono-Regular", Consolas, monospace' },
]

const DEFAULT_CAPTIONS: MemeCaption[] = [
    { id: 'top', text: 'QUAND TU UPLOAD', start: 0, end: 3, color: '#ffffff', zone: 'top' },
    { id: 'bottom', text: 'ET QUE LA PREVIEW EST CLEAN', start: 0, end: 3, color: '#ffffff', zone: 'bottom' },
]
const EMPTY_CROP: CropSettings = { top: 0, right: 0, bottom: 0, left: 0 }
const EMPTY_MEDIA_POSITION: MediaPosition = { x: 0, y: 0, scale: 1 }
const PREVIEW_RATIO = 16 / 9

function detectKind(file: File | null): MediaKind | null {
    if (!file) return null
    if (file.type.startsWith('video/')) return 'video'
    if (file.type.startsWith('image/')) return 'image'
    const name = file.name.toLowerCase()
    if (/\.(mp4|webm|mov|m4v|mkv|avi)$/i.test(name)) return 'video'
    if (/\.(png|jpe?g|webp|gif|avif|bmp)$/i.test(name)) return 'image'
    return null
}

function formatTime(seconds: number): string {
    if (!Number.isFinite(seconds)) return '0:00'
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60).toString().padStart(2, '0')
    return `${m}:${s}`
}

function baseName(file: File): string {
    return file.name.replace(/\.[^.]+$/, '') || 'meme'
}

function loadImageUrl(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error('Impossible de charger l’image'))
        img.src = url
    })
}

async function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
    return loadImageUrl(url)
}

function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    window.setTimeout(() => URL.revokeObjectURL(url), 800)
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value))
}

function getCropRect(width: number, height: number, crop: CropSettings) {
    const left = Math.round(width * clamp(crop.left, 0, 80) / 100)
    const right = Math.round(width * clamp(crop.right, 0, 80) / 100)
    const top = Math.round(height * clamp(crop.top, 0, 80) / 100)
    const bottom = Math.round(height * clamp(crop.bottom, 0, 80) / 100)
    return {
        sx: Math.min(left, width - 2),
        sy: Math.min(top, height - 2),
        sw: Math.max(2, width - left - right),
        sh: Math.max(2, height - top - bottom),
    }
}

function cropHasValue(crop: CropSettings) {
    return crop.top > 0 || crop.right > 0 || crop.bottom > 0 || crop.left > 0
}


function moveCropFrame(crop: CropSettings, dxPct: number, dyPct: number): CropSettings {
    const width = 100 - crop.left - crop.right
    const height = 100 - crop.top - crop.bottom
    const left = clamp(Math.round((crop.left + dxPct) * 10) / 10, 0, 100 - width)
    const top = clamp(Math.round((crop.top + dyPct) * 10) / 10, 0, 100 - height)
    return {
        left,
        top,
        right: Math.round((100 - width - left) * 10) / 10,
        bottom: Math.round((100 - height - top) * 10) / 10,
    }
}

function mediaBounds(aspect: number, scale: number) {
    const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : PREVIEW_RATIO
    const safeScale = Math.max(1, scale)
    const baseW = safeAspect > PREVIEW_RATIO ? safeAspect / PREVIEW_RATIO : 1
    const baseH = safeAspect > PREVIEW_RATIO ? 1 : PREVIEW_RATIO / safeAspect
    const drawW = baseW * safeScale
    const drawH = baseH * safeScale
    return {
        x: Math.max(0, ((drawW - 1) / (2 * drawW)) * 100),
        y: Math.max(0, ((drawH - 1) / (2 * drawH)) * 100),
    }
}

function mediaDrawSize(aspect: number, scale: number) {
    const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : PREVIEW_RATIO
    const safeScale = Math.max(1, scale)
    return {
        width: (safeAspect > PREVIEW_RATIO ? safeAspect / PREVIEW_RATIO : 1) * safeScale,
        height: (safeAspect > PREVIEW_RATIO ? 1 : PREVIEW_RATIO / safeAspect) * safeScale,
    }
}

function clampMediaPosition(position: MediaPosition, aspect: number): MediaPosition {
    const bounds = mediaBounds(aspect, position.scale)
    return {
        scale: Math.max(1, position.scale),
        x: clamp(position.x, -bounds.x, bounds.x),
        y: clamp(position.y, -bounds.y, bounds.y),
    }
}

function drawMediaCover(
    ctx: CanvasRenderingContext2D,
    source: CanvasImageSource,
    sourceWidth: number,
    sourceHeight: number,
    targetWidth: number,
    targetHeight: number,
    position: MediaPosition,
) {
    const safePosition = clampMediaPosition(position, sourceWidth / sourceHeight)
    const baseScale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight) * safePosition.scale
    const drawW = sourceWidth * baseScale
    const drawH = sourceHeight * baseScale
    const x = (targetWidth - drawW) / 2 + (safePosition.x / 100) * drawW
    const y = (targetHeight - drawH) / 2 + (safePosition.y / 100) * drawH
    ctx.drawImage(source, x, y, drawW, drawH)
}

function renderMediaFrame(
    source: CanvasImageSource,
    sourceWidth: number,
    sourceHeight: number,
    position: MediaPosition,
    width = 1200,
) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = Math.round(width / PREVIEW_RATIO)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    drawMediaCover(ctx, source, sourceWidth, sourceHeight, canvas.width, canvas.height, position)
    return canvas
}

function gridTemplate(count: number) {
    if (count <= 1) return { cols: 1, rows: 1 }
    if (count === 2) return { cols: 2, rows: 1 }
    if (count <= 4) return { cols: 2, rows: 2 }
    if (count <= 6) return { cols: 3, rows: 2 }
    return { cols: 3, rows: 3 }
}

function readableBandTextColor(bandTone: BandTone, fallback: string) {
    if (bandTone === 'white') return '#111111'
    if (bandTone === 'black') return '#ffffff'
    return fallback
}

function captionY(zone: CaptionZone, mediaTop: number, mediaHeight: number) {
    if (zone === 'top') return mediaTop + mediaHeight * 0.12
    if (zone === 'bottom') return mediaTop + mediaHeight * 0.88
    return mediaTop + mediaHeight / 2
}

function drawMemeFrame(
    ctx: CanvasRenderingContext2D,
    source: CanvasImageSource,
    sourceWidth: number,
    sourceHeight: number,
    options: {
        topText: string
        bottomText: string
        captions: MemeCaption[]
        time: number
        fontFamily: string
        fontSize: number
        textColor: string
        outlineColor: string
        bandTone: BandTone
        bandHeightPct: number
        topBand: boolean
        bottomBand: boolean
        uppercase: boolean
        outlineEnabled: boolean
        crop: CropSettings
    },
) {
    const cropRect = getCropRect(sourceWidth, sourceHeight, options.crop)
    const width = cropRect.sw
    const mediaHeight = cropRect.sh
    const bandHeight = options.bandTone === 'transparent'
        ? 0
        : Math.max(1, Math.round(mediaHeight * options.bandHeightPct / 100))
    const topBandHeight = options.topBand ? bandHeight : 0
    const bottomBandHeight = options.bottomBand ? bandHeight : 0
    const height = mediaHeight + topBandHeight + bottomBandHeight
    const mediaTop = topBandHeight

    if (ctx.canvas.width !== width) ctx.canvas.width = width
    if (ctx.canvas.height !== height) ctx.canvas.height = height
    ctx.clearRect(0, 0, width, height)

    if (options.bandTone !== 'transparent') {
        ctx.fillStyle = options.bandTone === 'white' ? '#ffffff' : '#000000'
        if (options.topBand) ctx.fillRect(0, 0, width, topBandHeight)
        if (options.bottomBand) ctx.fillRect(0, height - bottomBandHeight, width, bottomBandHeight)
    }

    ctx.drawImage(source, cropRect.sx, cropRect.sy, cropRect.sw, cropRect.sh, 0, mediaTop, width, mediaHeight)

    const bandTextColor = readableBandTextColor(options.bandTone, options.textColor)
    const drawText = (text: string, y: number, color = options.textColor, fontPx = options.fontSize) => {
        const clean = options.uppercase ? text.toUpperCase() : text
        if (!clean.trim()) return
        ctx.save()
        ctx.font = `900 ${Math.max(14, fontPx)}px ${options.fontFamily}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.lineJoin = 'round'
        ctx.lineWidth = options.outlineEnabled ? Math.max(3, fontPx * 0.1) : 0
        ctx.strokeStyle = options.outlineColor
        ctx.fillStyle = color
        const maxWidth = width * 0.88
        const words = clean.split(/\s+/)
        const lines: string[] = []
        let line = ''
        for (const word of words) {
            const next = line ? `${line} ${word}` : word
            if (ctx.measureText(next).width > maxWidth && line) {
                lines.push(line)
                line = word
            } else {
                line = next
            }
        }
        if (line) lines.push(line)
        const lineHeight = fontPx * 1.02
        const startY = y - ((lines.length - 1) * lineHeight) / 2
        lines.forEach((value, index) => {
            const ly = startY + index * lineHeight
            if (options.outlineEnabled) ctx.strokeText(value, width / 2, ly)
            ctx.fillText(value, width / 2, ly)
        })
        ctx.restore()
    }

    const topTextY = options.topBand && topBandHeight > 0 ? topBandHeight / 2 : mediaTop + mediaHeight * 0.12
    const bottomTextY = options.bottomBand && bottomBandHeight > 0 ? height - bottomBandHeight / 2 : mediaTop + mediaHeight * 0.88
    const bandFontSize = Math.min(options.fontSize, Math.max(14, bandHeight * 0.62))
    drawText(options.topText, topTextY, options.topBand ? bandTextColor : options.textColor, options.topBand ? bandFontSize : options.fontSize)
    drawText(options.bottomText, bottomTextY, options.bottomBand ? bandTextColor : options.textColor, options.bottomBand ? bandFontSize : options.fontSize)
    for (const caption of options.captions) {
        if (options.time >= caption.start && options.time <= caption.end) {
            drawText(caption.text, captionY(caption.zone, mediaTop, mediaHeight), caption.color)
        }
    }
}

export function MemeStudio() {
    const [file, setFile] = useState<File | null>(null)
    const [objectUrl, setObjectUrl] = useState<string | null>(null)
    const [gridImages, setGridImages] = useState<GridImage[]>([])
    const [selectedImageId, setSelectedImageId] = useState<string | null>(null)
    const [topText, setTopText] = useState('QUAND TU UPLOAD')
    const [bottomText, setBottomText] = useState('ET QUE CA FAIT UN MEME')
    const [fontFamily, setFontFamily] = useState(FONT_OPTIONS[0].value)
    const [fontSize, setFontSize] = useState(48)
    const [textColor, setTextColor] = useState('#ffffff')
    const [outlineColor, setOutlineColor] = useState('#000000')
    const [outlineEnabled, setOutlineEnabled] = useState(false)
    const [bandTone, setBandTone] = useState<BandTone>('white')
    const [topBand, setTopBand] = useState(true)
    const [bottomBand, setBottomBand] = useState(true)
    const [bandHeightPct, setBandHeightPct] = useState(16)
    const [cropFrame, setCropFrame] = useState<CropSettings>(EMPTY_CROP)
    const [cropDraft, setCropDraft] = useState<CropSettings>(EMPTY_CROP)
    const [cropEditorOpen, setCropEditorOpen] = useState(false)
    const [cropDragMode, setCropDragMode] = useState<CropDragMode>('frame')
    const [mediaPosition, setMediaPosition] = useState<MediaPosition>(EMPTY_MEDIA_POSITION)
    const [mediaAspect, setMediaAspect] = useState(PREVIEW_RATIO)
    const [imageExportFormat, setImageExportFormat] = useState<'jpg' | 'png' | 'webp'>('jpg')
    const [imageExportQuality, setImageExportQuality] = useState(86)
    const [uppercase, setUppercase] = useState(true)
    const [captions, setCaptions] = useState<MemeCaption[]>(DEFAULT_CAPTIONS)
    const [selectedCaptionId, setSelectedCaptionId] = useState('top')
    const [duration, setDuration] = useState(0)
    const [currentTime, setCurrentTime] = useState(0)
    const [playing, setPlaying] = useState(false)
    const [exporting, setExporting] = useState(false)
    const videoRef = useRef<HTMLVideoElement>(null)
    const imageRef = useRef<HTMLImageElement>(null)
    const recorderRef = useRef<MediaRecorder | null>(null)
    const selectedGridImage = gridImages.find((item) => item.id === selectedImageId) || gridImages[0] || null

    const mediaKind = detectKind(file)
    const isImageGrid = mediaKind === 'image' && gridImages.length > 1
    const exportCrop = cropEditorOpen ? cropDraft : cropFrame
    const previewCrop = cropEditorOpen ? cropDraft : cropFrame
    const hasCrop = cropHasValue(cropFrame)
    const selectedCaption = captions.find((caption) => caption.id === selectedCaptionId) || captions[0]
    const activeCaptions = useMemo(
        () => captions.filter((caption) => currentTime >= caption.start && currentTime <= caption.end),
        [captions, currentTime],
    )
    useEffect(() => {
        if (!file) {
            setObjectUrl(null)
            return
        }
        const url = URL.createObjectURL(file)
        setObjectUrl(url)
        setCurrentTime(0)
        setDuration(0)
        setPlaying(false)
        return () => URL.revokeObjectURL(url)
    }, [file])

    const handleFiles = useCallback((files: FileList | File[]) => {
        const pickedFiles = Array.from(files).filter((candidate) => detectKind(candidate))
        const images = pickedFiles.filter((candidate) => detectKind(candidate) === 'image')
        const video = pickedFiles.find((candidate) => detectKind(candidate) === 'video')

        if (images.length > 0) {
            setGridImages((prev) => {
                for (const item of prev) URL.revokeObjectURL(item.url)
                const next = images.map((image, index) => ({
                    id: `${Date.now()}-${index}-${image.name}`,
                    file: image,
                    url: URL.createObjectURL(image),
                    x: 0,
                    y: 0,
                    scale: 1,
                }))
                setSelectedImageId(next[0]?.id || null)
                setCropFrame(EMPTY_CROP)
                setCropDraft(EMPTY_CROP)
                setMediaPosition(EMPTY_MEDIA_POSITION)
                setMediaAspect(PREVIEW_RATIO)
                setCropEditorOpen(false)
                return next
            })
            setFile(images[0])
            return
        }

        if (video) {
            setGridImages((prev) => {
                for (const item of prev) URL.revokeObjectURL(item.url)
                return []
            })
            setSelectedImageId(null)
            setCropFrame(EMPTY_CROP)
            setCropDraft(EMPTY_CROP)
            setMediaPosition(EMPTY_MEDIA_POSITION)
            setMediaAspect(PREVIEW_RATIO)
            setCropEditorOpen(false)
            setFile(video)
        }
    }, [])

    const updateGridImage = (id: string, patch: Partial<GridImage>) => {
        setGridImages((prev) => prev.map((item) => item.id === id ? { ...item, ...patch } : item))
    }

    const removeMedia = () => {
        setGridImages((prev) => {
            for (const item of prev) URL.revokeObjectURL(item.url)
            return []
        })
        setSelectedImageId(null)
        setCropFrame(EMPTY_CROP)
        setCropDraft(EMPTY_CROP)
        setMediaPosition(EMPTY_MEDIA_POSITION)
        setMediaAspect(PREVIEW_RATIO)
        setCropEditorOpen(false)
        setFile(null)
    }

    const openCropEditor = () => {
        setCropDraft(cropFrame)
        setCropDragMode('frame')
        setCropEditorOpen(true)
    }

    const applyCrop = () => {
        setCropFrame(cropDraft)
        setCropEditorOpen(false)
    }

    const cancelCropFrame = () => {
        setCropDraft(cropFrame)
        setCropEditorOpen(false)
    }

    const resetCrop = () => {
        setCropFrame(EMPTY_CROP)
        setCropDraft(EMPTY_CROP)
        setCropEditorOpen(false)
    }

    const updateMediaPosition = (dxPct: number, dyPct: number) => {
        const drawSize = mediaDrawSize(mediaAspect, mediaPosition.scale)
        setMediaPosition((prev) => clampMediaPosition({
            ...prev,
            x: Math.round((prev.x + dxPct / drawSize.width) * 10) / 10,
            y: Math.round((prev.y + dyPct / drawSize.height) * 10) / 10,
        }, mediaAspect))
    }

    const panPreview = (dxPct: number, dyPct: number) => {
        if (cropEditorOpen || !hasCrop) {
            updateMediaPosition(dxPct, dyPct)
            return
        }
        const cropWidth = Math.max(1, 100 - cropFrame.left - cropFrame.right)
        const cropHeight = Math.max(1, 100 - cropFrame.top - cropFrame.bottom)
        setCropFrame((prev) => moveCropFrame(prev, -(dxPct * cropWidth) / 100, -(dyPct * cropHeight) / 100))
    }

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Enter') return
            const target = event.target as HTMLElement | null
            const tag = target?.tagName?.toLowerCase()
            if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) return
            if (!cropEditorOpen) return
            event.preventDefault()
            setCropFrame(cropDraft)
            setCropEditorOpen(false)
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [cropDraft, cropEditorOpen])

    const updateCaption = (id: string, patch: Partial<MemeCaption>) => {
        setCaptions((prev) => prev.map((caption) => caption.id === id ? { ...caption, ...patch } : caption))
    }

    const addCaptionAtTime = () => {
        const id = `caption-${Date.now()}`
        const start = Math.max(0, currentTime)
        const end = Math.min(Math.max(duration || start + 2, start + 2), start + 2.5)
        const caption: MemeCaption = {
            id,
            text: 'NOUVEAU TEXTE',
            start,
            end: Math.max(start + 0.5, end),
            color: textColor,
            zone: 'center',
        }
        setCaptions((prev) => [...prev, caption])
        setSelectedCaptionId(id)
    }

    const removeCaption = (id: string) => {
        setCaptions((prev) => {
            const next = prev.filter((caption) => caption.id !== id)
            if (selectedCaptionId === id) setSelectedCaptionId(next[0]?.id || '')
            return next
        })
    }

    const togglePlay = async () => {
        const video = videoRef.current
        if (!video) return
        if (video.paused) {
            await video.play()
        } else {
            video.pause()
        }
    }

    const seekTo = (value: number) => {
        const video = videoRef.current
        if (video) video.currentTime = value
        setCurrentTime(value)
    }

    const exportImage = async () => {
        if (!file || !objectUrl) return
        setExporting(true)
        try {
            let source: CanvasImageSource | null = mediaKind === 'video' ? videoRef.current : await loadImageUrl(objectUrl)
            let width = mediaKind === 'video'
                ? videoRef.current?.videoWidth || 1280
                : (source as HTMLImageElement).naturalWidth
            let height = mediaKind === 'video'
                ? videoRef.current?.videoHeight || 720
                : (source as HTMLImageElement).naturalHeight

            if (isImageGrid && gridImages.length > 0) {
                const gridCanvas = document.createElement('canvas')
                gridCanvas.width = 1200
                gridCanvas.height = 675
                const gridCtx = gridCanvas.getContext('2d')
                if (!gridCtx) return
                gridCtx.fillStyle = '#111111'
                gridCtx.fillRect(0, 0, gridCanvas.width, gridCanvas.height)
                const { cols, rows } = gridTemplate(gridImages.length)
                const cellW = gridCanvas.width / cols
                const cellH = gridCanvas.height / rows
                const loadedImages = await Promise.all(gridImages.map(async (item) => ({ item, img: await loadImageFromUrl(item.url) })))
                loadedImages.forEach(({ item, img }, index) => {
                    const col = index % cols
                    const row = Math.floor(index / cols)
                    const cellX = col * cellW
                    const cellY = row * cellH
                    gridCtx.save()
                    gridCtx.beginPath()
                    gridCtx.rect(cellX, cellY, cellW, cellH)
                    gridCtx.clip()
                    const imageRatio = img.naturalWidth / img.naturalHeight
                    const cellRatio = cellW / cellH
                    const baseW = imageRatio > cellRatio ? cellH * imageRatio : cellW
                    const baseH = imageRatio > cellRatio ? cellH : cellW / imageRatio
                    const drawW = baseW * item.scale
                    const drawH = baseH * item.scale
                    const drawX = cellX + (cellW - drawW) / 2 + (item.x / 100) * cellW
                    const drawY = cellY + (cellH - drawH) / 2 + (item.y / 100) * cellH
                    gridCtx.drawImage(img, drawX, drawY, drawW, drawH)
                    gridCtx.restore()
                    gridCtx.strokeStyle = 'rgba(255,255,255,0.18)'
                    gridCtx.lineWidth = 2
                    gridCtx.strokeRect(cellX, cellY, cellW, cellH)
                })
                source = gridCanvas
                width = gridCanvas.width
                height = gridCanvas.height
            } else if (source) {
                const framedSource = renderMediaFrame(source, width, height, mediaPosition)
                if (!framedSource) return
                source = framedSource
                width = framedSource.width
                height = framedSource.height
            }

            if (!source) return
            const canvas = document.createElement('canvas')
            const ctx = canvas.getContext('2d')
            if (!ctx) return
            drawMemeFrame(ctx, source, width, height, {
                topText,
                bottomText,
                captions: mediaKind === 'video' ? captions : [],
                time: currentTime,
                fontFamily,
                fontSize: Math.round(fontSize * (width / 900)),
                textColor,
                outlineColor,
                bandTone,
                bandHeightPct,
                topBand,
                bottomBand,
                uppercase,
                outlineEnabled,
                crop: exportCrop,
            })
            const mimeType =
                imageExportFormat === 'png'
                    ? 'image/png'
                    : imageExportFormat === 'webp'
                        ? 'image/webp'
                        : 'image/jpeg'
            const extension = imageExportFormat === 'jpg' ? 'jpg' : imageExportFormat
            const quality = imageExportFormat === 'png' ? undefined : imageExportQuality / 100
            canvas.toBlob((blob) => {
                if (blob) downloadBlob(blob, `${baseName(file)}-meme.${extension}`)
            }, mimeType, quality)
        } finally {
            setExporting(false)
        }
    }

    const exportVideo = async () => {
        const video = videoRef.current
        if (!file || !video || !duration) return
        const streamType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
            ? 'video/webm;codecs=vp9'
            : 'video/webm'
        setExporting(true)
        setPlaying(false)
        video.pause()

        const canvas = document.createElement('canvas')
        const rawSourceWidth = video.videoWidth || 1280
        const rawSourceHeight = video.videoHeight || 720
        const videoFrame = document.createElement('canvas')
        videoFrame.width = 1200
        videoFrame.height = Math.round(videoFrame.width / PREVIEW_RATIO)
        const videoFrameCtx = videoFrame.getContext('2d')
        if (!videoFrameCtx) {
            setExporting(false)
            return
        }
        const sourceWidth = videoFrame.width
        const sourceHeight = videoFrame.height
        const cropRect = getCropRect(sourceWidth, sourceHeight, exportCrop)
        const bandFontSize = Math.round(fontSize * (cropRect.sw / 900))
        const bandHeight = bandTone === 'transparent'
            ? 0
            : Math.max(1, Math.round(cropRect.sh * bandHeightPct / 100))
        canvas.width = cropRect.sw
        canvas.height = cropRect.sh + (topBand ? bandHeight : 0) + (bottomBand ? bandHeight : 0)
        const ctx = canvas.getContext('2d')
        if (!ctx) {
            setExporting(false)
            return
        }

        const stream = canvas.captureStream(30)
        const chunks: BlobPart[] = []
        const recorder = new MediaRecorder(stream, { mimeType: streamType, videoBitsPerSecond: 6_000_000 })
        recorderRef.current = recorder

        const done = new Promise<Blob>((resolve) => {
            recorder.ondataavailable = (event) => {
                if (event.data.size > 0) chunks.push(event.data)
            }
            recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }))
        })

        let raf = 0
        const draw = () => {
            videoFrameCtx.fillStyle = '#000000'
            videoFrameCtx.fillRect(0, 0, videoFrame.width, videoFrame.height)
            drawMediaCover(videoFrameCtx, video, rawSourceWidth, rawSourceHeight, videoFrame.width, videoFrame.height, mediaPosition)
            drawMemeFrame(ctx, videoFrame, sourceWidth, sourceHeight, {
                topText,
                bottomText,
                captions,
                time: video.currentTime,
                fontFamily,
                fontSize: bandFontSize,
                textColor,
                outlineColor,
                bandTone,
                bandHeightPct,
                topBand,
                bottomBand,
                uppercase,
                outlineEnabled,
                crop: exportCrop,
            })
            if (!video.ended && recorder.state === 'recording') {
                raf = requestAnimationFrame(draw)
            }
        }

        await new Promise<void>((resolve) => {
            if (Math.abs(video.currentTime) < 0.05) {
                resolve()
                return
            }
            const onSeeked = () => {
                video.removeEventListener('seeked', onSeeked)
                resolve()
            }
            video.addEventListener('seeked', onSeeked)
            video.currentTime = 0
        })
        recorder.start(250)
        draw()
        await video.play()
        await new Promise<void>((resolve) => {
            const stop = () => {
                cancelAnimationFrame(raf)
                if (recorder.state === 'recording') recorder.stop()
                video.removeEventListener('ended', stop)
                recorder.removeEventListener('stop', stop)
                resolve()
            }
            video.addEventListener('ended', stop)
            recorder.addEventListener('stop', stop)
        })
        const blob = await done
        downloadBlob(blob, `${baseName(file)}-meme.webm`)
        recorderRef.current = null
        setExporting(false)
        setPlaying(false)
    }

    const stopExport = () => {
        recorderRef.current?.stop()
        videoRef.current?.pause()
        setExporting(false)
    }

    return (
        <main className="mx-auto max-w-[1600px] px-4 lg:px-8 py-6">
            <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)_380px]">
                <section className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
                    <div className="border-b border-border px-4 py-3">
                        <h2 className="text-sm font-semibold">Media</h2>
                        <p className="mt-0.5 text-xs text-muted-foreground">Image ou vidéo, traité en local.</p>
                    </div>
                    <UploadZone onFilesAdded={handleFiles} compact />
                    {file && (
                        <div className="border-t border-border px-4 py-3">
                            <div className="flex items-center gap-3">
                                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                                    {mediaKind === 'video' ? <IconVideo size={18} /> : <IconImage size={18} />}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium">{isImageGrid ? `${gridImages.length} images` : file.name}</p>
                                    <p className="text-xs text-muted-foreground">{mediaKind === 'video' ? 'Vidéo' : isImageGrid ? 'Grille image' : 'Image'}</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={removeMedia}
                                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-destructive"
                                    aria-label="Retirer"
                                >
                                    <IconX size={15} />
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="space-y-4 border-t border-border px-4 py-4">
                        <ControlLabel label="Font">
                            <select value={fontFamily} onChange={(event) => setFontFamily(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                                {FONT_OPTIONS.map((font) => <option key={font.label} value={font.value}>{font.label}</option>)}
                            </select>
                        </ControlLabel>
                        <ControlLabel label={`Taille ${fontSize}px`}>
                            <Slider value={[fontSize]} min={24} max={86} step={1} onValueChange={([value]) => setFontSize(value)} />
                        </ControlLabel>
                        <ColorInput label="Texte hors bande" value={textColor} onChange={setTextColor} />
                        <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
                            Contour
                            <input type="checkbox" checked={outlineEnabled} onChange={(event) => setOutlineEnabled(event.target.checked)} />
                        </label>
                        {outlineEnabled && <ColorInput label="Couleur contour" value={outlineColor} onChange={setOutlineColor} />}
                        {imageExportFormat !== 'png' && (
                            <ControlLabel label={`Qualité export ${imageExportQuality}%`}>
                                <Slider
                                    value={[imageExportQuality]}
                                    min={55}
                                    max={100}
                                    step={1}
                                    onValueChange={([value]) => setImageExportQuality(value)}
                                />
                            </ControlLabel>
                        )}
                        {isImageGrid && selectedGridImage && (
                            <div className="rounded-lg border border-border p-3">
                                <div className="mb-2 flex items-center justify-between gap-2">
                                    <p className="min-w-0 truncate text-xs font-semibold uppercase text-muted-foreground">
                                        Image sélectionnée
                                    </p>
                                    <span className="truncate text-xs text-muted-foreground">{selectedGridImage.file.name}</span>
                                </div>
                                <ControlLabel label={`Scale ${selectedGridImage.scale.toFixed(2)}×`}>
                                    <Slider
                                        value={[selectedGridImage.scale]}
                                        min={0.55}
                                        max={2.5}
                                        step={0.01}
                                        onValueChange={([value]) => updateGridImage(selectedGridImage.id, { scale: value })}
                                    />
                                </ControlLabel>
                                <button
                                    type="button"
                                    onClick={() => updateGridImage(selectedGridImage.id, { x: 0, y: 0, scale: 1 })}
                                    className="mt-3 h-8 rounded-md border border-border px-3 text-xs font-medium text-foreground hover:bg-muted"
                                >
                                    Recentrer
                                </button>
                            </div>
                        )}
                        <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
                            Majuscules
                            <input type="checkbox" checked={uppercase} onChange={(event) => setUppercase(event.target.checked)} />
                        </label>
                    </div>
                </section>

                <section className="min-w-0 rounded-lg border border-border bg-card shadow-sm overflow-hidden">
                    <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                        <div>
                            <h2 className="text-sm font-semibold">Preview</h2>
                            <p className="mt-0.5 text-xs text-muted-foreground">Texte, bandes et timestamps visibles avant export.</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                Format
                                <select
                                    value={imageExportFormat}
                                    onChange={(event) => setImageExportFormat(event.target.value as 'jpg' | 'png' | 'webp')}
                                    className="h-8 rounded-md border border-input bg-background px-2 text-xs font-semibold text-foreground"
                                    aria-label="Format d'export"
                                >
                                    <option value="jpg">JPG</option>
                                    <option value="webp">WEBP</option>
                                    <option value="png">PNG</option>
                                </select>
                            </label>
                            <Button size="sm" variant="outline" onClick={exportImage} disabled={!file || exporting}>
                                <IconDownload size={14} />
                                Exporter
                            </Button>
                            {mediaKind === 'video' && (
                                exporting ? (
                                    <Button size="sm" variant="destructive" onClick={stopExport}>Stop</Button>
                                ) : (
                                    <Button size="sm" onClick={exportVideo} disabled={!file || !duration}>
                                        <IconDownload size={14} />
                                        WebM
                                    </Button>
                                )
                            )}
                        </div>
                    </div>

                    <div className="bg-muted/40 p-4 lg:p-6">
                        <div className="mx-auto max-w-5xl">
                            <div className="relative overflow-hidden rounded-lg bg-black shadow-sm">
                                {!objectUrl ? (
                                    <div className="flex aspect-video items-center justify-center text-sm text-muted-foreground bg-background">
                                        Ajoute une image ou une vidéo
                                    </div>
                                ) : (
                                    <div className="relative bg-background">
                                        {mediaKind === 'video' ? (
                                            <MemePreviewFrame
                                                topText={topText}
                                                bottomText={bottomText}
                                                captions={activeCaptions}
                                                fontFamily={fontFamily}
                                                fontSize={fontSize}
                                                textColor={textColor}
                                                outlineColor={outlineColor}
                                                bandTone={bandTone}
                                                topBand={topBand}
                                                bottomBand={bottomBand}
                                                bandHeightPct={bandHeightPct}
                                                uppercase={uppercase}
                                                outlineEnabled={outlineEnabled}
                                                crop={cropDraft}
                                                showCropOverlay={cropEditorOpen}
                                                cropOverlayEditable={cropDragMode === 'frame'}
                                                onCropChange={setCropDraft}
                                                canPanCrop={!cropEditorOpen || cropDragMode === 'media'}
                                                onCropPan={cropEditorOpen ? updateMediaPosition : panPreview}
                                            >
                                                <div className="absolute inset-0 overflow-hidden" style={cropMediaStyle(previewCrop)}>
                                                    <video
                                                        ref={videoRef}
                                                        src={objectUrl}
                                                        className="absolute left-1/2 top-1/2 max-w-none select-none"
                                                        style={mediaContentStyle(mediaAspect, mediaPosition)}
                                                        playsInline
                                                        onLoadedMetadata={(event) => {
                                                            const video = event.currentTarget
                                                            setDuration(video.duration || 0)
                                                            if (video.videoWidth && video.videoHeight) {
                                                                const nextAspect = video.videoWidth / video.videoHeight
                                                                setMediaAspect(nextAspect)
                                                                setMediaPosition((prev) => clampMediaPosition(prev, nextAspect))
                                                            }
                                                        }}
                                                        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime || 0)}
                                                        onPlay={() => setPlaying(true)}
                                                        onPause={() => setPlaying(false)}
                                                        onEnded={() => setPlaying(false)}
                                                    />
                                                </div>
                                            </MemePreviewFrame>
                                        ) : isImageGrid ? (
                                            <MemePreviewFrame
                                                topText={topText}
                                                bottomText={bottomText}
                                                captions={[]}
                                                fontFamily={fontFamily}
                                                fontSize={fontSize}
                                                textColor={textColor}
                                                outlineColor={outlineColor}
                                                bandTone={bandTone}
                                                topBand={topBand}
                                                bottomBand={bottomBand}
                                                bandHeightPct={bandHeightPct}
                                                uppercase={uppercase}
                                                outlineEnabled={outlineEnabled}
                                                crop={cropDraft}
                                                showCropOverlay={cropEditorOpen}
                                                cropOverlayEditable={cropDragMode === 'frame'}
                                                onCropChange={setCropDraft}
                                                canPanCrop={false}
                                                onCropPan={() => undefined}
                                            >
                                                <div className="absolute inset-0 overflow-hidden">
                                                    <div className="absolute inset-0" style={cropMediaStyle(previewCrop)}>
                                                        <ImageGrid
                                                            images={gridImages}
                                                            selectedId={selectedImageId}
                                                            onSelect={setSelectedImageId}
                                                            onChange={updateGridImage}
                                                        />
                                                    </div>
                                                </div>
                                            </MemePreviewFrame>
                                        ) : (
                                            <MemePreviewFrame
                                                topText={topText}
                                                bottomText={bottomText}
                                                captions={[]}
                                                fontFamily={fontFamily}
                                                fontSize={fontSize}
                                                textColor={textColor}
                                                outlineColor={outlineColor}
                                                bandTone={bandTone}
                                                topBand={topBand}
                                                bottomBand={bottomBand}
                                                bandHeightPct={bandHeightPct}
                                                uppercase={uppercase}
                                                outlineEnabled={outlineEnabled}
                                                crop={cropDraft}
                                                showCropOverlay={cropEditorOpen}
                                                cropOverlayEditable={cropDragMode === 'frame'}
                                                onCropChange={setCropDraft}
                                                canPanCrop={!cropEditorOpen || cropDragMode === 'media'}
                                                onCropPan={cropEditorOpen ? updateMediaPosition : panPreview}
                                            >
                                                <div className="absolute inset-0 overflow-hidden" style={cropMediaStyle(previewCrop)}>
                                                    <img
                                                        ref={imageRef}
                                                        src={objectUrl}
                                                        alt=""
                                                        draggable={false}
                                                        className="absolute left-1/2 top-1/2 max-w-none select-none"
                                                        style={mediaContentStyle(mediaAspect, mediaPosition)}
                                                        onLoad={(event) => {
                                                            const image = event.currentTarget
                                                            if (image.naturalWidth && image.naturalHeight) {
                                                                const nextAspect = image.naturalWidth / image.naturalHeight
                                                                setMediaAspect(nextAspect)
                                                                setMediaPosition((prev) => clampMediaPosition(prev, nextAspect))
                                                            }
                                                        }}
                                                    />
                                                </div>
                                            </MemePreviewFrame>
                                        )}
                                    </div>
                                )}
                            </div>

                            {file && (
                                <div className="mt-3 space-y-3 rounded-lg border border-border bg-background p-3">
                                    {!isImageGrid && (
                                        <div>
                                            <div className="mb-2 flex items-center justify-between gap-3">
                                                <div>
                                                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Position</p>
                                                    <p className="text-xs text-muted-foreground">Glisse directement la preview pour bouger l’image.</p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => setMediaPosition(EMPTY_MEDIA_POSITION)}
                                                    className="h-8 rounded-md border border-border px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                                                >
                                                    Recentrer
                                                </button>
                                            </div>
                                            <ControlLabel label={`Zoom ${Math.round(mediaPosition.scale * 100)}%`}>
                                                <Slider
                                                    value={[mediaPosition.scale]}
                                                    min={1}
                                                    max={2.5}
                                                    step={0.05}
                                                    onValueChange={([value]) => setMediaPosition((prev) => clampMediaPosition({ ...prev, scale: value }, mediaAspect))}
                                                />
                                            </ControlLabel>
                                        </div>
                                    )}
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Crop</p>
                                            <p className="text-xs text-muted-foreground">
                                                {cropEditorOpen
                                                    ? cropDragMode === 'frame'
                                                        ? 'Déplace ou redimensionne le cadre. Entrée applique.'
                                                        : 'Déplace l’image sous le cadre. Entrée applique.'
                                                    : hasCrop
                                                        ? 'Crop actif. Rouvre pour ajuster.'
                                                        : 'Active le cadre pour recadrer.'}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() => cropEditorOpen ? cancelCropFrame() : openCropEditor()}
                                                className={cn(
                                                    'h-8 rounded-md px-3 text-xs font-semibold',
                                                    cropEditorOpen ? 'bg-foreground text-background' : 'border border-border text-foreground hover:bg-muted',
                                                )}
                                            >
                                                Crop
                                            </button>
                                        </div>
                                    </div>
                                    {cropEditorOpen && (
                                        <div className="mt-3 space-y-2">
                                            {!isImageGrid && (
                                                <div className="grid grid-cols-2 gap-2 rounded-md bg-muted p-1">
                                                    {(['frame', 'media'] as CropDragMode[]).map((mode) => (
                                                        <button
                                                            key={mode}
                                                            type="button"
                                                            onClick={() => setCropDragMode(mode)}
                                                            className={cn(
                                                                'h-8 rounded px-3 text-xs font-semibold',
                                                                cropDragMode === mode ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                                                            )}
                                                        >
                                                            {mode === 'frame' ? 'Cadre' : 'Image'}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                            <div className="flex flex-col gap-2">
                                                <button
                                                    type="button"
                                                    onClick={applyCrop}
                                                    className="h-9 w-full rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                                                >
                                                    Appliquer
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={cancelCropFrame}
                                                    className="h-9 w-full rounded-md border border-border px-3 text-xs font-medium text-foreground hover:bg-muted"
                                                >
                                                    Annuler
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={resetCrop}
                                                    className="h-7 w-full rounded px-3 text-xs text-muted-foreground hover:text-foreground"
                                                >
                                                    Réinitialiser le crop
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {mediaKind === 'video' && (
                                <div className="mt-3 rounded-lg border border-border bg-background px-3 py-3">
                                    <div className="flex items-center gap-3">
                                        <button
                                            type="button"
                                            onClick={togglePlay}
                                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-foreground text-background"
                                            aria-label={playing ? 'Pause' : 'Lire'}
                                        >
                                            {playing ? <span className="h-3.5 w-3.5 border-x-4 border-current" /> : <IconPlay size={16} />}
                                        </button>
                                        <div className="min-w-0 flex-1">
                                            <div className="relative h-7">
                                                <input
                                                    type="range"
                                                    min={0}
                                                    max={duration || 0}
                                                    step={0.05}
                                                    value={currentTime}
                                                    onChange={(event) => seekTo(Number(event.target.value))}
                                                    className="absolute left-0 top-2.5 h-1.5 w-full accent-primary"
                                                />
                                                {captions.map((caption) => (
                                                    <button
                                                        key={caption.id}
                                                        type="button"
                                                        onClick={() => seekTo(caption.start)}
                                                        title={`${caption.text} · ${formatTime(caption.start)}`}
                                                        className={cn(
                                                            'absolute top-0 h-6 w-2 rounded-full border border-background',
                                                            selectedCaptionId === caption.id ? 'bg-primary' : 'bg-foreground/70',
                                                        )}
                                                        style={{ left: `${duration ? (caption.start / duration) * 100 : 0}%` }}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                        <span className="w-24 text-right text-xs tabular-nums text-muted-foreground">
                                            {formatTime(currentTime)} / {formatTime(duration)}
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </section>

                <section className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
                    <div className="border-b border-border px-4 py-3">
                        <h2 className="text-sm font-semibold">Texte</h2>
                        <p className="mt-0.5 text-xs text-muted-foreground">Bandes classiques et captions timestampées.</p>
                    </div>
                    <div className="space-y-4 p-4">
                        <ControlLabel label="Texte haut">
                            <input value={topText} onChange={(event) => setTopText(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" />
                        </ControlLabel>
                        <ControlLabel label="Texte bas">
                            <input value={bottomText} onChange={(event) => setBottomText(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" />
                        </ControlLabel>

                        <div className="rounded-lg border border-border p-3">
                            <div className="mb-3 flex items-center justify-between">
                                <p className="text-xs font-semibold uppercase text-muted-foreground">Bandes</p>
                                <select value={bandTone} onChange={(event) => setBandTone(event.target.value as BandTone)} className="h-8 rounded-md border border-input bg-background px-2 text-xs">
                                    <option value="transparent">Aucune</option>
                                    <option value="white">Blanche</option>
                                    <option value="black">Noire</option>
                                </select>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-sm">
                                <label className="flex items-center gap-2 rounded-md bg-muted px-3 py-2"><input type="checkbox" checked={topBand} onChange={(event) => setTopBand(event.target.checked)} /> Haut</label>
                                <label className="flex items-center gap-2 rounded-md bg-muted px-3 py-2"><input type="checkbox" checked={bottomBand} onChange={(event) => setBottomBand(event.target.checked)} /> Bas</label>
                            </div>
                            <div className="mt-3">
                                <ControlLabel label={`Hauteur ${bandHeightPct}%`}>
                                    <Slider value={[bandHeightPct]} min={10} max={34} step={1} onValueChange={([value]) => setBandHeightPct(value)} />
                                </ControlLabel>
                            </div>
                        </div>

                        {mediaKind === 'video' && (
                            <div className="space-y-3 rounded-lg border border-border p-3">
                                <div className="flex items-center justify-between gap-3">
                                    <p className="text-xs font-semibold uppercase text-muted-foreground">Points vidéo</p>
                                    <Button type="button" size="sm" variant="outline" onClick={addCaptionAtTime}>Ajouter ici</Button>
                                </div>
                                <div className="max-h-44 space-y-2 overflow-auto pr-1">
                                    {captions.map((caption) => (
                                        <button
                                            key={caption.id}
                                            type="button"
                                            onClick={() => setSelectedCaptionId(caption.id)}
                                            className={cn(
                                                'flex w-full items-center gap-2 rounded-md border px-2 py-2 text-left text-xs',
                                                selectedCaptionId === caption.id ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
                                            )}
                                        >
                                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: caption.color }} />
                                            <span className="min-w-0 flex-1 truncate">{caption.text}</span>
                                            <span className="tabular-nums text-muted-foreground">{formatTime(caption.start)}</span>
                                        </button>
                                    ))}
                                </div>
                                {selectedCaption && (
                                    <div className="space-y-3 border-t border-border pt-3">
                                        <input value={selectedCaption.text} onChange={(event) => updateCaption(selectedCaption.id, { text: event.target.value })} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" />
                                        <div className="grid grid-cols-2 gap-2">
                                            <NumberInput label="Début" value={selectedCaption.start} max={duration} onChange={(value) => updateCaption(selectedCaption.id, { start: Math.min(value, selectedCaption.end - 0.1) })} />
                                            <NumberInput label="Fin" value={selectedCaption.end} max={duration || 999} onChange={(value) => updateCaption(selectedCaption.id, { end: Math.max(value, selectedCaption.start + 0.1) })} />
                                        </div>
                                        <div className="grid grid-cols-[1fr_84px_34px] gap-2">
                                            <select value={selectedCaption.zone} onChange={(event) => updateCaption(selectedCaption.id, { zone: event.target.value as CaptionZone })} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                                                <option value="top">Haut</option>
                                                <option value="center">Centre</option>
                                                <option value="bottom">Bas</option>
                                            </select>
                                            <input type="color" value={selectedCaption.color} onChange={(event) => updateCaption(selectedCaption.id, { color: event.target.value })} className="h-9 w-full rounded-md border border-input bg-background p-1" />
                                            <button type="button" onClick={() => removeCaption(selectedCaption.id)} className="flex h-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive" aria-label="Supprimer">
                                                <IconTrash size={15} />
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </section>
            </div>
        </main>
    )
}

function cropMediaStyle(crop: CropSettings): CSSProperties {
    const visibleWidth = Math.max(20, 100 - crop.left - crop.right)
    const visibleHeight = Math.max(20, 100 - crop.top - crop.bottom)
    return {
        width: `${10000 / visibleWidth}%`,
        height: `${10000 / visibleHeight}%`,
        maxWidth: 'none',
        objectFit: 'cover',
        transform: `translate(-${crop.left}%, -${crop.top}%)`,
        transformOrigin: 'top left',
    }
}

function mediaContentStyle(aspect: number, position: MediaPosition): CSSProperties {
    const coverByWidth = aspect < PREVIEW_RATIO
    const safePosition = clampMediaPosition(position, aspect)
    return {
        width: coverByWidth ? '100%' : 'auto',
        height: coverByWidth ? 'auto' : '100%',
        transform: `translate(-50%, -50%) translate(${safePosition.x}%, ${safePosition.y}%) scale(${safePosition.scale})`,
        transformOrigin: 'center',
    }
}

function MemePreviewFrame({
    topText,
    bottomText,
    captions,
    children,
    fontFamily,
    fontSize,
    textColor,
    outlineColor,
    bandTone,
    topBand,
    bottomBand,
    bandHeightPct,
    uppercase,
    outlineEnabled,
    crop,
    showCropOverlay,
    cropOverlayEditable,
    onCropChange,
    canPanCrop,
    onCropPan,
}: {
    topText: string
    bottomText: string
    captions: MemeCaption[]
    children: ReactNode
    fontFamily: string
    fontSize: number
    textColor: string
    outlineColor: string
    bandTone: BandTone
    topBand: boolean
    bottomBand: boolean
    bandHeightPct: number
    uppercase: boolean
    outlineEnabled: boolean
    crop: CropSettings
    showCropOverlay: boolean
    cropOverlayEditable: boolean
    onCropChange: (crop: CropSettings) => void
    canPanCrop: boolean
    onCropPan: (dxPct: number, dyPct: number) => void
}) {
    const bandClass = bandTone === 'white' ? 'bg-white' : bandTone === 'black' ? 'bg-black' : 'bg-transparent'
    const bandColor = readableBandTextColor(bandTone, textColor)
    const bandAspect = 16 / (9 * Math.max(1, bandHeightPct) / 100)
    const hasTopBand = topBand && bandTone !== 'transparent'
    const hasBottomBand = bottomBand && bandTone !== 'transparent'
    const renderText = (text: string, zone: CaptionZone, color = textColor) => {
        if (!text.trim()) return null
        return (
            <div
                className={cn(
                    'pointer-events-none absolute left-1/2 w-[88%] -translate-x-1/2 text-center font-black leading-[0.95]',
                    zone === 'top' && 'top-[6%]',
                    zone === 'center' && 'top-1/2 -translate-y-1/2',
                    zone === 'bottom' && 'bottom-[6%]',
                )}
                style={{
                    fontFamily,
                    fontSize: `clamp(22px, ${fontSize / 9}vw, ${fontSize}px)`,
                    color,
                    WebkitTextStroke: outlineEnabled ? `${Math.max(2, fontSize * 0.055)}px ${outlineColor}` : undefined,
                    textShadow: outlineEnabled ? `0 2px 0 ${outlineColor}` : undefined,
                }}
            >
                {uppercase ? text.toUpperCase() : text}
            </div>
        )
    }
    const renderBandText = (text: string) => {
        if (!text.trim()) return null
        const bandTextSize = Math.min(fontSize, Math.max(14, bandHeightPct * 2.25))
        return (
            <div
                className="absolute inset-0 flex items-center justify-center px-[6%] text-center font-black leading-[0.95] whitespace-nowrap"
                style={{
                    fontFamily,
                    fontSize: `${bandTextSize}px`,
                    color: bandColor,
                    WebkitTextStroke: outlineEnabled ? `${Math.max(2, bandTextSize * 0.055)}px ${outlineColor}` : undefined,
                    textShadow: outlineEnabled ? `0 2px 0 ${outlineColor}` : undefined,
                }}
            >
                {uppercase ? text.toUpperCase() : text}
            </div>
        )
    }
    return (
        <div className="overflow-hidden bg-background">
            {hasTopBand && (
                <div className={cn('relative w-full', bandClass)} style={{ aspectRatio: bandAspect }}>
                    {renderBandText(topText)}
                </div>
            )}
            <div className="relative aspect-video w-full overflow-hidden bg-black">
                {children}
                {canPanCrop && <CropPanLayer onPan={onCropPan} />}
                {showCropOverlay && <CropOverlay crop={crop} editable={cropOverlayEditable} onChange={onCropChange} />}
                {!hasTopBand && renderText(topText, 'top')}
                {!hasBottomBand && renderText(bottomText, 'bottom')}
                {captions.map((caption) => <div key={caption.id}>{renderText(caption.text, caption.zone, caption.color)}</div>)}
            </div>
            {hasBottomBand && (
                <div className={cn('relative w-full', bandClass)} style={{ aspectRatio: bandAspect }}>
                    {renderBandText(bottomText)}
                </div>
            )}
        </div>
    )
}

function ImageGrid({
    images,
    selectedId,
    onSelect,
    onChange,
}: {
    images: GridImage[]
    selectedId: string | null
    onSelect: (id: string) => void
    onChange: (id: string, patch: Partial<GridImage>) => void
}) {
    const dragRef = useRef<{
        id: string
        startX: number
        startY: number
        originX: number
        originY: number
        cellW: number
        cellH: number
    } | null>(null)
    const { cols, rows } = gridTemplate(images.length)

    const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current
        if (!drag) return
        const dxPct = ((event.clientX - drag.startX) / drag.cellW) * 100
        const dyPct = ((event.clientY - drag.startY) / drag.cellH) * 100
        onChange(drag.id, {
            x: clamp(Math.round((drag.originX + dxPct) * 10) / 10, -70, 70),
            y: clamp(Math.round((drag.originY + dyPct) * 10) / 10, -70, 70),
        })
    }

    const stopDrag = () => {
        dragRef.current = null
    }

    return (
        <div
            className="absolute inset-0 grid bg-black"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
            onPointerMove={onPointerMove}
            onPointerUp={stopDrag}
            onPointerCancel={stopDrag}
        >
            {images.map((image) => (
                <div
                    key={image.id}
                    className={cn(
                        'relative overflow-hidden border border-white/15 bg-black',
                        selectedId === image.id && 'ring-2 ring-primary ring-inset',
                    )}
                    onPointerDown={(event) => {
                        const rect = event.currentTarget.getBoundingClientRect()
                        onSelect(image.id)
                        dragRef.current = {
                            id: image.id,
                            startX: event.clientX,
                            startY: event.clientY,
                            originX: image.x,
                            originY: image.y,
                            cellW: rect.width,
                            cellH: rect.height,
                        }
                        event.currentTarget.setPointerCapture(event.pointerId)
                    }}
                >
                    <img
                        src={image.url}
                        alt=""
                        draggable={false}
                        className="absolute left-1/2 top-1/2 h-full w-full select-none object-cover"
                        style={{
                            transform: `translate(calc(-50% + ${image.x}%), calc(-50% + ${image.y}%)) scale(${image.scale})`,
                            transformOrigin: 'center',
                        }}
                    />
                </div>
            ))}
        </div>
    )
}

function CropPanLayer({ onPan }: { onPan: (dxPct: number, dyPct: number) => void }) {
    const dragRef = useRef<{
        startX: number
        startY: number
        width: number
        height: number
        lastDx: number
        lastDy: number
    } | null>(null)

    const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current
        if (!drag) return
        const rect = event.currentTarget.getBoundingClientRect()
        const isOutside =
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
        if (isOutside) {
            stop()
            return
        }
        const dx = ((event.clientX - drag.startX) / drag.width) * 100
        const dy = ((event.clientY - drag.startY) / drag.height) * 100
        onPan(dx - drag.lastDx, dy - drag.lastDy)
        drag.lastDx = dx
        drag.lastDy = dy
    }

    const stop = () => {
        dragRef.current = null
    }

    return (
        <div
            className="absolute inset-0 z-10 cursor-move touch-none"
            onPointerDown={(event) => {
                const rect = event.currentTarget.getBoundingClientRect()
                dragRef.current = {
                    startX: event.clientX,
                    startY: event.clientY,
                    width: rect.width || 1,
                    height: rect.height || 1,
                    lastDx: 0,
                    lastDy: 0,
                }
            }}
            onPointerMove={onPointerMove}
            onPointerUp={stop}
            onPointerLeave={stop}
            onPointerCancel={stop}
            aria-label="Déplacer le crop"
        />
    )
}

function CropOverlay({ crop, editable, onChange }: { crop: CropSettings; editable: boolean; onChange: (crop: CropSettings) => void }) {
    const dragRef = useRef<{
        handle: string
        startX: number
        startY: number
        rect: DOMRect
        origin: CropSettings
    } | null>(null)
    const left = crop.left
    const top = crop.top
    const width = 100 - crop.left - crop.right
    const height = 100 - crop.top - crop.bottom

    const updateFromDrag = (event: PointerEvent<HTMLElement>) => {
        const drag = dragRef.current
        if (!drag) return
        const dx = ((event.clientX - drag.startX) / drag.rect.width) * 100
        const dy = ((event.clientY - drag.startY) / drag.rect.height) * 100
        const next = { ...drag.origin }
        if (drag.handle === 'move') {
            const frameW = 100 - drag.origin.left - drag.origin.right
            const frameH = 100 - drag.origin.top - drag.origin.bottom
            const left = clamp(Math.round((drag.origin.left + dx) * 10) / 10, 0, 100 - frameW)
            const top = clamp(Math.round((drag.origin.top + dy) * 10) / 10, 0, 100 - frameH)
            next.left = left
            next.right = Math.round((100 - frameW - left) * 10) / 10
            next.top = top
            next.bottom = Math.round((100 - frameH - top) * 10) / 10
        } else {
            if (drag.handle.includes('l')) next.left = clamp(Math.round((drag.origin.left + dx) * 10) / 10, 0, 80 - drag.origin.right)
            if (drag.handle.includes('r')) next.right = clamp(Math.round((drag.origin.right - dx) * 10) / 10, 0, 80 - drag.origin.left)
            if (drag.handle.includes('t')) next.top = clamp(Math.round((drag.origin.top + dy) * 10) / 10, 0, 80 - drag.origin.bottom)
            if (drag.handle.includes('b')) next.bottom = clamp(Math.round((drag.origin.bottom - dy) * 10) / 10, 0, 80 - drag.origin.top)
        }
        onChange(next)
    }

    const start = (handle: string) => (event: PointerEvent<HTMLElement>) => {
        const parent = event.currentTarget.closest('[data-crop-stage]')
        if (!parent) return
        event.stopPropagation()
        dragRef.current = {
            handle,
            startX: event.clientX,
            startY: event.clientY,
            rect: parent.getBoundingClientRect(),
            origin: crop,
        }
        event.currentTarget.setPointerCapture(event.pointerId)
    }

    const stop = () => {
        dragRef.current = null
    }

    const handleClass = 'absolute h-4 w-4 rounded-full border-2 border-white bg-primary shadow-md'
    return (
        <div
            data-crop-stage
            className="pointer-events-none absolute inset-0 z-20"
            onPointerMove={editable ? updateFromDrag : undefined}
            onPointerUp={editable ? stop : undefined}
            onPointerCancel={editable ? stop : undefined}
        >
            <div className="absolute inset-0 pointer-events-none">
                <div className="absolute left-0 right-0 top-0 bg-black/45" style={{ height: `${top}%` }} />
                <div className="absolute left-0 right-0 bottom-0 bg-black/45" style={{ height: `${crop.bottom}%` }} />
                <div className="absolute bottom-0 left-0 top-0 bg-black/45" style={{ width: `${left}%`, top: `${top}%`, bottom: `${crop.bottom}%` }} />
                <div className="absolute bottom-0 right-0 top-0 bg-black/45" style={{ width: `${crop.right}%`, top: `${top}%`, bottom: `${crop.bottom}%` }} />
            </div>
            <div
                className={cn(
                    'absolute border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.45)]',
                    editable ? 'pointer-events-auto cursor-move' : 'pointer-events-none',
                )}
                style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}
                onPointerDown={editable ? start('move') : undefined}
                aria-label="Déplacer le cadre crop"
            >
                <div className="pointer-events-none absolute inset-x-1/3 top-0 h-full border-x border-white/55" />
                <div className="pointer-events-none absolute inset-y-1/3 left-0 w-full border-y border-white/55" />
                {editable && [
                    ['tl', '-left-2 -top-2 cursor-nwse-resize', 'Crop haut gauche'],
                    ['t', 'left-1/2 -top-2 -translate-x-1/2 cursor-ns-resize', 'Crop haut'],
                    ['tr', '-right-2 -top-2 cursor-nesw-resize', 'Crop haut droit'],
                    ['l', '-left-2 top-1/2 -translate-y-1/2 cursor-ew-resize', 'Crop gauche'],
                    ['r', '-right-2 top-1/2 -translate-y-1/2 cursor-ew-resize', 'Crop droite'],
                    ['bl', '-bottom-2 -left-2 cursor-nesw-resize', 'Crop bas gauche'],
                    ['b', '-bottom-2 left-1/2 -translate-x-1/2 cursor-ns-resize', 'Crop bas'],
                    ['br', '-bottom-2 -right-2 cursor-nwse-resize', 'Crop bas droit'],
                ].map(([handle, className, label]) => (
                    <button
                        key={handle}
                        type="button"
                        aria-label={label}
                        onPointerDown={start(handle)}
                        className={cn(handleClass, 'pointer-events-auto', className)}
                    />
                ))}
            </div>
        </div>
    )
}

function ControlLabel({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
            {children}
        </label>
    )
}

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
    return (
        <ControlLabel label={label}>
            <input type="color" value={value} onChange={(event) => onChange(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background p-1" />
        </ControlLabel>
    )
}

function NumberInput({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (value: number) => void }) {
    return (
        <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-muted-foreground">{label}</span>
            <input
                type="number"
                min={0}
                max={max}
                step={0.1}
                value={Number.isFinite(value) ? value.toFixed(1) : '0.0'}
                onChange={(event) => onChange(Number(event.target.value))}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
            />
        </label>
    )
}
