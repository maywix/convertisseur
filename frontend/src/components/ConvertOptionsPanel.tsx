import type { ReactNode } from 'react'
import { Button, Details, Select, TextInput, type SelectOption } from '@/components/ui'
import {
    advancedCount, codecFits, resetAdvanced,
    type ConvertOptions, type Rotate, type TextPosition, type VideoCodec, type VideoQuality,
} from '@/lib/convertPlan'
import { cn } from '@/lib/utils'
import { FORMATS, KIND_LABEL, type MediaKind } from '@/types'

export interface PanelStats {
    kinds: MediaKind[]
    /** Target containers of videos that stay videos (mp4, webm…). */
    videoTargets: string[]
    gifs: number
    audioOut: number
    images: number
    imageTargets: string[]
    pendingImages: number
    zip: boolean
}

type Set_ = (p: Partial<ConvertOptions>) => void

const opts = (...values: [string, string][]): SelectOption[] => values.map(([value, label]) => ({ value, label }))

/** Keeps a custom value (set before, or restored) selectable. */
function withCurrent(options: SelectOption[], value: string, label = value): SelectOption[] {
    return options.some((o) => o.value === value) ? options : [...options, { value, label }]
}

// ── Layout pieces ────────────────────────────────────────

/** A titled group of the options card ("Vidéo", "Images"…). */
export function Block({ title, aside, children, className }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
    return (
        <section className={cn('border-t border-border px-5 py-5 sm:px-6', className)}>
            <div className="mb-4 flex items-baseline justify-between gap-3">
                <h3 className="text-[13px] font-bold">{title}</h3>
                {aside && <span className="text-[11px] text-faint">{aside}</span>}
            </div>
            {children}
        </section>
    )
}

/** Dropdowns side by side: 2 per row on phones, 4 on wider screens. */
export function Grid({ children }: { children: ReactNode }) {
    return <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-4">{children}</div>
}

function FieldLabel({ children }: { children: ReactNode }) {
    return <span className="mb-1.5 block truncate text-[10px] font-bold tracking-[0.1em] text-faint uppercase">{children}</span>
}

/** Labelled dropdown. */
export function Pick({
    label, value, options, onChange, wide,
}: {
    label: string
    value: string
    options: SelectOption[]
    onChange: (v: string) => void
    wide?: boolean
}) {
    return (
        <div className={cn('min-w-0', wide && 'col-span-2')}>
            <FieldLabel>{label}</FieldLabel>
            <Select value={value} options={options} onChange={onChange} className="w-full" ariaLabel={label} />
        </div>
    )
}

function TextField({
    label, value, onChange, placeholder, inputMode, wide,
}: {
    label: string
    value: string
    onChange: (v: string) => void
    placeholder?: string
    inputMode?: 'numeric' | 'decimal' | 'text'
    wide?: boolean
}) {
    return (
        <div className={cn('min-w-0', wide && 'col-span-2')}>
            <FieldLabel>{label}</FieldLabel>
            <TextInput value={value} onChange={onChange} placeholder={placeholder} inputMode={inputMode} ariaLabel={label} />
        </div>
    )
}

function Note({ children }: { children: ReactNode }) {
    return <p className="mt-3 text-[11px] leading-relaxed text-faint">{children}</p>
}

/** Output format for one kind of file. */
export function FormatSelect({ kind, value, onChange, label }: { kind: MediaKind; value: string; onChange: (v: string) => void; label?: string }) {
    return <Pick label={label ?? KIND_LABEL[kind]} value={value} options={FORMATS[kind]} onChange={onChange} />
}

// ── Choices ──────────────────────────────────────────────

const QUALITIES = opts(
    ['high', 'Haute'],
    ['balanced', 'Équilibrée'],
    ['small', 'Légère'],
    ['size', 'Poids cible (Mo)'],
    ['percent', 'Réduire le poids de…'],
    ['crf', 'CRF (qualité constante)'],
    ['bitrate', 'Débit fixe (kb/s)'],
)
const RESOLUTIONS = opts(
    ['', 'Originale'], ['4320', '4320p (8K)'], ['2160', '2160p (4K)'], ['1440', '1440p'], ['1080', '1080p (Full HD)'],
    ['720', '720p (HD)'], ['540', '540p'], ['480', '480p'], ['360', '360p'], ['240', '240p'], ['exact', 'Taille exacte…'],
)
const CODECS = opts(['libx264', 'H.264 · compatible'], ['libx265', 'H.265 · plus léger'], ['libvpx-vp9', 'VP9'], ['libaom-av1', 'AV1 · lent'])
const VIDEO_FPS = opts(
    ['', 'Originales'], ['120', '120'], ['60', '60'], ['50', '50'], ['48', '48'], ['30', '30'], ['29.97', '29,97'],
    ['25', '25'], ['24', '24'], ['23.976', '23,976'], ['15', '15'], ['12', '12'], ['10', '10'],
)
const CRFS = opts(
    ['16', '16 · très haute'], ['18', '18 · quasi sans perte'], ['20', '20'], ['22', '22'], ['23', '23 · standard'],
    ['24', '24'], ['26', '26'], ['28', '28 · léger'], ['30', '30'], ['32', '32'], ['35', '35 · très léger'],
)
const PERCENTS = [10, 20, 30, 40, 50, 60, 70, 80, 90].map((n) => ({ value: String(n), label: `− ${n} %` }))
const ROTATIONS = opts(['none', 'Aucune'], ['90', '90° horaire'], ['270', '90° anti-horaire'], ['180', '180°'], ['hflip', 'Miroir horizontal'], ['vflip', 'Miroir vertical'])
const AUDIO_TRACK = opts(['encode', 'Garder'], ['copy', 'Copier sans réencoder'], ['remove', 'Supprimer'])

const PRESETS = opts(['', 'Auto (rapide)'], ['ultrafast', 'ultrafast'], ['superfast', 'superfast'], ['veryfast', 'veryfast'], ['faster', 'faster'], ['fast', 'fast'], ['medium', 'medium'], ['slow', 'slow'], ['slower', 'slower'], ['veryslow', 'veryslow'])
const TUNES = opts(['none', 'Aucun'], ['film', 'Film'], ['animation', 'Animation'], ['grain', 'Grain'], ['stillimage', 'Image fixe'], ['fastdecode', 'Décodage rapide'], ['zerolatency', 'Faible latence'])
const PROFILES = opts(['auto', 'Auto'], ['high', 'High'], ['main', 'Main'], ['baseline', 'Baseline'])
const PIXELS = opts(['auto', 'Auto (4:2:0)'], ['yuv420p10le', '10 bits'], ['yuv422p', '4:2:2'], ['yuv444p', '4:4:4'])
const DENOISE = opts(['none', 'Aucun'], ['light', 'Léger'], ['medium', 'Moyen'], ['strong', 'Fort'])
const HDR = opts(['auto', 'Auto'], ['off', 'Désactivé'])
const YES_NO = opts(['0', 'Non'], ['1', 'Oui'])
const TEXT_POSITIONS = opts(['bottom', 'En bas'], ['top', 'En haut'], ['center', 'Au centre'], ['bottom-left', 'Bas gauche'], ['bottom-right', 'Bas droite'], ['top-left', 'Haut gauche'], ['top-right', 'Haut droite'])

const GIF_WIDTHS = opts(['320', '320 px'], ['480', '480 px'], ['640', '640 px'], ['800', '800 px'], ['1080', '1080 px'], ['0', 'Originale'])
const GIF_FPS = opts(['5', '5'], ['8', '8'], ['10', '10'], ['12', '12'], ['15', '15'], ['20', '20'], ['24', '24'], ['25', '25'], ['30', '30'])
const GIF_SPEEDS = opts(['0.25', '× 0,25'], ['0.5', '× 0,5'], ['0.75', '× 0,75'], ['1', 'Normale'], ['1.5', '× 1,5'], ['2', '× 2'], ['3', '× 3'], ['4', '× 4'])
const GIF_COLORS = opts(['256', '256'], ['128', '128'], ['64', '64'], ['32', '32'], ['16', '16'], ['8', '8'])
const GIF_DITHER = opts(['sierra2_4a', 'Sierra 2-4A'], ['floyd_steinberg', 'Floyd-Steinberg'], ['sierra2', 'Sierra 2'], ['sierra3', 'Sierra 3'], ['burkes', 'Burkes'], ['atkinson', 'Atkinson'], ['bayer', 'Bayer'], ['none', 'Aucun'])
const GIF_LOOP = opts(['0', 'En boucle'], ['-1', 'Une seule fois'], ['1', '2 fois'], ['2', '3 fois'])

const IMAGE_QUALITIES = [100, 95, 90, 85, 80, 75, 70, 60, 50, 40, 30, 20].map((n) => ({ value: String(n), label: `${n} %` }))
const IMAGE_SIZES = opts(
    ['', 'Originale'], ['3840', '3840 px'], ['2560', '2560 px'], ['1920', '1920 px'], ['1600', '1600 px'], ['1280', '1280 px'],
    ['1024', '1024 px'], ['800', '800 px'], ['512', '512 px'], ['256', '256 px'], ['%75', '75 %'], ['%50', '50 %'], ['%25', '25 %'],
)
const UPSCALES = opts(['1', 'Non'], ['2', '× 2'], ['3', '× 3'], ['4', '× 4'])
const ICO_SIZES = opts(['16', '16 px'], ['32', '32 px'], ['48', '48 px'], ['64', '64 px'], ['128', '128 px'], ['256', '256 px'])
const SLIDESHOW = opts(['', 'Non, une par une'], ['mp4', 'En vidéo MP4'], ['webm', 'En vidéo WebM'], ['gif', 'En GIF animé'])
const SLIDESHOW_FPS = opts(['0.5', '1 toutes les 2 s'], ['1', '1 par seconde'], ['2', '2'], ['5', '5'], ['12', '12'], ['24', '24'])

const AUDIO_BITRATES = opts(['64k', '64 kb/s'], ['96k', '96 kb/s'], ['128k', '128 kb/s'], ['160k', '160 kb/s'], ['192k', '192 kb/s'], ['256k', '256 kb/s'], ['320k', '320 kb/s'])
const SAMPLE_RATES = opts(['', 'Originale'], ['22050', '22,05 kHz'], ['44100', '44,1 kHz'], ['48000', '48 kHz'], ['96000', '96 kHz'])
const CHANNELS = opts(['', 'Originaux'], ['1', 'Mono'], ['2', 'Stéréo'])
const VOLUMES = opts(['norm', 'Normaliser (EBU R128)'], ['0', 'Inchangé'], ['-10', '− 10 dB'], ['-6', '− 6 dB'], ['-3', '− 3 dB'], ['3', '+ 3 dB'], ['6', '+ 6 dB'], ['10', '+ 10 dB'])
const FRAME_FPS = opts(['0.2', '1 toutes les 5 s'], ['0.5', '1 toutes les 2 s'], ['1', '1 par seconde'], ['5', '5 par seconde'], ['10', '10 par seconde'], ['24', '24 par seconde'], ['30', '30 par seconde'])

const digits = (v: string) => v.replace(/[^\d]/g, '')
const decimal = (v: string) => v.replace(',', '.').replace(/[^\d.]/g, '')

// ── The card body ────────────────────────────────────────

/** Every conversion option as dropdowns, grouped by media type. Only the groups for the files present are shown. */
export function ConvertOptionsPanel({ o, set, stats }: { o: ConvertOptions; set: Set_; stats: PanelStats }) {
    const hasVideo = stats.videoTargets.length > 0
    const hasTimed = hasVideo || stats.gifs > 0 || stats.audioOut > 0
    const audioTrack = o.removeAudio ? 'remove' : o.audioCopy ? 'copy' : 'encode'
    const showAudio = stats.audioOut > 0 || (hasVideo && audioTrack === 'encode')
    const misfits = stats.videoTargets.filter((t) => !codecFits(o.videoCodec, t))
    const active = advancedCount(o)
    const imageSize = o.imageResizeMode === 'percent' ? `%${o.imagePercent}` : o.imageMaxSize

    return (
        <>
            {hasVideo && (
                <Block title="Vidéo" aside={stats.videoTargets.map((t) => t.toUpperCase()).join(', ')}>
                    <Grid>
                        <Pick label="Qualité" value={o.videoQuality} options={QUALITIES} onChange={(v) => set({ videoQuality: v as VideoQuality })} />
                        {o.videoQuality === 'size' && (
                            <TextField label="Poids visé (Mo)" value={o.videoTargetMb} onChange={(v) => set({ videoTargetMb: decimal(v) })} inputMode="decimal" placeholder="25" />
                        )}
                        {o.videoQuality === 'percent' && (
                            <Pick label="Réduction" value={String(o.videoPercent)} options={withCurrent(PERCENTS, String(o.videoPercent), `− ${o.videoPercent} %`)}
                                onChange={(v) => set({ videoPercent: parseInt(v, 10) })} />
                        )}
                        {o.videoQuality === 'crf' && (
                            <Pick label="CRF" value={String(o.videoCrf)} options={withCurrent(CRFS, String(o.videoCrf))} onChange={(v) => set({ videoCrf: parseInt(v, 10) })} />
                        )}
                        {o.videoQuality === 'bitrate' && (
                            <>
                                <TextField label="Débit (kb/s)" value={o.videoBitrateK} onChange={(v) => set({ videoBitrateK: digits(v) })} inputMode="numeric" placeholder="4000" />
                                <Pick label="Passes" value={o.twoPass ? '1' : '0'} options={opts(['0', '1 passe'], ['1', '2 passes (précis)'])} onChange={(v) => set({ twoPass: v === '1' })} />
                            </>
                        )}
                        <Pick label="Résolution max" value={o.resizeMode === 'exact' ? 'exact' : o.videoMaxHeight} options={withCurrent(RESOLUTIONS, o.videoMaxHeight, `${o.videoMaxHeight}p`)}
                            onChange={(v) => set(v === 'exact' ? { resizeMode: 'exact' } : { resizeMode: 'max', videoMaxHeight: v })} />
                        {o.resizeMode === 'exact' && (
                            <>
                                <TextField label="Largeur (px)" value={o.resizeWidth} onChange={(v) => set({ resizeWidth: digits(v) })} inputMode="numeric" placeholder="auto" />
                                <TextField label="Hauteur (px)" value={o.resizeHeight} onChange={(v) => set({ resizeHeight: digits(v) })} inputMode="numeric" placeholder="auto" />
                            </>
                        )}
                        <Pick label="Codec" value={o.videoCodec} options={CODECS} onChange={(v) => set({ videoCodec: v as VideoCodec })} />
                        <Pick label="Images / s" value={o.videoFps} options={withCurrent(VIDEO_FPS, o.videoFps)} onChange={(v) => set({ videoFps: v })} />
                        <Pick label="Rotation" value={o.rotate} options={ROTATIONS} onChange={(v) => set({ rotate: v as Rotate })} />
                        <Pick label="Piste son" value={audioTrack} options={AUDIO_TRACK}
                            onChange={(v) => set({ removeAudio: v === 'remove', audioCopy: v === 'copy' })} />
                    </Grid>
                    {misfits.length > 0 && <Note>{CODECS.find((c) => c.value === o.videoCodec)?.label} ne va pas dans {misfits.map((t) => t.toUpperCase()).join(', ')} : le codec habituel de ce format sera utilisé.</Note>}
                    {o.videoQuality === 'size' && <Note>Pratique pour Discord : 10 ou 25 Mo. Le débit est calculé d'après la durée.</Note>}
                    {o.videoQuality === 'crf' && <Note>Plus le CRF est bas, meilleure est la qualité (et plus gros le fichier).</Note>}
                </Block>
            )}

            {stats.gifs > 0 && (
                <Block title="GIF animé">
                    <Grid>
                        <Pick label="Largeur" value={o.gifWidth} options={withCurrent(GIF_WIDTHS, o.gifWidth, `${o.gifWidth} px`)} onChange={(v) => set({ gifWidth: v })} />
                        <Pick label="Images / s" value={o.gifFps} options={withCurrent(GIF_FPS, o.gifFps)} onChange={(v) => set({ gifFps: v })} />
                        <Pick label="Vitesse" value={o.gifSpeed} options={withCurrent(GIF_SPEEDS, o.gifSpeed)} onChange={(v) => set({ gifSpeed: v })} />
                        <Pick label="Couleurs" value={String(o.gifColors)} options={withCurrent(GIF_COLORS, String(o.gifColors))} onChange={(v) => set({ gifColors: parseInt(v, 10) })} />
                        <Pick label="Tramage" value={o.gifDither} options={GIF_DITHER} onChange={(v) => set({ gifDither: v })} />
                        <Pick label="Lecture" value={o.gifLoop} options={withCurrent(GIF_LOOP, o.gifLoop)} onChange={(v) => set({ gifLoop: v })} />
                    </Grid>
                </Block>
            )}

            {stats.images > 0 && (
                <Block title="Images" aside={stats.imageTargets.map((t) => t.toUpperCase()).join(', ')}>
                    <Grid>
                        <Pick label="Qualité" value={String(o.imageQuality)} options={withCurrent(IMAGE_QUALITIES, String(o.imageQuality), `${o.imageQuality} %`)}
                            onChange={(v) => set({ imageQuality: parseInt(v, 10) })} />
                        <Pick label="Taille max" value={imageSize}
                            options={withCurrent(IMAGE_SIZES, imageSize, imageSize.startsWith('%') ? `${imageSize.slice(1)} %` : `${imageSize} px`)}
                            onChange={(v) => set(v.startsWith('%') ? { imageResizeMode: 'percent', imagePercent: parseInt(v.slice(1), 10) } : { imageResizeMode: 'max', imageMaxSize: v })} />
                        <Pick label="Agrandir" value={o.imageUpscale} options={UPSCALES} onChange={(v) => set({ imageUpscale: v })} />
                        <TextField label="Poids visé (Mo)" value={o.imageTargetMb} onChange={(v) => set({ imageTargetMb: decimal(v) })} inputMode="decimal" placeholder="—" />
                        {stats.imageTargets.includes('webp') && (
                            <Pick label="Compression WebP" value={o.imageLossless ? '1' : '0'} options={opts(['0', 'Avec perte'], ['1', 'Sans perte'])}
                                onChange={(v) => set({ imageLossless: v === '1' })} />
                        )}
                        {stats.imageTargets.includes('ico') && (
                            <Pick label="Taille de l'icône" value={o.icoSize} options={ICO_SIZES} onChange={(v) => set({ icoSize: v })} />
                        )}
                        {stats.pendingImages >= 2 && (
                            <Pick label="Assembler les images" value={o.slideshow ? o.slideshowFormat : ''} options={SLIDESHOW}
                                onChange={(v) => set(v ? { slideshow: true, slideshowFormat: v as ConvertOptions['slideshowFormat'] } : { slideshow: false })} />
                        )}
                        {stats.pendingImages >= 2 && o.slideshow && (
                            <Pick label="Images / s (diaporama)" value={o.slideshowFps} options={withCurrent(SLIDESHOW_FPS, o.slideshowFps)} onChange={(v) => set({ slideshowFps: v })} />
                        )}
                    </Grid>
                    <Note>
                        Qualité : JPG, WebP, AVIF. Taille max : côté le plus long, sans jamais agrandir.
                        {o.slideshow && ' Diaporama : les images en attente deviennent une seule vidéo, dans l\'ordre alphabétique.'}
                        {' '}Lumière, couleurs et LUT : onglet Color Lab.
                    </Note>
                </Block>
            )}

            {showAudio && (
                <Block title="Son">
                    <Grid>
                        <Pick label="Débit" value={o.audioBitrate} options={withCurrent(AUDIO_BITRATES, o.audioBitrate)} onChange={(v) => set({ audioBitrate: v })} />
                        <Pick label="Fréquence" value={o.audioSampleRate} options={withCurrent(SAMPLE_RATES, o.audioSampleRate, `${o.audioSampleRate} Hz`)} onChange={(v) => set({ audioSampleRate: v })} />
                        <Pick label="Canaux" value={o.audioChannels} options={withCurrent(CHANNELS, o.audioChannels)} onChange={(v) => set({ audioChannels: v })} />
                        <Pick label="Volume" value={o.audioNormalize ? 'norm' : String(o.audioVolume)}
                            options={withCurrent(VOLUMES, String(o.audioVolume), `${o.audioVolume > 0 ? '+ ' : ''}${o.audioVolume} dB`)}
                            onChange={(v) => set(v === 'norm' ? { audioNormalize: true, audioVolume: 0 } : { audioNormalize: false, audioVolume: parseFloat(v) })} />
                    </Grid>
                </Block>
            )}

            {stats.zip && (
                <Block title="Vidéo → images PNG">
                    <Grid>
                        <Pick label="Images extraites" value={o.frameFps} options={withCurrent(FRAME_FPS, o.frameFps)} onChange={(v) => set({ frameFps: v })} wide />
                    </Grid>
                </Block>
            )}

            {hasTimed && (
                <Block title="Découper" aside="secondes ou h:mm:ss, vide = tout">
                    <Grid>
                        <TextField label="Début" value={o.trimStart} onChange={(v) => set({ trimStart: v })} placeholder="0:05" inputMode="decimal" />
                        <TextField label="Fin" value={o.trimEnd} onChange={(v) => set({ trimEnd: v })} placeholder="1:30" inputMode="decimal" />
                    </Grid>
                </Block>
            )}

            {hasVideo && (
                <section className="border-t border-border px-5 py-5 sm:px-6">
                    <Details
                        summary="Plus d'options vidéo"
                        hint={active > 0 ? `${active} active${active > 1 ? 's' : ''}` : 'preset, profil, recadrage, débruitage, texte…'}
                        open={o.advanced}
                        onToggle={(v) => set({ advanced: v })}
                    >
                        <Grid>
                            <Pick label="Preset" value={o.videoPreset} options={PRESETS} onChange={(v) => set({ videoPreset: v })} />
                            <Pick label="Tune" value={o.videoTune} options={TUNES} onChange={(v) => set({ videoTune: v })} />
                            {o.videoCodec === 'libx264' && (
                                <Pick label="Profil" value={o.videoProfile} options={PROFILES} onChange={(v) => set({ videoProfile: v as ConvertOptions['videoProfile'] })} />
                            )}
                            <Pick label="Pixels" value={o.pixelFormat} options={withCurrent(PIXELS, o.pixelFormat)} onChange={(v) => set({ pixelFormat: v as ConvertOptions['pixelFormat'] })} />
                            <Pick label="Débruitage" value={o.denoise} options={DENOISE} onChange={(v) => set({ denoise: v as ConvertOptions['denoise'] })} />
                            <Pick label="HDR → SDR" value={o.hdr} options={HDR} onChange={(v) => set({ hdr: v as ConvertOptions['hdr'] })} />
                            <Pick label="Désentrelacer" value={o.deinterlace ? '1' : '0'} options={YES_NO} onChange={(v) => set({ deinterlace: v === '1' })} />
                        </Grid>
                        <p className="mt-5 mb-2 text-[10px] font-bold tracking-[0.1em] text-faint uppercase">Rogner (pixels retirés)</p>
                        <Grid>
                            {([['cropTop', 'Haut'], ['cropBottom', 'Bas'], ['cropLeft', 'Gauche'], ['cropRight', 'Droite']] as const).map(([key, label]) => (
                                <TextInput key={key} value={o[key]} onChange={(v) => set({ [key]: digits(v) } as Partial<ConvertOptions>)} placeholder={label} inputMode="numeric" ariaLabel={`Rogner ${label}`} />
                            ))}
                        </Grid>
                        <div className="mt-5">
                            <Grid>
                                <TextField label="Texte incrusté" value={o.overlayText} onChange={(v) => set({ overlayText: v })} placeholder="Optionnel" wide />
                                {o.overlayText.trim() && (
                                    <Pick label="Position du texte" value={o.overlayPosition} options={TEXT_POSITIONS} onChange={(v) => set({ overlayPosition: v as TextPosition })} />
                                )}
                            </Grid>
                        </div>
                        {o.pixelFormat !== 'auto' && o.pixelFormat !== 'yuv420p' && (
                            <Note>En 10 bits, 4:2:2 ou 4:4:4, beaucoup de lecteurs (navigateurs, iPhone, Windows) ne liront pas la vidéo.</Note>
                        )}
                        {active > 0 && (
                            <Button size="sm" className="mt-4" onClick={() => set(resetAdvanced(o))}>Tout remettre par défaut</Button>
                        )}
                    </Details>
                </section>
            )}
        </>
    )
}
