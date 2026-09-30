import { useRef, type ChangeEvent } from 'react'
import { IconFolder, IconPlus, IconUpload } from '@/components/icons'
import { Button } from '@/components/ui'
import { cn } from '@/lib/utils'
import { ACCEPT_ATTR } from '@/types'

export function DropOverlay({ visible, label }: { visible: boolean; label: string }) {
    if (!visible) return null
    return (
        <div className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center bg-background/80 p-6 backdrop-blur-sm animate-in fade-in duration-100">
            <div className="flex flex-col items-center gap-3 rounded-[6px] border border-dashed border-foreground px-12 py-14 text-center">
                <IconUpload size={30} />
                <p className="text-base font-semibold">{label}</p>
                <p className="text-xs text-faint">Fichiers ou dossiers entiers (l'arborescence est gardée)</p>
            </div>
        </div>
    )
}

export function FilePickers({
    onFiles,
    accept = ACCEPT_ATTR,
    folder = true,
    compact = false,
}: {
    onFiles: (files: File[]) => void
    accept?: string
    folder?: boolean
    compact?: boolean
}) {
    const fileRef = useRef<HTMLInputElement>(null)
    const dirRef = useRef<HTMLInputElement>(null)
    const pick = (e: ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files ?? [])
        e.target.value = ''
        if (files.length) onFiles(files)
    }
    return (
        <>
            <input ref={fileRef} type="file" multiple accept={accept} className="hidden" onChange={pick} />
            {folder && (
                <input
                    ref={dirRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={pick}
                    {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
                />
            )}
            <Button variant="primary" size={compact ? 'md' : 'lg'} onClick={() => fileRef.current?.click()}>
                <IconPlus size={15} />
                {compact ? 'Ajouter des fichiers' : 'Choisir des fichiers'}
            </Button>
            {folder && (
                <Button variant="secondary" size={compact ? 'md' : 'lg'} onClick={() => dirRef.current?.click()}>
                    <IconFolder size={15} />
                    Dossier
                </Button>
            )}
        </>
    )
}

/** Compact "add more" row shown above the list (like the downloader's input row). */
export function DropBar({ onFiles, accept, folder = true }: { onFiles: (files: File[]) => void; accept?: string; folder?: boolean }) {
    return (
        <div className="flex flex-wrap items-center gap-2 rounded-[4px] border border-dashed border-input px-3 py-2.5">
            <FilePickers onFiles={onFiles} accept={accept} folder={folder} compact />
            <span className="ml-1 text-[13px] text-faint">ou glisse des fichiers et dossiers n'importe où · Ctrl+V</span>
        </div>
    )
}

export function EmptyDrop({
    title,
    subtitle,
    onFiles,
    accept,
    folder = true,
    className,
}: {
    title: string
    subtitle: string
    onFiles: (files: File[]) => void
    accept?: string
    folder?: boolean
    className?: string
}) {
    return (
        <div className={cn('fade-up flex flex-col items-center justify-center rounded-[4px] border border-dashed border-input bg-card px-6 py-16 text-center sm:py-20', className)}>
            <IconUpload size={28} className="text-muted-foreground" />
            <h2 className="mt-5 text-[17px] font-semibold">{title}</h2>
            <p className="mt-1.5 max-w-md text-[13px] text-muted-foreground">{subtitle}</p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
                <FilePickers onFiles={onFiles} accept={accept} folder={folder} />
            </div>
            <p className="mt-5 text-[11px] text-faint">ou glisse-les n'importe où sur la page · Ctrl+V pour coller</p>
        </div>
    )
}
