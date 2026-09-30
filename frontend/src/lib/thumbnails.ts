// Small JPEG thumbnails for image rows and the Color Lab film strip.
// Showing the original file in a 44 px <img> makes the browser decode and
// keep every full-size photo in memory: a folder of 300 photos froze the
// page. Here each photo is decoded once, scaled down, and dropped.

const cache = new WeakMap<Blob, string | null>()
const pending = new Map<Blob, Promise<string | null>>()
const waiting: (() => void)[] = []
let running = 0
const MAX_PARALLEL = 2
/** Beyond this, decoding just for a thumbnail costs more than it's worth. */
const MAX_BYTES = 60 * 1024 * 1024

function slot<T>(job: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const go = () => {
            running++
            job().then(resolve, reject).finally(() => {
                running--
                waiting.shift()?.()
            })
        }
        if (running < MAX_PARALLEL) go()
        else waiting.push(go)
    })
}

async function render(file: Blob, width: number): Promise<string | null> {
    const bitmap = await createImageBitmap(file, { resizeWidth: width, resizeQuality: 'medium' })
    try {
        // Browsers that ignore resizeWidth hand back the full image: scale here too.
        const scale = Math.min(1, width / bitmap.width)
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(bitmap.width * scale))
        canvas.height = Math.max(1, Math.round(bitmap.height * scale))
        canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8))
        return blob ? URL.createObjectURL(blob) : null
    } finally {
        bitmap.close()
    }
}

/** Already-made thumbnail: a URL, null when it can't be made, undefined when not tried yet. */
export function peekThumbnail(file: Blob): string | null | undefined {
    return cache.get(file)
}

export function thumbnailFor(file: Blob, width = 128): Promise<string | null> {
    if (cache.has(file)) return Promise.resolve(cache.get(file) ?? null)
    let p = pending.get(file)
    if (!p) {
        p = file.size > MAX_BYTES
            ? Promise.resolve(null)
            : slot(() => render(file, width)).catch(() => null)
        p = p.then((url) => {
            cache.set(file, url)
            pending.delete(file)
            return url
        })
        pending.set(file, p)
    }
    return p
}

export function releaseThumbnail(file: Blob | null | undefined): void {
    if (!file) return
    const url = cache.get(file)
    if (url) URL.revokeObjectURL(url)
    cache.delete(file)
}
