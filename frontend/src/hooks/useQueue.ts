// ──────────────────────────────────────────────────────────
// The file list shared by "Convertir" and "Color Lab", and the engine that
// runs it: one transfer at a time (friendly to a Cloudflare Tunnel), local
// processing with automatic server fallback, job polling, restore after a
// reload, downloads.
// ──────────────────────────────────────────────────────────
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
    clearAllJobs, createJob, deleteJob, fetchJobs, triggerDownload, uploadFile, withRate,
    type ServerConfig,
} from '@/lib/api'
import { releaseObjectUrl } from '@/lib/objectUrl'
import { DEFAULT_FORMAT, isActive, kindOf, type MediaKind, type QueueItem } from '@/types'

export interface ServerPlan {
    action: 'convert' | 'compress' | 'convert_compress'
    format: string
    fields: Record<string, string>
    lut?: File | null
}

export interface LocalPlan {
    run: (ctx: {
        file: File
        onProgress: (ratio: number) => void
        signal: AbortSignal
    }) => Promise<{ blob: Blob; filename: string }>
}

/** `local` is tried first; `server` is the fallback (or the only path). */
export interface JobPlan {
    local?: LocalPlan
    server?: ServerPlan
}

interface Transfer {
    chunkSize: number
    rateLimit: number
}

const STORAGE_KEY = 'convertisseur_jobs_v2'

interface StoredJob {
    jobId: string
    name: string
    size: number
    kind: QueueItem['kind']
    targetFormat: string
}

let idCounter = 0
function newId(): string {
    idCounter += 1
    return `${Date.now().toString(36)}-${idCounter}-${Math.random().toString(36).slice(2, 7)}`
}

function errorMessage(e: unknown): string {
    if (e instanceof Error) return e.message
    return String(e)
}

function isAbort(e: unknown): boolean {
    return e instanceof DOMException && e.name === 'AbortError'
}

/** Ref that always holds the latest committed value (read from async code). */
function useLatest<T>(value: T) {
    const ref = useRef(value)
    useLayoutEffect(() => { ref.current = value }, [value])
    return ref
}

function releaseResult(it: QueueItem) {
    if (it.local && it.downloadUrl?.startsWith('blob:')) URL.revokeObjectURL(it.downloadUrl)
}

function releaseItem(it: QueueItem) {
    releaseResult(it)
    releaseObjectUrl(it.file)
}

export function useQueue(config: ServerConfig, rateLimit: number, autoDownload: boolean) {
    const [items, setItems] = useState<QueueItem[]>([])
    const itemsRef = useLatest(items)

    const [kindFormats, setKindFormats] = useState<Record<MediaKind, string>>({ ...DEFAULT_FORMAT })

    const transfer = useMemo<Transfer>(() => ({ chunkSize: config.chunk_size, rateLimit }), [config.chunk_size, rateLimit])
    const transferRef = useLatest(transfer)

    const tasksRef = useRef<{ id: string; plan: JobPlan }[]>([])
    const pumpingRef = useRef(false)
    const controllersRef = useRef(new Map<string, AbortController>())
    const batchRef = useRef<Set<string> | null>(null)
    const autoDownloadRef = useLatest(autoDownload)

    const patch = useCallback((id: string, update: Partial<QueueItem>) => {
        setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...update } : it)))
    }, [])

    const setProgress = useCallback((id: string, pct: number) => {
        const value = Math.max(0, Math.min(100, Math.round(pct)))
        setItems((prev) => {
            const idx = prev.findIndex((it) => it.id === id)
            if (idx < 0 || prev[idx].progress === value) return prev
            const next = prev.slice()
            next[idx] = { ...prev[idx], progress: value }
            return next
        })
    }, [])

    // ── Adding / removing ──────────────────────────────────
    const add = useCallback((files: File[]): QueueItem[] => {
        const added: QueueItem[] = files
            .filter((f) => !f.name.startsWith('._') && !['.ds_store', 'thumbs.db'].includes(f.name.toLowerCase()))
            .map((file) => {
                const kind = kindOf(file.name)
                const known = kind !== 'unknown'
                return {
                    id: newId(),
                    file,
                    name: file.name,
                    size: file.size,
                    kind,
                    relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || '',
                    targetFormat: known ? kindFormats[kind] : '',
                    status: known ? 'pending' : 'error',
                    progress: 0,
                    jobId: null,
                    local: false,
                    downloadUrl: null,
                    outputName: null,
                    outputSize: null,
                    error: known ? null : 'Format non pris en charge',
                }
            })
        setItems((prev) => [...prev, ...added])
        return added
    }, [kindFormats])

    const addItem = useCallback((item: Omit<QueueItem, 'id'>): string => {
        const id = newId()
        setItems((prev) => [...prev, { ...item, id }])
        return id
    }, [])

    const remove = useCallback((ids: string | string[]) => {
        const set = new Set(Array.isArray(ids) ? ids : [ids])
        tasksRef.current = tasksRef.current.filter((t) => !set.has(t.id))
        for (const id of set) {
            controllersRef.current.get(id)?.abort()
            const it = itemsRef.current.find((i) => i.id === id)
            if (it) {
                releaseItem(it)
                if (it.jobId && !it.local) deleteJob(it.jobId)
            }
        }
        setItems((prev) => prev.filter((it) => !set.has(it.id)))
    }, [itemsRef])

    const clear = useCallback(async () => {
        tasksRef.current = []
        for (const c of controllersRef.current.values()) c.abort()
        itemsRef.current.forEach(releaseItem)
        setItems([])
        batchRef.current = null
        await clearAllJobs()
    }, [itemsRef])

    // ── Formats ───────────────────────────────────────────
    const setFormat = useCallback((id: string, format: string) => {
        patch(id, { targetFormat: format })
    }, [patch])

    const setFormatForKind = useCallback((kind: MediaKind, format: string) => {
        setKindFormats((prev) => ({ ...prev, [kind]: format }))
        setItems((prev) => prev.map((it) => (
            it.kind === kind && (it.status === 'pending' || it.status === 'done' || it.status === 'error') && it.file
                ? { ...it, targetFormat: format }
                : it
        )))
    }, [])

    // ── Engine ────────────────────────────────────────────
    const execute = useCallback(async (item: QueueItem, plan: JobPlan, signal: AbortSignal) => {
        const file = item.file
        if (!file) throw new Error('fichier source indisponible')

        if (plan.local) {
            try {
                patch(item.id, { status: 'processing', progress: 0, local: true })
                const { blob, filename } = await plan.local.run({
                    file,
                    signal,
                    onProgress: (r) => setProgress(item.id, r * 100),
                })
                patch(item.id, {
                    status: 'done', progress: 100, local: true,
                    downloadUrl: URL.createObjectURL(blob), outputName: filename, outputSize: blob.size,
                })
                return
            } catch (e) {
                if (signal.aborted || isAbort(e) || !plan.server) throw e
                console.info(`[${item.name}] navigateur → serveur :`, errorMessage(e))
            }
        }

        const server = plan.server
        if (!server) throw new Error('aucun traitement possible')
        patch(item.id, { status: 'uploading', progress: 0, local: false })
        const files = [file, ...(item.extraFiles ?? [])]
        const total = files.reduce((n, f) => n + f.size, 0) || 1
        const uploadIds: string[] = []
        let sentBefore = 0
        for (const f of files) {
            const { chunkSize, rateLimit: rate } = transferRef.current
            uploadIds.push(await uploadFile(f, {
                chunkSize,
                rateLimit: rate,
                signal,
                onProgress: (sent) => setProgress(item.id, ((sentBefore + sent) / total) * 100),
            }))
            sentBefore += f.size
        }
        const fields: Record<string, string> = { ...server.fields, action: server.action, upload_ids: uploadIds.join(',') }
        if (server.format) fields.format = server.format
        if (item.relativePath) fields.relative_path = item.relativePath
        const jobId = await createJob(fields, server.lut ? [{ name: 'lut_file', file: server.lut }] : [], signal)
        patch(item.id, { status: 'queued', progress: 0, jobId })
    }, [patch, setProgress, transferRef])

    const pump = useCallback(async () => {
        if (pumpingRef.current) return
        pumpingRef.current = true
        try {
            while (tasksRef.current.length) {
                const task = tasksRef.current.shift()!
                const item = itemsRef.current.find((i) => i.id === task.id)
                if (!item) continue
                const ctrl = new AbortController()
                controllersRef.current.set(item.id, ctrl)
                try {
                    await execute(item, task.plan, ctrl.signal)
                } catch (e) {
                    if (!ctrl.signal.aborted && !isAbort(e)) {
                        patch(item.id, { status: 'error', error: errorMessage(e) })
                    }
                } finally {
                    controllersRef.current.delete(item.id)
                }
            }
        } finally {
            pumpingRef.current = false
        }
    }, [execute, patch, itemsRef])

    /** Queue items for processing. Re-running a finished item replaces its result. */
    const run = useCallback((entries: { id: string; plan: JobPlan }[]) => {
        if (entries.length === 0) return
        const ids = new Set(entries.map((e) => e.id))
        for (const it of itemsRef.current) {
            if (!ids.has(it.id)) continue
            releaseResult(it)
            if (it.jobId && !it.local) deleteJob(it.jobId)
        }
        setItems((prev) => prev.map((it) => (ids.has(it.id)
            ? { ...it, status: 'queued', progress: 0, error: null, jobId: null, downloadUrl: null, outputName: null, outputSize: null, local: false }
            : it)))
        tasksRef.current = tasksRef.current.filter((t) => !ids.has(t.id)).concat(entries)
        batchRef.current = new Set([...(batchRef.current ?? []), ...ids])
        // Let React commit the "queued" state before the engine reads items.
        window.setTimeout(() => { void pump() }, 0)
    }, [pump, itemsRef])

    // ── Polling server jobs ───────────────────────────────
    const hasServerWork = useMemo(
        () => items.some((it) => it.jobId && !it.local && (it.status === 'queued' || it.status === 'processing')),
        [items],
    )

    useEffect(() => {
        if (!hasServerWork) return
        let stopped = false
        const tick = async () => {
            const active = itemsRef.current.filter(
                (it) => it.jobId && !it.local && (it.status === 'queued' || it.status === 'processing'),
            )
            if (active.length === 0) return
            try {
                const jobs = await fetchJobs(active.map((it) => it.jobId!))
                if (stopped) return
                const byId = new Map(jobs.map((j) => [j.id, j]))
                setItems((prev) => prev.map((it) => {
                    if (!it.jobId || it.local || !(it.status === 'queued' || it.status === 'processing')) return it
                    if (!active.some((a) => a.id === it.id)) return it
                    const job = byId.get(it.jobId)
                    if (!job) return { ...it, status: 'error', error: 'Tâche introuvable (expirée ou serveur redémarré)' }
                    if (job.status === 'done') {
                        return {
                            ...it, status: 'done', progress: 100,
                            downloadUrl: job.download_url, outputName: job.output_filename, outputSize: job.output_size,
                        }
                    }
                    if (job.status === 'error') return { ...it, status: 'error', error: job.error || 'Échec de la conversion' }
                    if (job.status === it.status && job.progress === it.progress) return it
                    return { ...it, status: job.status, progress: job.progress }
                }))
            } catch {
                // Network hiccup (tunnel reconnecting): keep polling.
            }
        }
        const interval = window.setInterval(tick, config.tunnel ? 2000 : 1000)
        void tick()
        return () => {
            stopped = true
            window.clearInterval(interval)
        }
    }, [hasServerWork, config.tunnel, itemsRef])

    // ── Persist server jobs so a reload doesn't lose results ──
    // Read before any effect runs: the persist effect below would otherwise
    // overwrite the saved list with the (still empty) initial state.
    const [savedJobs] = useState<StoredJob[]>(() => {
        try {
            const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
            return Array.isArray(parsed) ? parsed : []
        } catch {
            return []
        }
    })
    const [restoring, setRestoring] = useState(savedJobs.length > 0)

    useEffect(() => {
        if (restoring) return
        const stored: StoredJob[] = items
            .filter((it) => it.jobId && !it.local && it.status !== 'error')
            .map((it) => ({ jobId: it.jobId!, name: it.name, size: it.size, kind: it.kind, targetFormat: it.targetFormat }))
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stored)) } catch { /* ignore */ }
    }, [items, restoring])

    useEffect(() => {
        if (savedJobs.length === 0) return
        fetchJobs(savedJobs.map((s) => s.jobId)).then((jobs) => {
            const byId = new Map(jobs.map((j) => [j.id, j]))
            const restored: QueueItem[] = []
            for (const s of savedJobs) {
                const job = byId.get(s.jobId)
                if (!job || job.status === 'error') continue
                restored.push({
                    id: newId(), file: null, name: s.name, size: s.size, kind: s.kind, relativePath: '',
                    targetFormat: s.targetFormat, status: job.status, progress: job.progress, jobId: job.id,
                    local: false, downloadUrl: job.download_url, outputName: job.output_filename,
                    outputSize: job.output_size, error: null,
                })
            }
            if (restored.length) {
                setItems((prev) => [...restored.filter((r) => !prev.some((p) => p.jobId === r.jobId)), ...prev])
            }
        }).catch(() => undefined).finally(() => setRestoring(false))
    }, [savedJobs])

    // ── Downloads ─────────────────────────────────────────
    const hrefFor = useCallback((it: QueueItem) => (
        it.local ? it.downloadUrl! : withRate(it.downloadUrl!, transferRef.current.rateLimit)
    ), [transferRef])

    const download = useCallback((it: QueueItem) => {
        if (it.status !== 'done' || !it.downloadUrl) return
        triggerDownload(hrefFor(it), it.outputName || undefined)
    }, [hrefFor])

    const downloadMany = useCallback(async (list: QueueItem[]) => {
        const done = list.filter((it) => it.status === 'done' && it.downloadUrl)
        if (done.length === 0) return
        if (done.length === 1) return download(done[0])
        if (done.every((it) => !it.local)) {
            const ids = done.map((it) => it.jobId).join(',')
            triggerDownload(withRate(`/download-all?ids=${ids}`, transferRef.current.rateLimit), 'fichiers_convertis.zip')
            return
        }
        const { downloadZipFromItems } = await import('@/lib/zipClient')
        await downloadZipFromItems(done.map((it) => ({ url: hrefFor(it), name: it.outputName || it.name })))
    }, [download, hrefFor, transferRef])

    // Auto-download when everything started together has finished.
    useEffect(() => {
        const batch = batchRef.current
        if (!batch) return
        const members = items.filter((it) => batch.has(it.id))
        if (members.some((it) => isActive(it.status))) return
        batchRef.current = null
        if (autoDownloadRef.current) void downloadMany(members)
    }, [items, downloadMany, autoDownloadRef])

    const reset = useCallback((id: string) => {
        const it = itemsRef.current.find((i) => i.id === id)
        if (!it?.file) return
        releaseResult(it)
        patch(id, { status: 'pending', progress: 0, error: null, jobId: null, downloadUrl: null, outputName: null, outputSize: null, local: false })
    }, [patch, itemsRef])

    return {
        items,
        kindFormats,
        add,
        addItem,
        remove,
        clear,
        reset,
        setFormat,
        setFormatForKind,
        run,
        download,
        downloadMany,
    }
}

export type QueueApi = ReturnType<typeof useQueue>
