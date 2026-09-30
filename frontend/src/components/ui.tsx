// Small, dependency-free UI primitives in the Eclypse Downloader style.
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react'
import { IconChevronDown, IconChevronRight } from '@/components/icons'
import { cn } from '@/lib/utils'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon'

const VARIANTS: Record<ButtonVariant, string> = {
    // White block with black text (dl-btn / input-row button)
    primary: 'bg-primary text-primary-foreground font-bold hover:opacity-85',
    // Hairline outline (fmt-tab / mini-btn)
    secondary: 'border border-input bg-transparent text-muted-foreground hover:border-faint hover:text-foreground',
    ghost: 'text-muted-foreground hover:bg-accent hover:text-foreground',
    danger: 'text-muted-foreground hover:text-destructive',
    // Green "Sauvegarder"
    success: 'bg-success font-bold text-black hover:opacity-85',
}

const SIZES: Record<ButtonSize, string> = {
    sm: 'h-8 gap-1.5 rounded-[3px] px-3 text-xs',
    md: 'h-9 gap-2 rounded-[3px] px-4 text-[13px]',
    lg: 'h-12 gap-2 rounded-[3px] px-6 text-sm tracking-[0.02em]',
    icon: 'h-8 w-8 rounded-[3px]',
}

export function Button({
    variant = 'secondary',
    size = 'md',
    className,
    type = 'button',
    ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
    return (
        <button
            type={type}
            className={cn(
                'inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-all disabled:pointer-events-none disabled:opacity-35',
                VARIANTS[variant],
                SIZES[size],
                className,
            )}
            {...rest}
        />
    )
}

/** Round outlined icon button (gear-btn). */
export function RoundButton({ className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
    return (
        <button
            type="button"
            className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-input text-muted-foreground transition-all hover:border-muted-foreground hover:text-foreground aria-expanded:border-muted-foreground aria-expanded:text-foreground',
                className,
            )}
            {...rest}
        />
    )
}

export function Spinner({ className }: { className?: string }) {
    return <span className={cn('inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current/25 border-t-current', className)} />
}

export interface SelectOption {
    value: string
    label: string
    group?: string
}

export function Select({
    value,
    options,
    onChange,
    className,
    disabled,
    ariaLabel,
    size = 'md',
}: {
    value: string
    options: SelectOption[]
    onChange: (v: string) => void
    className?: string
    disabled?: boolean
    ariaLabel?: string
    size?: 'sm' | 'md'
}) {
    const groups: { name: string | undefined; items: SelectOption[] }[] = []
    for (const o of options) {
        const last = groups[groups.length - 1]
        if (last && last.name === o.group) last.items.push(o)
        else groups.push({ name: o.group, items: [o] })
    }
    return (
        <div className={cn('relative inline-flex', className)}>
            <select
                value={value}
                disabled={disabled}
                aria-label={ariaLabel}
                onChange={(e) => onChange(e.target.value)}
                className={cn(
                    'w-full appearance-none rounded-[4px] border border-input bg-card pr-8 text-foreground transition-colors hover:border-faint disabled:opacity-40',
                    size === 'sm' ? 'h-8 pl-2.5 text-xs' : 'h-9 pl-3 text-[13px]',
                )}
            >
                {groups.map((g, i) =>
                    g.name ? (
                        <optgroup key={g.name + i} label={g.name}>
                            {g.items.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </optgroup>
                    ) : (
                        g.items.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)
                    ),
                )}
            </select>
            <IconChevronDown size={13} className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground" />
        </div>
    )
}

/** Green switch with a label (the downloader's .toggle). */
export function Toggle({
    checked,
    onChange,
    label,
    description,
}: {
    checked: boolean
    onChange: (v: boolean) => void
    label: ReactNode
    description?: ReactNode
}) {
    const id = useId()
    return (
        <label htmlFor={id} className="flex min-h-9 items-center gap-2.5 py-1">
            <span className="relative inline-flex shrink-0">
                <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
                <span className="h-[22px] w-[38px] rounded-full bg-input transition-colors peer-checked:bg-switch peer-focus-visible:outline-2 peer-focus-visible:outline-switch" />
                <span className="absolute top-[2px] left-[2px] h-[18px] w-[18px] rounded-full bg-white transition-transform peer-checked:translate-x-4" />
            </span>
            <span className="min-w-0">
                <span className="block text-[13px] text-foreground">{label}</span>
                {description && <span className="block text-[11px] leading-snug text-faint">{description}</span>}
            </span>
        </label>
    )
}

/** Tiny uppercase section label (.label). */
export function Label({ children, className }: { children: ReactNode; className?: string }) {
    return <p className={cn('text-[10px] font-bold tracking-[0.1em] text-faint uppercase', className)}>{children}</p>
}

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
    return (
        <div className={cn('space-y-2', className)}>
            <div className="flex items-baseline justify-between gap-2">
                <Label>{label}</Label>
                {hint && <span className="text-[11px] text-faint">{hint}</span>}
            </div>
            {children}
        </div>
    )
}

/** Label on the left, control on the right (toggle-select). */
export function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
    return (
        <div className="flex min-h-10 items-center justify-between gap-3">
            <span className="text-[13px] text-foreground">{label}</span>
            {children}
        </div>
    )
}

export function TextInput({
    value,
    onChange,
    placeholder,
    className,
    inputMode,
    ariaLabel,
}: {
    value: string
    onChange: (v: string) => void
    placeholder?: string
    className?: string
    inputMode?: 'numeric' | 'decimal' | 'text'
    ariaLabel?: string
}) {
    return (
        <input
            type="text"
            value={value}
            inputMode={inputMode}
            aria-label={ariaLabel}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            className={cn(
                'h-9 w-full rounded-[4px] border border-border bg-card px-3 text-[13px] text-foreground outline-none transition-colors placeholder:text-faint focus:border-input',
                className,
            )}
        />
    )
}

/**
 * Labelled slider. Bipolar sliders (min < 0 < max) fill from the centre.
 * Double-click (or click the value) resets to `neutral`.
 */
export function Slider({
    label,
    value,
    min,
    max,
    step = 1,
    neutral = 0,
    onChange,
    format,
    disabled,
}: {
    label: string
    value: number
    min: number
    max: number
    step?: number
    neutral?: number
    onChange: (v: number) => void
    format?: (v: number) => string
    disabled?: boolean
}) {
    const pct = (v: number) => ((v - min) / (max - min)) * 100
    const anchor = Math.max(min, Math.min(max, neutral))
    const from = Math.min(pct(anchor), pct(value))
    const to = Math.max(pct(anchor), pct(value))
    const shown = format ? format(value) : `${value > 0 && min < 0 ? '+' : ''}${step < 1 ? value.toFixed(step < 0.1 ? 2 : 1) : value}`
    return (
        <div className={cn(disabled && 'opacity-40')}>
            <div className="flex items-center justify-between">
                <span className="text-[13px] text-foreground">{label}</span>
                <button
                    type="button"
                    disabled={disabled || value === neutral}
                    onClick={() => onChange(neutral)}
                    title="Réinitialiser"
                    className={cn('rounded-[2px] px-1 text-[11px] tabular-nums', value === neutral ? 'text-faint' : 'font-semibold text-foreground hover:bg-accent')}
                >
                    {shown}
                </button>
            </div>
            <input
                type="range"
                className="range"
                aria-label={label}
                min={min}
                max={max}
                step={step}
                value={value}
                disabled={disabled}
                onChange={(e) => onChange(parseFloat(e.target.value))}
                onDoubleClick={() => onChange(neutral)}
                style={{ '--fill-from': `${from}%`, '--fill-to': `${to}%` } as CSSProperties}
            />
        </div>
    )
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
    return <div className={cn('fade-up overflow-hidden rounded-[4px] border border-border bg-card', className)}>{children}</div>
}

/** Collapsible block used by the Color Lab controls. */
export function Section({
    title,
    children,
    defaultOpen = true,
    aside,
}: {
    title: ReactNode
    icon?: ReactNode
    children: ReactNode
    defaultOpen?: boolean
    aside?: ReactNode
}) {
    const [open, setOpen] = useState(defaultOpen)
    return (
        <section className="border-b border-border last:border-b-0">
            <div className="flex items-center gap-2 px-5">
                <button
                    type="button"
                    onClick={() => setOpen((v) => !v)}
                    aria-expanded={open}
                    className="flex flex-1 items-center gap-2 py-3.5 text-left text-[10px] font-bold tracking-[0.1em] text-muted-foreground uppercase hover:text-foreground"
                >
                    {title}
                    <IconChevronDown size={13} className={cn('ml-auto transition-transform', open && 'rotate-180')} />
                </button>
                {aside}
            </div>
            {open && <div className="space-y-4 px-5 pb-5">{children}</div>}
        </section>
    )
}

/** "Réglages avancés" block (.adv-settings). */
export function Details({
    summary,
    hint,
    open,
    onToggle,
    children,
}: {
    summary: ReactNode
    hint?: ReactNode
    open: boolean
    onToggle: (open: boolean) => void
    children: ReactNode
}) {
    return (
        <details
            open={open}
            onToggle={(e) => { if (e.currentTarget.open !== open) onToggle(e.currentTarget.open) }}
            className="group rounded-[10px] border border-input bg-foreground/[0.035] transition-colors open:border-faint open:bg-foreground/[0.05]"
        >
            <summary className="flex min-h-11 items-baseline gap-2 rounded-[10px] px-3.5 py-3 text-[13px] font-bold select-none hover:bg-foreground/[0.04]">
                <IconChevronRight size={14} className="shrink-0 self-center text-muted-foreground transition-transform group-open:rotate-90" />
                {summary}
                {hint && <span className="text-[11px] font-normal text-faint">{hint}</span>}
            </summary>
            <div className="px-3.5 pb-4">{children}</div>
        </details>
    )
}

/** Anchored panel that closes on outside click / Escape (service-menu). */
export function Popover({
    trigger,
    children,
    align = 'end',
    className,
}: {
    trigger: (props: { open: boolean; toggle: () => void }) => ReactNode
    children: ReactNode | ((close: () => void) => ReactNode)
    align?: 'start' | 'end'
    className?: string
}) {
    const [open, setOpen] = useState(false)
    const ref = useRef<HTMLDivElement>(null)
    useEffect(() => {
        if (!open) return
        const onDown = (e: MouseEvent) => {
            if (!ref.current?.contains(e.target as Node)) setOpen(false)
        }
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
        document.addEventListener('mousedown', onDown)
        document.addEventListener('keydown', onKey)
        return () => {
            document.removeEventListener('mousedown', onDown)
            document.removeEventListener('keydown', onKey)
        }
    }, [open])
    const close = () => setOpen(false)
    return (
        <div ref={ref} className="relative">
            {trigger({ open, toggle: () => setOpen((v) => !v) })}
            {open && (
                <div
                    className={cn(
                        'absolute top-[calc(100%+8px)] z-50 rounded-[6px] border border-input bg-card shadow-[0_12px_32px_rgba(0,0,0,0.5)]',
                        align === 'end' ? 'right-0' : 'left-0',
                        className,
                    )}
                >
                    {typeof children === 'function' ? children(close) : children}
                </div>
            )}
        </div>
    )
}

export function ProgressBar({ value, indeterminate, className }: { value: number; indeterminate?: boolean; className?: string }) {
    return (
        <div className={cn('h-[3px] w-full overflow-hidden rounded-full bg-muted', className)}>
            <div
                className={cn('h-full bg-primary transition-[width] duration-300', indeterminate && 'w-1/3 animate-pulse')}
                style={indeterminate ? undefined : { width: `${Math.max(1, Math.min(100, value))}%` }}
            />
        </div>
    )
}
