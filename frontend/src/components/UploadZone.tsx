import { IconChevronDown, IconFolder } from '@/components/icons'
import { cn } from '@/lib/utils'
import { useCallback, useEffect, useRef, useState } from 'react'

interface UploadZoneProps {
    onFilesAdded: (files: FileList | File[]) => void
    compact?: boolean
}

export function UploadZone({ onFilesAdded, compact = false }: UploadZoneProps) {
    const [isDragging, setIsDragging] = useState(false)
    const [dropdownOpen, setDropdownOpen] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const folderInputRef = useRef<HTMLInputElement>(null)
    const dropdownRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setDropdownOpen(false)
            }
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [])

    const openFiles = () => { fileInputRef.current?.click(); setDropdownOpen(false) }
    const openFolder = () => { folderInputRef.current?.click(); setDropdownOpen(false) }

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(true)
    }, [])

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setIsDragging(false)
        }
    }, [])

    const handleDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(false)
        const items = e.dataTransfer?.items
        if (items && items.length) {
            const entries: FileSystemEntry[] = []
            for (const item of Array.from(items)) {
                const entry = item.webkitGetAsEntry?.()
                if (entry) entries.push(entry)
            }
            if (entries.length > 0) {
                const files: File[] = []
                for (const entry of entries) {
                    const entryFiles = await traverseEntry(entry)
                    files.push(...entryFiles)
                }
                if (files.length > 0) {
                    onFilesAdded(files)
                    return
                }
            }
        }
        if (e.dataTransfer?.files?.length) {
            onFilesAdded(e.dataTransfer.files)
        }
    }, [onFilesAdded])

    const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.length) {
            onFilesAdded(e.target.files)
            e.target.value = ''
        }
    }

    const ACCEPT = "video/*,audio/*,image/*,.svg,.pdf,.docx,.doc,.odt,.rtf,.xlsx,.xls,.ods,.csv,.pptx,.ppt,.odp,.obj,.stl,.ply,.glb,.gltf,.3mf,.off,.cube,.raw,.cr2,.nef,.arw,.rw2,.dng,.orf,.raf,.x3f,.pef,.erf"

    if (compact) {
        return (
            <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={cn(
                    "mx-3 mt-3 mb-1 rounded-lg border border-dashed transition-all duration-150 flex items-center justify-center py-2.5 px-3",
                    isDragging ? "border-primary bg-primary/10" : "border-border bg-background/70 hover:border-primary/50"
                )}
            >
                {isDragging ? (
                    <span className="text-xs font-medium text-primary pointer-events-none select-none">
                        Relâchez pour ajouter
                    </span>
                ) : (
                    <div className="relative flex w-full max-w-[320px] rounded-lg overflow-visible shadow-sm" ref={dropdownRef}>
                        <button
                            type="button"
                            onClick={openFiles}
                            className="flex-1 flex items-center justify-center gap-2.5 px-4 py-2.5 bg-primary text-primary-foreground font-semibold text-xs rounded-l-lg hover:bg-primary/90 active:scale-[0.98] transition-all"
                        >
                            <IconFileAdd size={15} />
                            Ajouter des fichiers
                        </button>
                        <div className="w-px bg-primary-foreground/20 self-stretch" />
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setDropdownOpen((v) => !v) }}
                            className="px-2.5 bg-primary text-primary-foreground rounded-r-lg hover:bg-primary/90 transition-colors"
                            aria-label="Plus d'options"
                        >
                            <IconChevronDown size={14} />
                        </button>

                        {dropdownOpen && (
                            <div className="absolute top-[calc(100%+6px)] left-0 bg-popover border border-border rounded-lg shadow-xl overflow-hidden z-50 min-w-[220px]">
                                <button
                                    type="button"
                                    onClick={openFiles}
                                    className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/60 transition-colors text-left"
                                >
                                    <IconFileAdd size={16} />
                                    <div>
                                        <div className="font-medium">Choisir des fichiers</div>
                                        <div className="text-xs text-muted-foreground">Sélection multiple</div>
                                    </div>
                                </button>
                                <div className="h-px bg-border mx-2" />
                                <button
                                    type="button"
                                    onClick={openFolder}
                                    className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/60 transition-colors text-left"
                                >
                                    <IconFolder size={16} />
                                    <div>
                                        <div className="font-medium">Choisir un dossier</div>
                                        <div className="text-xs text-muted-foreground">Sous-dossiers conservés</div>
                                    </div>
                                </button>
                            </div>
                        )}
                    </div>
                )}
                <input ref={fileInputRef} type="file" multiple accept={ACCEPT} onChange={handleInput} className="hidden" />
                <input ref={folderInputRef} type="file" multiple onChange={handleInput} className="hidden"
                    {...{ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>}
                />
            </div>
        )
    }

    return (
        <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
                "m-3 rounded-xl border border-dashed flex flex-col items-center justify-center transition-all duration-200",
                isDragging
                    ? "border-primary bg-primary/10 py-10"
                    : "border-border bg-background/70 hover:border-primary/50 py-10"
            )}
        >
            {isDragging ? (
                <div className="text-center pointer-events-none select-none">
                    <div className="text-5xl mb-3">📂</div>
                    <p className="text-sm font-semibold text-primary">Relâchez pour ajouter</p>
                </div>
            ) : (
                <>
                    {/* Split button: main action + dropdown */}
                    <div className="relative flex rounded-lg overflow-visible shadow-sm" ref={dropdownRef}>
                        <button
                            type="button"
                            onClick={openFiles}
                            className="flex items-center gap-2.5 pl-5 pr-4 py-3 bg-primary text-primary-foreground font-semibold text-sm rounded-l-lg hover:bg-primary/90 active:scale-[0.98] transition-all"
                        >
                            <IconFileAdd size={17} />
                            Choisir les fichiers
                        </button>
                        <div className="w-px bg-primary-foreground/20 self-stretch" />
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setDropdownOpen(v => !v) }}
                            className="px-3 bg-primary text-primary-foreground rounded-r-lg hover:bg-primary/90 transition-colors"
                            aria-label="Plus d'options"
                        >
                            <IconChevronDown size={15} />
                        </button>

                        {dropdownOpen && (
                            <div className="absolute top-[calc(100%+6px)] left-0 bg-popover border border-border rounded-lg shadow-xl overflow-hidden z-50 min-w-[220px]">
                                <button
                                    type="button"
                                    onClick={openFiles}
                                    className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/60 transition-colors text-left"
                                >
                                    <IconFileAdd size={16} />
                                    <div>
                                        <div className="font-medium">Choisir des fichiers</div>
                                        <div className="text-xs text-muted-foreground">Sélection multiple</div>
                                    </div>
                                </button>
                                <div className="h-px bg-border mx-2" />
                                <button
                                    type="button"
                                    onClick={openFolder}
                                    className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/60 transition-colors text-left"
                                >
                                    <IconFolder size={16} />
                                    <div>
                                        <div className="font-medium">Choisir un dossier</div>
                                        <div className="text-xs text-muted-foreground">Tous les fichiers du dossier</div>
                                    </div>
                                </button>
                            </div>
                        )}
                    </div>

                    <p className="text-sm text-muted-foreground mt-4">
                        ou <span className="text-foreground/70">glisser-déposer</span> ici
                    </p>
                    <p className="text-xs text-muted-foreground/50 mt-1.5">
                        Vidéo · Audio · Image · Document · 3D · Dossier
                    </p>
                </>
            )}

            <input ref={fileInputRef} type="file" multiple accept={ACCEPT} onChange={handleInput} className="hidden" />
            <input ref={folderInputRef} type="file" multiple onChange={handleInput} className="hidden"
                {...{ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>}
            />
        </div>
    )
}

function IconFileAdd({ size = 20 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="12" y1="12" x2="12" y2="18" />
            <line x1="9" y1="15" x2="15" y2="15" />
        </svg>
    )
}

async function traverseEntry(entry: FileSystemEntry, pathPrefix = ''): Promise<File[]> {
    if (!entry) return []
    if (entry.isFile) {
        return new Promise((resolve, reject) => {
            (entry as FileSystemFileEntry).file((file) => {
                Object.defineProperty(file, 'webkitRelativePath', {
                    value: pathPrefix + file.name, writable: false,
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
            batch = await new Promise((resolve, reject) => { reader.readEntries(resolve, reject) })
            for (const ent of batch) {
                const childFiles = await traverseEntry(ent, `${pathPrefix}${entry.name}/`)
                files.push(...childFiles)
            }
        } while (batch.length > 0)
        return files
    }
    return []
}
