// One blob: URL per File for as long as it sits in the list. Created lazily
// during render (idempotent), released when the item is removed — avoids
// effect-based create/revoke pairs that StrictMode replays.
const urls = new WeakMap<Blob, string>()

export function objectUrlFor(blob: Blob): string {
    let url = urls.get(blob)
    if (!url) {
        url = URL.createObjectURL(blob)
        urls.set(blob, url)
    }
    return url
}

export function releaseObjectUrl(blob: Blob | null | undefined): void {
    if (!blob) return
    const url = urls.get(blob)
    if (url) {
        URL.revokeObjectURL(url)
        urls.delete(blob)
    }
}
