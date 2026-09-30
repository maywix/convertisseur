import { useEffect, useState } from 'react'
import { IconTerminal, IconX } from '@/components/icons'
import { Button } from '@/components/ui'
import { fetchJobLogs } from '@/lib/api'
import type { QueueItem } from '@/types'

/** FFmpeg command line + messages of a server job (advanced mode). */
export function JobLogDialog({ item, onClose }: { item: QueueItem; onClose: () => void }) {
    const [lines, setLines] = useState<string[] | null>(null)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!item.jobId) return
        let cancelled = false
        fetchJobLogs(item.jobId).then(
            (l) => { if (!cancelled) setLines(l) },
            (e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) },
        )
        return () => { cancelled = true }
    }, [item.jobId])

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [onClose])

    const text = (lines ?? []).join('\n')
    return (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-in fade-in duration-100" onMouseDown={onClose}>
            <div
                role="dialog"
                aria-label={`Journal de ${item.name}`}
                className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
                onMouseDown={(e) => e.stopPropagation()}
            >
                <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                    <IconTerminal size={16} className="text-muted-foreground" />
                    <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">Journal · {item.name}</h2>
                    {text && (
                        <Button variant="ghost" size="sm" onClick={() => void navigator.clipboard?.writeText(text)}>Copier</Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fermer"><IconX size={15} /></Button>
                </div>
                <pre className="scroll-thin min-h-[160px] flex-1 overflow-auto bg-stage p-4 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all text-zinc-200">
                    {error ?? (lines === null ? 'Chargement…' : text || 'Aucun message (conversion sans FFmpeg, ou journal expiré).')}
                </pre>
            </div>
        </div>
    )
}
