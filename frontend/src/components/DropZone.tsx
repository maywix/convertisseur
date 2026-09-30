import { useRef, type ChangeEvent, type ReactNode } from 'react'
import { IconChevronDown, IconFolder, IconPlus, IconUpload } from '@/components/icons'
import { Button, Popover } from '@/components/ui'
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

/**
 * Drop area of the Convertir page: a split "Choisir les fichiers" button
 * (the arrow opens "Choisir un dossier"), drag and drop, Ctrl+V.
 */
export function DropCard({ onFiles, compact = false }: { onFiles: (files: File[]) => void; compact?: boolean }) {
    const fileRef = useRef<HTMLInputElement>(null)
    const dirRef = useRef<HTMLInputElement>(null)
    const pick = (e: ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files ?? [])
        e.target.value = ''
        if (files.length) onFiles(files)
    }
    return (
        <div className={cn('fade-up flex flex-col items-center justify-center rounded-[4px] border border-dashed border-input bg-card px-6 text-center', compact ? 'py-7' : 'py-14 sm:py-16')}>
            <input ref={fileRef} type="file" multiple accept={ACCEPT_ATTR} className="hidden" onChange={pick} />
            <input ref={dirRef} type="file" multiple className="hidden" onChange={pick} {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} />
            <div className="inline-flex">
                <Button variant="primary" size={compact ? 'md' : 'lg'} className="rounded-r-none" onClick={() => fileRef.current?.click()}>
                    <IconPlus size={15} />
                    {compact ? 'Ajouter des fichiers' : 'Choisir les fichiers'}
                </Button>
                <Popover
                    className="w-56 p-1"
                    trigger={({ open, toggle }) => (
                        <Button
                            variant="primary"
                            size={compact ? 'md' : 'lg'}
                            className="rounded-l-none border-l border-black/25 px-3"
                            onClick={toggle}
                            aria-label="Autres façons d'ajouter"
                            aria-expanded={open}
                        >
                            <IconChevronDown size={15} />
                        </Button>
                    )}
                >
                    {(close) => (
                        <>
                            <MenuItem onClick={() => { close(); fileRef.current?.click() }} icon={<IconPlus size={14} />}>Choisir des fichiers</MenuItem>
                            <MenuItem onClick={() => { close(); dirRef.current?.click() }} icon={<IconFolder size={14} />}>Choisir un dossier</MenuItem>
                        </>
                    )}
                </Popover>
            </div>
            <p className={cn('text-muted-foreground', compact ? 'mt-3 text-[12px]' : 'mt-5 text-[14px]')}>ou glisser-déposer ici · Ctrl+V pour coller</p>
            {!compact && <p className="mt-1.5 text-[11px] text-faint">Vidéo · Audio · Image · Document · 3D · Dossier (l'arborescence est gardée)</p>}
        </div>
    )
}

function MenuItem({ onClick, icon, children }: { onClick: () => void; icon: ReactNode; children: ReactNode }) {
    return (
        <button type="button" onClick={onClick} className="flex w-full items-center gap-2.5 rounded-[3px] px-3 py-2 text-left text-[13px] text-foreground hover:bg-accent">
            <span className="text-muted-foreground">{icon}</span>
            {children}
        </button>
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
