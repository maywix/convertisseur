import { useCallback, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { IconFolder } from '@/components/icons'

interface UploadZoneProps {
    onFilesAdded: (files: FileList | File[]) => void
}

export function UploadZone({ onFilesAdded }: UploadZoneProps) {
    const [isDragging, setIsDragging] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)

    const handleClick = () => {
        inputRef.current?.click()
    }

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(true)
    }, [])

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(false)
    }, [])

    const handleDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(false)

        const items = e.dataTransfer?.items
        if (items && items.length) {
            const files: File[] = []

            for (const item of Array.from(items)) {
                const entry = item.webkitGetAsEntry?.()
                if (entry) {
                    const entryFiles = await traverseEntry(entry)
                    files.push(...entryFiles)
                }
            }

            if (files.length > 0) {
                onFilesAdded(files)
                return
            }
        }

        // Fallback to plain files
        if (e.dataTransfer?.files?.length) {
            onFilesAdded(e.dataTransfer.files)
        }
    }, [onFilesAdded])

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.length) {
            onFilesAdded(e.target.files)
            e.target.value = ''
        }
    }

    return (
        <div
            onClick={handleClick}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
                'p-8 border-b border-border text-center cursor-pointer transition-colors',
                isDragging ? 'bg-primary/10 border-primary' : 'hover:bg-muted/50'
            )}
        >
            <div className="flex items-center justify-center mb-3">
                <IconFolder size={32} />
            </div>
            <h3 className="text-lg font-semibold mb-1">Glisser-déposer vos fichiers ici</h3>
            <p className="text-sm text-muted-foreground">ou cliquez pour parcourir (Illimité)</p>
            <input
                ref={inputRef}
                type="file"
                multiple
                onChange={handleInputChange}
                className="hidden"
                // @ts-expect-error webkitdirectory is a non-standard attribute
                webkitdirectory=""
                directory=""
            />
        </div>
    )
}

async function traverseEntry(entry: FileSystemEntry, pathPrefix = ''): Promise<File[]> {
    if (!entry) return []

    if (entry.isFile) {
        return new Promise((resolve, reject) => {
            ; (entry as FileSystemFileEntry).file((file) => {
                // Add relativePath to the file object
                Object.defineProperty(file, 'webkitRelativePath', {
                    value: pathPrefix + file.name,
                    writable: false,
                })
                resolve([file])
            }, reject)
        })
    }

    if (entry.isDirectory) {
        const dirEntry = entry as FileSystemDirectoryEntry
        const reader = dirEntry.createReader()
        const files: File[] = []

        let batch: FileSystemEntry[]
        do {
            batch = await new Promise((resolve, reject) => {
                reader.readEntries(resolve, reject)
            })

            for (const ent of batch) {
                const childFiles = await traverseEntry(ent, `${pathPrefix}${entry.name}/`)
                files.push(...childFiles)
            }
        } while (batch.length > 0)

        return files
    }

    return []
}
