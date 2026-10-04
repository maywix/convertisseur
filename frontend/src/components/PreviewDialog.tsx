import {
    useCallback, useEffect, useRef, useState,
    type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode,
} from 'react'
import { KindIcon } from '@/components/FileRow'
import { IconChevronLeft, IconChevronRight, IconCompare, IconDownload, IconX, IconZoom } from '@/components/icons'
import { Button, Spinner } from '@/components/ui'
import { inlineUrl } from '@/lib/api'
import { objectUrlFor } from '@/lib/objectUrl'
import { cn } from '@/lib/utils'
import { extOf, formatSize, type QueueItem } from '@/types'

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp', 'ico', 'svg'])
const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv'])
const AUDIO_EXT = new Set(['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus'])
/** Originals the browser can show next to the result. */
const SHOWABLE_ORIGINAL = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp', 'svg'])

type Viewer = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'none'

function viewerFor(name: string): Viewer {
    const ext = extOf(name)
    if (IMAGE_EXT.has(ext)) return 'image'
    if (VIDEO_EXT.has(ext)) return 'video'
    if (AUDIO_EXT.has(ext)) return 'audio'
    if (ext === 'pdf') return 'pdf'
    if (ext === 'txt') return 'text'
    return 'none'
}

/** Result of a conversion, full screen: image (with before / after), video, sound, PDF, text. */
export function PreviewDialog({
    items,
    startId,
    rateLimit,
    onDownload,
    onClose,
}: {
    /** Finished items one can browse with ← / →. */
    items: QueueItem[]
    startId: string
    rateLimit: number
    onDownload: (it: QueueItem) => void
    onClose: () => void
}) {
    const [currentId, setCurrentId] = useState(startId)
    const index = Math.max(0, items.findIndex((it) => it.id === currentId))
    const item = items[index]

    const go = useCallback((delta: number) => {
        const next = items[index + delta]
        if (next) setCurrentId(next.id)
    }, [items, index])

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose()
            else if (e.key === 'ArrowLeft') go(-1)
            else if (e.key === 'ArrowRight') go(1)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [go, onClose])

    useEffect(() => {
        if (!item) onClose() // removed from the list while open
    }, [item, onClose])
    if (!item || !item.downloadUrl) return null

    const outputName = item.outputName || item.name
    const viewer = viewerFor(outputName)
    const url = item.local ? item.downloadUrl : inlineUrl(item.downloadUrl, rateLimit)
    const original = viewer === 'image' && item.file && SHOWABLE_ORIGINAL.has(extOf(item.name)) ? objectUrlFor(item.file) : null
    const saved = item.outputSize && item.size ? Math.round((1 - item.outputSize / item.size) * 100) : null

    return (
        <div className="fixed inset-0 z-[90] flex flex-col bg-black/95 animate-in fade-in duration-100" onMouseDown={onClose}>
            <div
                role="dialog"
                aria-label={`Aperçu de ${outputName}`}
                className="mx-auto flex h-full w-full max-w-[1400px] flex-col p-3 sm:p-5"
                onMouseDown={(e) => e.stopPropagation()}
            >
                <header className="flex items-center gap-3 pb-3 text-white">
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-bold" title={outputName}>{outputName}</p>
                        <p className="truncate text-[11px] text-white/60">
                            {item.name !== outputName && <>{item.name} → </>}
                            {item.size > 0 && formatSize(item.size)}
                            {item.outputSize ? ` → ${formatSize(item.outputSize)}` : ''}
                            {saved !== null && saved > 1 && <span className="text-success"> (−{saved} %)</span>}
                            {saved !== null && saved < -1 && <span> (+{-saved} %)</span>}
                            {item.note === 'kept' && <span> · déjà optimisé, gardé tel quel</span>}
                        </p>
                    </div>
                    {items.length > 1 && <span className="hidden text-[11px] text-white/50 tabular-nums sm:inline">{index + 1} / {items.length}</span>}
                    <Button variant="success" size="sm" onClick={() => onDownload(item)}>
                        <IconDownload size={14} /> <span className="hidden sm:inline">Sauvegarder</span>
                    </Button>
                    <button type="button" onClick={onClose} aria-label="Fermer l'aperçu" className="flex h-8 w-8 items-center justify-center rounded-[3px] text-white/70 hover:bg-white/10 hover:text-white">
                        <IconX size={18} />
                    </button>
                </header>

                <div className="relative min-h-0 flex-1 overflow-hidden rounded-[4px] border border-white/10 bg-black">
                    {viewer === 'image' && <ImageViewer key={item.id} src={url} original={original} />}
                    {viewer === 'video' && (
                        <video key={item.id} src={url} controls autoPlay playsInline className="absolute inset-0 h-full w-full object-contain" />
                    )}
                    {viewer === 'audio' && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 p-6 text-white/70">
                            <KindIcon kind="audio" size={48} />
                            <audio key={item.id} src={url} controls autoPlay className="w-full max-w-md" />
                        </div>
                    )}
                    {viewer === 'pdf' && <PdfViewer key={item.id} item={item} url={url} />}
                    {viewer === 'text' && <TextViewer key={item.id} src={url} />}
                    {viewer === 'none' && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-white/70">
                            <KindIcon kind={item.kind} size={40} />
                            <p className="text-[13px]">Pas d'aperçu pour ce format ({extOf(outputName).toUpperCase() || '?'}).</p>
                            <Button variant="success" size="sm" onClick={() => onDownload(item)}><IconDownload size={14} /> Sauvegarder</Button>
                        </div>
                    )}

                    {items.length > 1 && (
                        <>
                            <NavButton side="left" disabled={index === 0} onClick={() => go(-1)} />
                            <NavButton side="right" disabled={index === items.length - 1} onClick={() => go(1)} />
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}

function NavButton({ side, disabled, onClick }: { side: 'left' | 'right'; disabled: boolean; onClick: () => void }) {
    if (disabled) return null
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={side === 'left' ? 'Fichier précédent' : 'Fichier suivant'}
            className={cn('absolute top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur hover:bg-black/80', side === 'left' ? 'left-3' : 'right-3')}
        >
            {side === 'left' ? <IconChevronLeft size={18} /> : <IconChevronRight size={18} />}
        </button>
    )
}

/**
 * The result, and when the original can be shown, a before / after split
 * (drag the line). "100 %" shows real pixels: the place to judge compression.
 */
function ImageViewer({ src, original }: { src: string; original: string | null }) {
    const [compare, setCompare] = useState(!!original)
    const [zoom, setZoom] = useState(false)
    const [split, setSplit] = useState(50)
    const [after, setAfter] = useState<{ w: number; h: number } | null>(null)
    const [before, setBefore] = useState<{ w: number; h: number } | null>(null)
    const [failed, setFailed] = useState(false)
    const boxRef = useRef<HTMLDivElement>(null)
    const dragging = useRef(false)

    // A crop (aspect ratio, ICO square…) changes the framing: no split then.
    const aligned = !after || !before || Math.abs(after.w / after.h - before.w / before.h) < 0.02
    const showSplit = compare && !!original && aligned

    const moveTo = (clientX: number) => {
        const box = boxRef.current?.getBoundingClientRect()
        if (box && box.width > 0) setSplit(Math.max(0, Math.min(100, ((clientX - box.left) / box.width) * 100)))
    }
    const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (!showSplit) return
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        moveTo(e.clientX)
    }
    const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => { if (dragging.current) moveTo(e.clientX) }
    const onPointerUp = () => { dragging.current = false }
    const onHandleKey = (e: ReactKeyboardEvent) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
        e.stopPropagation()
        e.preventDefault()
        setSplit((v) => Math.max(0, Math.min(100, v + (e.key === 'ArrowLeft' ? -5 : 5))))
    }

    if (failed) {
        return <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-[13px] text-white/70">Le navigateur ne sait pas afficher cette image. Sauvegarde-la pour l'ouvrir.</p>
    }

    const fitted = 'absolute inset-0 h-full w-full object-contain'
    return (
        <>
            {/* flex + margin auto: centred when smaller, scrollable when bigger. */}
            <div className={cn('checker absolute inset-0 flex', zoom ? 'overflow-auto' : 'overflow-hidden')}>
                <div
                    ref={boxRef}
                    className={cn('relative shrink-0 touch-none select-none', zoom ? 'm-auto' : 'h-full w-full', showSplit && 'cursor-ew-resize')}
                    style={zoom && after ? { width: after.w, height: after.h } : undefined}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                >
                    {!after && <span className="absolute inset-0 flex items-center justify-center text-white/60"><Spinner /></span>}
                    <img
                        src={src}
                        alt="Résultat"
                        draggable={false}
                        className={zoom ? 'block h-full w-full' : fitted}
                        onLoad={(e) => setAfter({ w: e.currentTarget.naturalWidth || 1, h: e.currentTarget.naturalHeight || 1 })}
                        onError={() => setFailed(true)}
                    />
                    {original && (
                        <img
                            src={original}
                            alt="Original"
                            draggable={false}
                            className={cn(zoom ? 'absolute inset-0 h-full w-full' : fitted, !showSplit && 'invisible')}
                            style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
                            onLoad={(e) => setBefore({ w: e.currentTarget.naturalWidth || 1, h: e.currentTarget.naturalHeight || 1 })}
                        />
                    )}
                    {showSplit && (
                        <>
                            <div className="pointer-events-none absolute inset-y-0 w-px bg-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.4)]" style={{ left: `${split}%` }}>
                                <div
                                    role="slider"
                                    tabIndex={0}
                                    aria-label="Séparation avant / après"
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                    aria-valuenow={Math.round(split)}
                                    onKeyDown={onHandleKey}
                                    className="pointer-events-auto absolute top-1/2 left-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-black shadow-lg"
                                >
                                    <IconCompare size={16} />
                                </div>
                            </div>
                            <span className="pointer-events-none absolute top-3 left-3 rounded-[3px] bg-black/70 px-2 py-1 text-[11px] font-semibold text-white">Avant</span>
                            <span className="pointer-events-none absolute top-3 right-3 rounded-[3px] bg-black/70 px-2 py-1 text-[11px] font-semibold text-white">Après</span>
                        </>
                    )}
                </div>
            </div>

            <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-[4px] bg-black/70 p-1 text-white backdrop-blur">
                {original && (
                    <ToolButton active={compare} onClick={() => setCompare((v) => !v)} disabled={!aligned}
                        title={aligned ? 'Comparer avec l’original' : 'Cadrage différent : comparaison impossible'}>
                        <IconCompare size={14} /> Avant / après
                    </ToolButton>
                )}
                <ToolButton active={zoom} onClick={() => setZoom((v) => !v)} title="Pixels réels (pour juger la qualité)">
                    <IconZoom size={14} /> 100 %
                </ToolButton>
                {after && <span className="px-2 text-[11px] text-white/60 tabular-nums">{after.w} × {after.h}</span>}
            </div>
        </>
    )
}

function ToolButton({ active, onClick, title, disabled, children }: { active: boolean; onClick: () => void; title: string; disabled?: boolean; children: ReactNode }) {
    return (
        <button
            type="button"
            onClick={onClick}
            title={title}
            disabled={disabled}
            aria-pressed={active}
            className={cn('inline-flex h-8 items-center gap-1.5 rounded-[3px] px-3 text-[12px] font-semibold transition-colors disabled:opacity-40',
                active ? 'bg-white text-black' : 'text-white/85 hover:bg-white/15')}
        >
            {children}
        </button>
    )
}

/**
 * PDF results: pages rendered as images by the server (a PDF in a frame stays
 * blank on this cross-origin-isolated page), plus the browser's own viewer
 * in a new tab.
 */
function PdfViewer({ item, url }: { item: QueueItem; url: string }) {
    const [page, setPage] = useState(1)
    const [shown, setShown] = useState<{ src: string; pages: number; page: number } | null>(null)
    const [failed, setFailed] = useState(false)
    const server = !item.local && !!item.jobId

    useEffect(() => {
        if (!server) return
        let alive = true
        let made: string | null = null
        fetch(`/jobs/${item.jobId}/preview.png?page=${page}`, { cache: 'force-cache' })
            .then(async (r) => {
                if (!r.ok) throw new Error(String(r.status))
                const pages = parseInt(r.headers.get('X-Page-Count') || '1', 10) || 1
                made = URL.createObjectURL(await r.blob())
                if (alive) setShown({ src: made, pages, page })
                else URL.revokeObjectURL(made)
            })
            .catch(() => { if (alive) setFailed(true) })
        return () => {
            alive = false
            if (made) URL.revokeObjectURL(made)
        }
    }, [server, item.jobId, page])

    const openLink = (
        <a href={url} target="_blank" rel="noopener" className="inline-flex h-8 items-center gap-1.5 rounded-[3px] px-3 text-[12px] font-semibold text-white/85 hover:bg-white/15">
            Ouvrir dans un onglet
        </a>
    )
    if (!server || failed) {
        return (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-white/70">
                <KindIcon kind="pdf" size={40} />
                <p className="text-[13px]">Aperçu du PDF dans le lecteur du navigateur.</p>
                <div className="rounded-[4px] bg-white/10 p-1">{openLink}</div>
            </div>
        )
    }
    const pages = shown?.pages ?? 1
    return (
        <>
            <div className="scroll-thin absolute inset-0 flex overflow-auto bg-neutral-800 p-4">
                {shown ? (
                    <img src={shown.src} alt={`Page ${shown.page}`} className="m-auto max-h-full max-w-full bg-white shadow-[0_8px_30px_rgba(0,0,0,0.5)]" />
                ) : (
                    <span className="m-auto text-white/60"><Spinner /></span>
                )}
            </div>
            <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-[4px] bg-black/75 p-1 text-white backdrop-blur">
                {pages > 1 && (
                    <>
                        <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} aria-label="Page précédente"
                            className="flex h-8 w-8 items-center justify-center rounded-[3px] hover:bg-white/15 disabled:opacity-30"><IconChevronLeft size={15} /></button>
                        <span className="px-1 text-[12px] tabular-nums">Page {page} / {pages}</span>
                        <button type="button" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages} aria-label="Page suivante"
                            className="flex h-8 w-8 items-center justify-center rounded-[3px] hover:bg-white/15 disabled:opacity-30"><IconChevronRight size={15} /></button>
                    </>
                )}
                {openLink}
            </div>
        </>
    )
}

function TextViewer({ src }: { src: string }) {
    const [text, setText] = useState<string | null>(null)
    useEffect(() => {
        let alive = true
        fetch(src)
            .then((r) => r.text())
            .then((t) => { if (alive) setText(t.length > 200_000 ? `${t.slice(0, 200_000)}\n…` : t) })
            .catch(() => { if (alive) setText('Lecture impossible.') })
        return () => { alive = false }
    }, [src])
    return (
        <pre className="scroll-thin absolute inset-0 overflow-auto bg-card p-5 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-foreground">
            {text ?? 'Chargement…'}
        </pre>
    )
}
