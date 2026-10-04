// "Me prévenir à la fin": a short chime (works everywhere once the page has
// been clicked) and a system notification (HTTPS only, e.g. via the tunnel).

let audio: AudioContext | null = null

/** Browsers only start audio from a user gesture: call this from one. */
export function primeChime(): void {
    try {
        audio ??= new AudioContext()
        if (audio.state === 'suspended') void audio.resume()
    } catch {
        audio = null // no Web Audio
    }
}

/** Two soft rising notes. */
export function chime(): void {
    if (!audio || audio.state !== 'running') return
    const t0 = audio.currentTime
    for (const [i, freq] of [880, 1318.5].entries()) {
        const start = t0 + i * 0.13
        const osc = audio.createOscillator()
        const gain = audio.createGain()
        osc.type = 'sine'
        osc.frequency.value = freq
        gain.gain.setValueAtTime(0.0001, start)
        gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.6)
        osc.connect(gain).connect(audio.destination)
        osc.start(start)
        osc.stop(start + 0.65)
    }
}

export function canNotify(): boolean {
    return typeof window !== 'undefined' && window.isSecureContext && 'Notification' in window
}

export function notifyDone(done: number, errors: number): void {
    if (!canNotify() || Notification.permission !== 'granted') return
    try {
        const body = errors
            ? `${done} fichier${done > 1 ? 's' : ''} prêt${done > 1 ? 's' : ''}, ${errors} en erreur.`
            : `${done} fichier${done > 1 ? 's' : ''} prêt${done > 1 ? 's' : ''} à télécharger.`
        const n = new Notification('Conversion terminée', { body, icon: '/favicon.svg', tag: 'convertisseur-done' })
        n.onclick = () => {
            window.focus()
            n.close()
        }
    } catch {
        // Some mobile browsers only allow notifications from a service worker.
    }
}
