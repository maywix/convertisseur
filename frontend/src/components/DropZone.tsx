import { useRef, type ChangeEvent } from 'react'
import { IconFolder, IconPlus, IconUpload } from '@/components/icons'
import { Button } from '@/components/ui'
import { cn } from '@/lib/utils'
import { ACCEPT_ATTR } from '@/types'

export function DropOverlay({ visible, label }: { visible: boolean; label: string }) {
    if (!visible) return null
    return (
        <div className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center bg-background/70 p-6 backdrop-blur-sm animate-in fade-in duration-100">
            <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-primary bg-card/90 px-10 py-12 text-center shadow-2xl">
                <IconUpload size={32} className="text-primary" />
                <p className="text-base font-semibold">{label}</p>
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
            <Button variant={compact ? 'secondary' : 'primary'} size={compact ? 'sm' : 'lg'} onClick={() => fileRef.current?.click()}>
                <IconPlus size={compact ? 14 : 16} />
                {compact ? 'Ajouter' : 'Choisir des fichiers'}
            </Button>
            {folder && (
                <Button variant={compact ? 'ghost' : 'secondary'} size={compact ? 'sm' : 'lg'} onClick={() => dirRef.current?.click()}>
                    <IconFolder size={compact ? 14 : 16} />
                    Dossier
                </Button>
            )}
        </>
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
        <div className={cn('flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border bg-card/60 px-6 py-14 text-center sm:py-20', className)}>
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
                <IconUpload size={26} />
            </div>
            <h2 className="mt-5 text-xl font-semibold tracking-tight sm:text-2xl">{title}</h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">{subtitle}</p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                <FilePickers onFiles={onFiles} accept={accept} folder={folder} />
            </div>
            <p className="mt-4 text-xs text-muted-foreground">ou glisse-les n'importe où sur la page · Ctrl+V pour coller</p>
        </div>
    )
}
