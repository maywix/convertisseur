import { useEffect, useRef, useState } from 'react'

async function traverseEntry(entry: FileSystemEntry, pathPrefix = ''): Promise<File[]> {
    if (entry.isFile) {
        return new Promise((resolve, reject) => {
            (entry as FileSystemFileEntry).file((file) => {
                if (pathPrefix) {
                    Object.defineProperty(file, 'webkitRelativePath', { value: pathPrefix + file.name })
                }
                resolve([file])
            }, reject)
        })
    }
    if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader()
        const files: File[] = []
        let batch: FileSystemEntry[]
        do {
            batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject))
            for (const child of batch) files.push(...(await traverseEntry(child, `${pathPrefix}${entry.name}/`)))
        } while (batch.length > 0)
        return files
    }
    return []
}

export async function filesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
    const entries = Array.from(dt.items ?? [])
        .map((it) => it.webkitGetAsEntry?.())
        .filter((e): e is FileSystemEntry => !!e)
    if (entries.length) {
        const nested = await Promise.all(entries.map((e) => traverseEntry(e)))
        const files = nested.flat()
        if (files.length) return files
    }
    return Array.from(dt.files ?? [])
}

/** Drop files anywhere on the window (+ paste). Returns whether a drag is in progress. */
export function useWindowDrop(onFiles: (files: File[]) => void, enabled = true): boolean {
    const [dragging, setDragging] = useState(false)
    const depth = useRef(0)
    const cb = useRef(onFiles)
    useEffect(() => { cb.current = onFiles }, [onFiles])

    useEffect(() => {
        if (!enabled) return
        const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
        const onEnter = (e: DragEvent) => {
            if (!hasFiles(e)) return
            e.preventDefault()
            depth.current += 1
            setDragging(true)
        }
        const onOver = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault() }
        const onLeave = (e: DragEvent) => {
            if (!hasFiles(e)) return
            depth.current = Math.max(0, depth.current - 1)
            if (depth.current === 0) setDragging(false)
        }
        const onDrop = async (e: DragEvent) => {
            if (!hasFiles(e) || !e.dataTransfer) return
            e.preventDefault()
            depth.current = 0
            setDragging(false)
            const files = await filesFromDataTransfer(e.dataTransfer)
            if (files.length) cb.current(files)
        }
        const onPaste = (e: ClipboardEvent) => {
            const target = e.target as HTMLElement | null
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
            const files = Array.from(e.clipboardData?.files ?? [])
            if (files.length) {
                e.preventDefault()
                cb.current(files)
            }
        }
        window.addEventListener('dragenter', onEnter)
        window.addEventListener('dragover', onOver)
        window.addEventListener('dragleave', onLeave)
        window.addEventListener('drop', onDrop)
        window.addEventListener('paste', onPaste)
        return () => {
            window.removeEventListener('dragenter', onEnter)
            window.removeEventListener('dragover', onOver)
            window.removeEventListener('dragleave', onLeave)
            window.removeEventListener('drop', onDrop)
            window.removeEventListener('paste', onPaste)
        }
    }, [enabled])

    return dragging
}
