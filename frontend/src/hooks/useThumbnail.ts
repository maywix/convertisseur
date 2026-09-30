import { useEffect, useState } from 'react'
import { peekThumbnail, thumbnailFor } from '@/lib/thumbnails'

/** Downscaled preview URL of an image file (null while it's being made, or if it can't be). */
export function useThumbnail(file: Blob | null | undefined, width: number): string | null {
    const [made, setMade] = useState<{ file: Blob; url: string | null } | null>(null)
    useEffect(() => {
        if (!file || peekThumbnail(file) !== undefined) return
        let alive = true
        void thumbnailFor(file, width).then((url) => { if (alive) setMade({ file, url }) })
        return () => { alive = false }
    }, [file, width])
    if (!file) return null
    const cached = peekThumbnail(file)
    if (cached !== undefined) return cached
    return made?.file === file ? made.url : null
}
