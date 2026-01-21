import { useState, useCallback, useRef, useEffect } from 'react'
import type { QueueItem, ConvertSettings, CompressSettings, MediaCategory, JobResponse } from '@/types'
import { VIDEO_FORMATS, AUDIO_FORMATS, IMAGE_FORMATS } from '@/types'

const MAX_CONCURRENT_UPLOADS = 8
const POLL_INTERVAL_MS = 1500

function generateId(): string {
    return Math.random().toString(36).substring(7)
}

export function useConverter() {
    const [queue, setQueue] = useState<QueueItem[]>([])
    const [currentAction, setCurrentAction] = useState<'convert' | 'compress'>('convert')
    const [isProcessing, setIsProcessing] = useState(false)
    const [hasStarted, setHasStarted] = useState(false)
    const pollingRef = useRef<number | null>(null)
    const uploadingRef = useRef(false)

    // Convert settings
    const [convertSettings, setConvertSettings] = useState<ConvertSettings>({
        category: null,
        format: '',
        gifSpeed: '0.1',
        gifFps: '20',
        gifResolution: '480',
        audioBitrate: '192k',
        imageQuality: '90',
        imageMaxSize: '',
        icoSize: '256',
    })

    // Compress settings
    const [compressSettings, setCompressSettings] = useState<CompressSettings>({
        mode: 'crf',
        crfLevel: 'medium',
        targetSizeMb: '',
        percentReduction: '50',
        resolution: '720',
        advancedEnabled: false,
        fps: '',
        preset: 'medium',
        audioBitrate: '',
        audioChannels: '',
        audioSampleRate: '',
        imageMaxSize: '',
    })

    // Computed values
    const pendingCount = queue.filter((item) => item.status === 'pending').length
    const completedCount = queue.filter((item) => item.status === 'done').length
    const totalCount = queue.length
    const hasCompletedFiles = completedCount > 0
    const hasNewFiles = queue.some((x) => x.file && x.status === 'pending')

    const canStart = currentAction === 'convert'
        ? hasNewFiles && !!convertSettings.category && !!convertSettings.format
        : hasNewFiles

    // Add files to queue
    const addFiles = useCallback(async (files: FileList | File[]) => {
        const newItems: QueueItem[] = []

        for (const file of Array.from(files)) {
            const baseName = file.name || ''
            const lowerName = baseName.toLowerCase()

            // Skip hidden/meta files
            if (baseName.startsWith('._') || lowerName === '.ds_store' || lowerName === 'thumbs.db') {
                continue
            }
            if (['cover.jpg', 'cover.jpeg', 'cover.png'].includes(lowerName)) {
                continue
            }

            newItems.push({
                id: generateId(),
                file,
                relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || '',
                status: 'pending',
                jobId: null,
                downloadUrl: null,
                outputFilename: null,
                error: null,
                action: currentAction,
                targetFormat: currentAction === 'convert' ? convertSettings.format : null,
            })
        }

        setQueue((prev) => [...prev, ...newItems])
    }, [currentAction, convertSettings.format])

    // Remove file from queue
    const removeFile = useCallback((id: string) => {
        setQueue((prev) => prev.filter((item) => item.id !== id))
    }, [])

    // Clear all files
    const clearAll = useCallback(async () => {
        try {
            await fetch('/clear-all', { method: 'DELETE' })
        } catch (e) {
            console.error('Failed to clear server files:', e)
        }
        setQueue([])
    }, [])

    // Upload a single item
    const uploadItem = useCallback(async (item: QueueItem): Promise<void> => {
        const formData = new FormData()
        formData.append('file', item.file)
        if (item.relativePath) {
            formData.append('relative_path', item.relativePath)
        }
        formData.append('action', item.action)

        if (item.action === 'convert') {
            const targetFormat = item.targetFormat || convertSettings.format
            formData.append('format', targetFormat)

            // GIF settings
            if (convertSettings.category === 'video' && targetFormat === 'gif') {
                formData.append('gif_speed', convertSettings.gifSpeed)
                formData.append('gif_fps', convertSettings.gifFps)
                formData.append('gif_resolution', convertSettings.gifResolution)
            }

            // Audio settings
            if (convertSettings.category === 'audio') {
                formData.append('audio_bitrate', convertSettings.audioBitrate)
            }

            // Image settings
            if (convertSettings.category === 'image') {
                if (convertSettings.imageQuality === 'lossless') {
                    formData.append('lossless', 'true')
                } else {
                    formData.append('image_quality', convertSettings.imageQuality)
                }
                if (convertSettings.imageMaxSize) {
                    formData.append('image_max_size', convertSettings.imageMaxSize)
                }
                if (targetFormat === 'ico' && convertSettings.icoSize) {
                    formData.append('ico_size', convertSettings.icoSize)
                }
            }
        } else {
            // Compress mode
            formData.append('comp_mode', compressSettings.mode)

            let compValue = ''
            if (compressSettings.mode === 'crf') {
                compValue = compressSettings.crfLevel
            } else if (compressSettings.mode === 'size') {
                compValue = compressSettings.targetSizeMb
            } else if (compressSettings.mode === 'percent') {
                compValue = compressSettings.percentReduction
            } else if (compressSettings.mode === 'res') {
                compValue = compressSettings.resolution
            }
            formData.append('comp_value', compValue)

            if (compressSettings.advancedEnabled) {
                if (compressSettings.fps) formData.append('fps', compressSettings.fps)
                if (compressSettings.preset) formData.append('video_preset', compressSettings.preset)
                if (compressSettings.audioBitrate) formData.append('audio_bitrate', compressSettings.audioBitrate)
                if (compressSettings.audioChannels) formData.append('audio_channels', compressSettings.audioChannels)
                if (compressSettings.audioSampleRate) formData.append('audio_sample_rate', compressSettings.audioSampleRate)
            }

            if (compressSettings.imageMaxSize) {
                formData.append('image_max_size', compressSettings.imageMaxSize)
            }
        }

        setQueue((prev) =>
            prev.map((i) => (i.id === item.id ? { ...i, status: 'uploading' as const } : i))
        )

        try {
            const response = await fetch('/jobs', {
                method: 'POST',
                body: formData,
            })

            const data = await response.json()

            if (response.ok) {
                setQueue((prev) =>
                    prev.map((i) =>
                        i.id === item.id
                            ? { ...i, status: 'queued' as const, jobId: data.job_id }
                            : i
                    )
                )
            } else {
                throw new Error(data.error || `HTTP ${response.status}`)
            }
        } catch (error) {
            setQueue((prev) =>
                prev.map((i) =>
                    i.id === item.id
                        ? { ...i, status: 'error' as const, error: String(error) }
                        : i
                )
            )
        }
    }, [convertSettings, compressSettings])

    // Poll for job updates
    const pollJobs = useCallback(async () => {
        try {
            const response = await fetch('/jobs?limit=200')
            if (!response.ok) return

            const data = await response.json()
            const jobsMap = new Map<string, JobResponse>()
                ; (data.jobs || []).forEach((j: JobResponse) => jobsMap.set(j.id, j))

            setQueue((prev) =>
                prev.map((item) => {
                    if (!item.jobId || (item.status !== 'queued' && item.status !== 'processing')) {
                        return item
                    }

                    const job = jobsMap.get(item.jobId)
                    if (!job) return item

                    if (job.status === 'processing' && item.status !== 'processing') {
                        return { ...item, status: 'processing' as const }
                    }

                    if (job.status === 'done') {
                        return {
                            ...item,
                            status: 'done' as const,
                            downloadUrl: job.download_url,
                            outputFilename: job.output_filename,
                        }
                    }

                    if (job.status === 'error') {
                        return { ...item, status: 'error' as const, error: job.error }
                    }

                    return item
                })
            )
        } catch (e) {
            console.error('Polling error', e)
        }
    }, [])

    // Start processing
    const startProcessing = useCallback(async () => {
        if (isProcessing || !canStart) return

        setIsProcessing(true)
        setHasStarted(true)
        uploadingRef.current = true

        // Update pending items with current settings and reuse the same snapshot for uploads
        const updatedQueue = queue.map((item) =>
            item.status === 'pending'
                ? {
                    ...item,
                    action: currentAction,
                    targetFormat: currentAction === 'convert' ? convertSettings.format : null,
                }
                : item
        )
        setQueue(updatedQueue)

        // Start polling
        if (!pollingRef.current) {
            pollingRef.current = window.setInterval(pollJobs, POLL_INTERVAL_MS)
        }

        // Get pending items
        const pendingItems = updatedQueue.filter((item) => item.status === 'pending')
        let index = 0
        const activeUploads: Promise<void>[] = []

        while (index < pendingItems.length || activeUploads.length > 0) {
            while (activeUploads.length < MAX_CONCURRENT_UPLOADS && index < pendingItems.length) {
                const item = pendingItems[index++]
                const p = uploadItem(item).then(() => {
                    const idx = activeUploads.indexOf(p)
                    if (idx > -1) activeUploads.splice(idx, 1)
                })
                activeUploads.push(p)
            }

            if (activeUploads.length === 0) break
            await Promise.race(activeUploads)
        }

        uploadingRef.current = false
        setIsProcessing(false)
    }, [isProcessing, canStart, currentAction, convertSettings.format, queue, uploadItem, pollJobs])

    // Stop polling when all done
    useEffect(() => {
        const activeItems = queue.filter(
            (item) => (item.status === 'queued' || item.status === 'processing') && item.jobId
        )
        const anyPending = queue.some((x) => x.status === 'pending')

        if (activeItems.length === 0 && !uploadingRef.current && !anyPending && pollingRef.current) {
            clearInterval(pollingRef.current)
            pollingRef.current = null
        }
    }, [queue])

    // Cleanup polling on unmount
    useEffect(() => {
        return () => {
            if (pollingRef.current) {
                clearInterval(pollingRef.current)
            }
        }
    }, [])

    const setCategory = useCallback((category: MediaCategory) => {
        const defaultFormat = category === 'video'
            ? VIDEO_FORMATS[0]
            : category === 'audio'
                ? AUDIO_FORMATS[0]
                : category === 'image'
                    ? IMAGE_FORMATS[0]
                    : ''

        setConvertSettings((prev) => ({
            ...prev,
            category,
            format: defaultFormat,
        }))
    }, [])

    const setFormat = useCallback((format: string) => {
        setConvertSettings((prev) => ({ ...prev, format }))
    }, [])

    return {
        // State
        queue,
        currentAction,
        convertSettings,
        compressSettings,
        isProcessing,
        hasStarted,
        // Computed
        pendingCount,
        completedCount,
        totalCount,
        hasCompletedFiles,
        canStart,
        // Actions
        addFiles,
        removeFile,
        clearAll,
        startProcessing,
        setCurrentAction,
        setCategory,
        setFormat,
        setConvertSettings,
        setCompressSettings,
    }
}
