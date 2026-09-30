// Small, dependency-free UI primitives shared by every page.
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react'
import { IconChevronDown } from '@/components/icons'
import { cn } from '@/lib/utils'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon'

const VARIANTS: Record<ButtonVariant, string> = {
    primary: 'bg-primary text-primary-foreground shadow-sm hover:brightness-110 active:brightness-95',
    secondary: 'border border-border bg-card text-foreground shadow-xs hover:bg-muted',
    ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground',
    danger: 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive',
    success: 'bg-success/12 text-success hover:bg-success/20',
}

const SIZES: Record<ButtonSize, string> = {
    sm: 'h-8 gap-1.5 rounded-md px-2.5 text-xs',
    md: 'h-9 gap-2 rounded-lg px-3.5 text-sm',
    lg: 'h-11 gap-2 rounded-xl px-5 text-sm',
    icon: 'h-8 w-8 rounded-md',
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
                'inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-[background,filter,color] disabled:pointer-events-none disabled:opacity-45',
                VARIANTS[variant],
                SIZES[size],
                className,
            )}
            {...rest}
        />
    )
}

export function Segmented<T extends string>({
    value,
    options,
    onChange,
    className,
    size = 'md',
}: {
    value: T
    options: { value: T; label: ReactNode; title?: string }[]
    onChange: (v: T) => void
    className?: string
    size?: 'sm' | 'md'
}) {
    return (
        <div role="radiogroup" className={cn('inline-flex rounded-lg bg-muted p-0.5', className)}>
            {options.map((o) => (
                <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={value === o.value}
                    title={o.title}
                    onClick={() => onChange(o.value)}
                    className={cn(
                        'flex-1 rounded-md font-medium whitespace-nowrap transition-colors',
                        size === 'sm' ? 'h-7 px-2 text-xs' : 'h-8 px-3 text-sm',
                        value === o.value
                            ? 'bg-card text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground',
                    )}
                >
                    {o.label}
                </button>
            ))}
        </div>
    )
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
                    'w-full appearance-none rounded-lg border border-input bg-card pr-8 font-medium text-foreground shadow-xs transition-colors hover:border-muted-foreground/50 disabled:opacity-50',
                    size === 'sm' ? 'h-8 pl-2.5 text-xs' : 'h-9 pl-3 text-sm',
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
            <IconChevronDown size={14} className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground" />
        </div>
    )
}

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
        <label htmlFor={id} className="flex items-start justify-between gap-3 py-1">
            <span className="min-w-0">
                <span className="block text-sm text-foreground">{label}</span>
                {description && <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>}
            </span>
            <span className="relative mt-0.5 inline-flex shrink-0">
                <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
                <span className="h-5 w-9 rounded-full bg-input transition-colors peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-ring" />
                <span className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
            </span>
        </label>
    )
}

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
    return (
        <div className={cn('space-y-1.5', className)}>
            <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">{label}</span>
                {hint && <span className="text-[11px] text-muted-foreground/80">{hint}</span>}
            </div>
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
                'h-9 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground shadow-xs placeholder:text-muted-foreground/60 hover:border-muted-foreground/50',
                className,
            )}
        />
    )
}

/**
 * Labelled slider. Bipolar sliders (min < 0 < max) fill from the centre.
 * Double-click resets to `neutral`.
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
        <div className={cn('group', disabled && 'opacity-45')}>
            <div className="flex items-center justify-between">
                <span className="text-xs text-foreground/90">{label}</span>
                <button
                    type="button"
                    disabled={disabled || value === neutral}
                    onClick={() => onChange(neutral)}
                    title="Réinitialiser"
                    className={cn(
                        'rounded px-1 font-mono text-[11px] tabular-nums transition-colors',
                        value === neutral ? 'text-muted-foreground' : 'text-primary hover:bg-accent',
                    )}
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

export function Section({
    title,
    icon,
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
            <div className="flex items-center gap-2 px-4">
                <button
                    type="button"
                    onClick={() => setOpen((v) => !v)}
                    aria-expanded={open}
                    className="flex flex-1 items-center gap-2 py-3 text-left text-sm font-semibold text-foreground"
                >
                    {icon && <span className="text-muted-foreground">{icon}</span>}
                    {title}
                    <IconChevronDown size={14} className={cn('ml-auto text-muted-foreground transition-transform', open && 'rotate-180')} />
                </button>
                {aside}
            </div>
            {open && <div className="space-y-4 px-4 pb-4">{children}</div>}
        </section>
    )
}

/** Anchored panel that closes on outside click / Escape. */
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
                        'animate-in fade-in slide-in-from-top-1 absolute top-[calc(100%+8px)] z-50 rounded-xl border border-border bg-card shadow-xl duration-150',
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
        <div className={cn('h-1 w-full overflow-hidden rounded-full bg-muted', className)}>
            <div
                className={cn('h-full rounded-full bg-primary transition-[width] duration-300', indeterminate && 'w-1/3 animate-pulse')}
                style={indeterminate ? undefined : { width: `${Math.max(2, Math.min(100, value))}%` }}
            />
        </div>
    )
}
