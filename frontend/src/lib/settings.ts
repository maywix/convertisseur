import { useCallback, useEffect, useState } from 'react'

export type ProcessingPreference = 'auto' | 'server' | 'browser'
export type ThemePreference = 'system' | 'light' | 'dark'
/** Photo / video metadata: everything, everything but the location, nothing. */
export type MetadataPreference = 'keep' | 'nogps' | 'strip'

export interface Settings {
    /**
     * auto: images the browser can handle stay local, everything else goes to
     * the server. server: always the server. browser: also try videos locally
     * (ffmpeg.wasm), falling back to the server when that fails.
     */
    processing: ProcessingPreference
    /** MB/s through the Cloudflare Tunnel. null = server default, 0 = unlimited. */
    tunnelLimitMbps: number | null
    autoDownload: boolean
    /** "Tout télécharger" with several results: one ZIP or separate files. */
    exportMode: 'zip' | 'files'
    /** Server conversions keep going when the page is closed, and come back on reload. */
    background: boolean
    theme: ThemePreference
    metadata: MetadataPreference
    /** Notification + sound when a batch finishes while the tab is in the background. */
    notify: boolean
}

const KEY = 'convertisseur_settings_v2'

const DEFAULTS: Settings = {
    processing: 'auto',
    tunnelLimitMbps: null,
    autoDownload: false,
    exportMode: 'zip',
    background: true,
    theme: 'dark',
    metadata: 'nogps',
    notify: false,
}

function load(): Settings {
    try {
        const raw = localStorage.getItem(KEY)
        if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
    } catch {
        // private mode / corrupted value
    }
    return DEFAULTS
}

export function useSettings() {
    const [settings, setSettings] = useState<Settings>(load)

    const update = useCallback((patch: Partial<Settings>) => {
        setSettings((prev) => {
            const next = { ...prev, ...patch }
            try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* ignore */ }
            return next
        })
    }, [])

    useEffect(() => {
        const media = window.matchMedia('(prefers-color-scheme: dark)')
        const apply = () => {
            const dark = settings.theme === 'dark' || (settings.theme === 'system' && media.matches)
            document.documentElement.classList.toggle('dark', dark)
            document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
        }
        apply()
        media.addEventListener('change', apply)
        return () => media.removeEventListener('change', apply)
    }, [settings.theme])

    return [settings, update] as const
}
