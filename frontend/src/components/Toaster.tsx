import { IconAlert, IconCheck, IconX } from '@/components/icons'
import { dismissToast, useToasts } from '@/lib/toast'
import { cn } from '@/lib/utils'

/** Messages stacked at the bottom centre, above the status badge. */
export function Toaster() {
    const toasts = useToasts()
    if (toasts.length === 0) return null
    return (
        <div className="pointer-events-none fixed inset-x-0 bottom-14 z-[95] flex flex-col items-center gap-2 px-4" aria-live="polite">
            {toasts.map((t) => (
                <div
                    key={t.id}
                    role={t.tone === 'error' ? 'alert' : 'status'}
                    className="fade-up pointer-events-auto flex w-full max-w-[440px] items-start gap-2.5 rounded-[6px] border border-input bg-card px-3.5 py-3 shadow-[0_12px_32px_rgba(0,0,0,0.45)]"
                >
                    <span className={cn('mt-px shrink-0', t.tone === 'error' ? 'text-destructive' : t.tone === 'success' ? 'text-success' : 'text-muted-foreground')}>
                        {t.tone === 'error' ? <IconAlert size={15} /> : <IconCheck size={15} />}
                    </span>
                    <div className="min-w-0 flex-1">
                        <p className="text-[13px] leading-snug font-semibold text-foreground">{t.message}</p>
                        {t.detail && <p className="mt-0.5 line-clamp-2 text-[11px] break-words text-faint">{t.detail}</p>}
                    </div>
                    <button
                        type="button"
                        onClick={() => dismissToast(t.id)}
                        aria-label="Fermer"
                        className="-m-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-[3px] text-faint hover:bg-accent hover:text-foreground"
                    >
                        <IconX size={13} />
                    </button>
                </div>
            ))}
        </div>
    )
}
