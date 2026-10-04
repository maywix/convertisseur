// Small message stack ("3 fichiers ignorés", "Notifications bloquées"…),
// readable from anywhere without threading callbacks through the tree.
import { useSyncExternalStore } from 'react'

export type ToastTone = 'info' | 'success' | 'error'

export interface Toast {
    id: number
    message: string
    detail?: string
    tone: ToastTone
}

let toasts: Toast[] = []
let nextId = 1
const listeners = new Set<() => void>()

function emit() {
    for (const l of listeners) l()
}

export function dismissToast(id: number): void {
    toasts = toasts.filter((t) => t.id !== id)
    emit()
}

export function toast(message: string, opts: { detail?: string; tone?: ToastTone; duration?: number } = {}): number {
    const id = nextId++
    // Same message twice in a row (several drops): refresh it instead of stacking.
    toasts = [...toasts.filter((t) => t.message !== message), { id, message, detail: opts.detail, tone: opts.tone ?? 'info' }].slice(-4)
    emit()
    window.setTimeout(() => dismissToast(id), opts.duration ?? (opts.tone === 'error' ? 8000 : 5000))
    return id
}

function subscribe(listener: () => void) {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
}

export function useToasts(): Toast[] {
    return useSyncExternalStore(subscribe, () => toasts)
}
