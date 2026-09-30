// ──────────────────────────────────────────────────────────
// Server API: config, chunked + throttled uploads, jobs.
// ──────────────────────────────────────────────────────────

export interface ServerConfig {
    /** Deployed commit (set by scripts/manage.sh). */
    version: string
    /** The page is served through a Cloudflare Tunnel. */
    tunnel: boolean
    chunk_size: number
    tunnel_rate_limit_mbps: number
    retention_seconds: number
    max_upload_bytes: number
}

export const FALLBACK_CONFIG: ServerConfig = {
    version: '',
    tunnel: false,
    chunk_size: 8 * 1024 * 1024,
    tunnel_rate_limit_mbps: 5,
    retention_seconds: 3 * 3600,
    max_upload_bytes: 10 * 1024 ** 3,
}

export interface JobInfo {
    id: string
    status: 'queued' | 'processing' | 'done' | 'error'
    error: string | null
    progress: number
    download_url: string | null
    output_filename: string | null
    output_size: number | null
    original_filename: string
    media_type: string | null
    target_format: string | null
}

export class HttpError extends Error {
    status: number
    body: Record<string, unknown>
    constructor(status: number, body: Record<string, unknown>) {
        super(typeof body.error === 'string' ? body.error : `Erreur serveur (HTTP ${status})`)
        this.status = status
        this.body = body
    }
}

async function json<T>(res: Response): Promise<T> {
    let body: Record<string, unknown> = {}
    try {
        body = await res.json()
    } catch {
        // Cloudflare error pages are HTML
        if (res.status === 413) body = { error: 'Fichier refusé par le tunnel (trop gros pour une requête)' }
        else if (res.status === 524 || res.status === 522) body = { error: 'Le tunnel a expiré (serveur trop lent à répondre)' }
    }
    if (!res.ok) throw new HttpError(res.status, body)
    return body as T
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'))
        const t = window.setTimeout(resolve, ms)
        signal?.addEventListener('abort', () => {
            window.clearTimeout(t)
            reject(new DOMException('Aborted', 'AbortError'))
        }, { once: true })
    })
}

export async function fetchConfig(): Promise<ServerConfig> {
    const res = await fetch('/api/config', { cache: 'no-store' })
    return { ...FALLBACK_CONFIG, ...(await json<Partial<ServerConfig>>(res)) }
}

function putChunk(
    url: string,
    blob: Blob,
    offset: number,
    onProgress: (loaded: number) => void,
    signal?: AbortSignal,
): Promise<{ size: number }> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('PUT', url)
        xhr.setRequestHeader('Content-Type', 'application/octet-stream')
        xhr.setRequestHeader('X-Upload-Offset', String(offset))
        xhr.upload.onprogress = (e) => onProgress(e.loaded)
        xhr.onload = () => {
            let body: Record<string, unknown> = {}
            try { body = JSON.parse(xhr.responseText) } catch { /* HTML error page */ }
            if (xhr.status >= 200 && xhr.status < 300) resolve(body as { size: number })
            else reject(new HttpError(xhr.status, body))
        }
        xhr.onerror = () => reject(new HttpError(0, { error: 'Connexion interrompue' }))
        xhr.ontimeout = () => reject(new HttpError(0, { error: 'Délai dépassé' }))
        const onAbort = () => xhr.abort()
        xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'))
        signal?.addEventListener('abort', onAbort, { once: true })
        xhr.send(blob)
    })
}

export interface UploadOptions {
    chunkSize: number
    /** bytes per second, 0 = unlimited */
    rateLimit: number
    onProgress?: (sent: number, total: number) => void
    signal?: AbortSignal
}

/**
 * Upload in chunks with automatic resume. Each chunk is its own small
 * request, which keeps us under Cloudflare's 100 MB body limit; when a
 * connection drops we ask the server how much it has and continue from there.
 */
export async function uploadFile(file: File, opts: UploadOptions): Promise<string> {
    const { signal } = opts
    const init = await json<{ upload_id: string; chunk_size: number }>(
        await fetch('/uploads', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: file.name, size: file.size }),
            signal,
        }),
    )
    const id = init.upload_id
    const url = `/uploads/${id}`
    // With a rate limit, ~1 s chunks keep the pacing smooth.
    let chunkSize = Math.min(opts.chunkSize, init.chunk_size || opts.chunkSize)
    if (opts.rateLimit > 0) chunkSize = Math.max(256 * 1024, Math.min(chunkSize, opts.rateLimit))

    let offset = 0
    let failures = 0
    const started = performance.now()
    let paced = 0

    try {
        while (offset < file.size) {
            const end = Math.min(file.size, offset + chunkSize)
            const base = offset
            try {
                const res = await putChunk(url, file.slice(base, end), base, (loaded) => {
                    opts.onProgress?.(base + loaded, file.size)
                }, signal)
                paced += res.size - offset
                offset = res.size
                failures = 0
            } catch (e) {
                if (signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) throw e
                if (e instanceof HttpError && e.status === 409 && typeof e.body.size === 'number') {
                    offset = e.body.size
                    continue
                }
                if (e instanceof HttpError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) throw e
                failures += 1
                if (failures > 8) throw e
                await sleep(Math.min(30_000, 1000 * 2 ** (failures - 1)), signal)
                try {
                    const status = await json<{ size: number }>(await fetch(url, { cache: 'no-store', signal }))
                    offset = status.size
                } catch (probe) {
                    if (probe instanceof HttpError && probe.status === 404) throw probe
                }
                continue
            }
            opts.onProgress?.(offset, file.size)
            if (opts.rateLimit > 0) {
                const ahead = (paced / opts.rateLimit) * 1000 - (performance.now() - started)
                if (ahead > 0) await sleep(ahead, signal)
            }
        }
    } catch (e) {
        fetch(url, { method: 'DELETE' }).catch(() => undefined)
        throw e
    }
    return id
}

export async function createJob(fields: Record<string, string>, files: { name: string; file: Blob }[] = [], signal?: AbortSignal): Promise<string> {
    const fd = new FormData()
    for (const [k, v] of Object.entries(fields)) fd.append(k, v)
    for (const f of files) fd.append(f.name, f.file, f.file instanceof File ? f.file.name : 'blob')
    for (let attempt = 0; ; attempt++) {
        try {
            const res = await json<{ job_id: string }>(await fetch('/jobs', { method: 'POST', body: fd, signal }))
            return res.job_id
        } catch (e) {
            // Too many active jobs: wait for the server to drain the queue.
            if (e instanceof HttpError && e.status === 429 && attempt < 600) {
                await sleep(2000, signal)
                continue
            }
            throw e
        }
    }
}

export async function fetchJobs(ids: string[]): Promise<JobInfo[]> {
    if (ids.length === 0) return []
    const res = await fetch(`/jobs?ids=${ids.join(',')}&limit=500`, { cache: 'no-store' })
    return (await json<{ jobs: JobInfo[] }>(res)).jobs
}

export function deleteJob(id: string): void {
    fetch(`/jobs/${id}`, { method: 'DELETE' }).catch(() => undefined)
}

export async function clearAllJobs(): Promise<void> {
    await fetch('/clear-all', { method: 'DELETE' }).catch(() => undefined)
}

export function withRate(url: string, rateLimit: number): string {
    if (!rateLimit || url.startsWith('blob:')) return url
    return `${url}${url.includes('?') ? '&' : '?'}rate=${Math.round(rateLimit)}`
}

export function triggerDownload(href: string, filename?: string): void {
    const a = document.createElement('a')
    a.href = href
    if (filename) a.download = filename
    a.rel = 'noopener'
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
}
