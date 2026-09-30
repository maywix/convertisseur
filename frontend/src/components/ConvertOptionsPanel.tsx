import type { ReactNode } from 'react'
import { Button, Details, Field, Label, Row, Segmented, Select, Slider, TextInput, Toggle } from '@/components/ui'
import {
    advancedCount, codecFits, resetAdvanced,
    type ConvertOptions, type TextPosition, type VideoCodec, type VideoQuality,
} from '@/lib/convertPlan'
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

const opts = (...values: [string, string][]) => values.map(([value, label]) => ({ value, label }))

/** Formats shown as tabs; the rest sit in an "Autre…" menu. */
const MAIN_FORMATS: Record<MediaKind, string[]> = {
    video: ['mp4', 'webm', 'mov', 'mkv', 'gif', 'mp3'],
    audio: ['mp3', 'm4a', 'flac', 'wav', 'ogg', 'opus'],
    image: ['jpg', 'png', 'webp', 'avif', 'gif'],
    pdf: ['pdf', 'txt'],
    document: ['pdf'],
    '3d': ['glb', 'obj', 'stl', 'ply'],
}

export function FormatTabs({ kind, value, onChange, label }: { kind: MediaKind; value: string; onChange: (v: string) => void; label?: string }) {
    const main = MAIN_FORMATS[kind]
    const all = FORMATS[kind]
    const others = all.filter((f) => !main.includes(f.value))
    const labelOf = (v: string) => all.find((f) => f.value === v)?.label ?? v.toUpperCase()
    return (
        <div className="space-y-2">
            <Label>{label ?? KIND_LABEL[kind]}</Label>
            <div className="flex flex-wrap gap-1.5">
                <Segmented
                    wrap
                    value={value}
                    onChange={onChange}
                    options={main.map((v) => ({ value: v, label: kind === 'video' && v === 'mp3' ? 'MP3 (son)' : labelOf(v) }))}
                />
                {others.length > 0 && (
                    <Select
                        value={main.includes(value) ? '' : value}
                        onChange={(v) => v && onChange(v)}
                        ariaLabel={`Autre format pour ${KIND_LABEL[kind]}`}
                        className={main.includes(value) ? 'w-[118px]' : 'w-[150px] [&_select]:border-primary [&_select]:font-semibold'}
                        options={[{ value: '', label: 'Autre…' }, ...others]}
                    />
                )}
            </div>
        </div>
    )
}

function Grid({ children }: { children: ReactNode }) {
    return <div className="grid grid-cols-2 gap-2">{children}</div>
}

function Note({ children }: { children: ReactNode }) {
    return <p className="text-[11px] leading-relaxed text-faint">{children}</p>
}

function Group({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div className="space-y-3">
            <h4 className="mt-3 text-[11px] tracking-[0.06em] text-faint uppercase">{title}</h4>
            {children}
        </div>
    )
}

const MAX_HEIGHTS = opts(['', 'Originale'], ['2160', '2160p'], ['1440', '1440p'], ['1080', '1080p'], ['720', '720p'], ['480', '480p'])
const ROTATIONS = opts(['none', 'Aucune'], ['90', '90° →'], ['270', '90° ←'], ['180', '180°'], ['hflip', 'Miroir horizontal'], ['vflip', 'Miroir vertical'])

/** Everyday options, then the "Réglages avancés" block. */
export function ConvertOptionsPanel({ o, set, stats }: { o: ConvertOptions; set: Set_; stats: PanelStats }) {
    const hasVideo = stats.videoTargets.length > 0
    const hasTimed = hasVideo || stats.gifs > 0 || stats.audioOut > 0
    const active = advancedCount(o)
    const simpleQuality = (['high', 'balanced', 'small', 'size'] as VideoQuality[]).includes(o.videoQuality) ? o.videoQuality : ('' as VideoQuality)

    return (
        <div className="space-y-6">
            {hasVideo && (
                <>
                    <Field label="Qualité vidéo">
                        <Segmented<VideoQuality>
                            variant="outline"
                            wrap
                            value={simpleQuality}
                            onChange={(v) => set({ videoQuality: v })}
                            options={[
                                { value: 'high', label: 'Haute' },
                                { value: 'balanced', label: 'Équilibrée' },
                                { value: 'small', label: 'Légère' },
                                { value: 'size', label: 'Taille cible' },
                            ]}
                        />
                        {!simpleQuality && <Note>Réglage avancé actif : {o.videoQuality === 'crf' ? `CRF ${o.videoCrf}` : o.videoQuality === 'bitrate' ? `${o.videoBitrateK} kb/s` : `−${o.videoPercent} %`}.</Note>}
                        {o.videoQuality === 'size' && <TargetSize o={o} set={set} />}
                    </Field>
                    <Field label="Résolution maximale">
                        <Segmented variant="outline" wrap value={o.resizeMode === 'exact' ? 'exact' : o.videoMaxHeight}
                            onChange={(v) => { if (v !== 'exact') set({ videoMaxHeight: v, resizeMode: 'max' }) }}
                            options={[...MAX_HEIGHTS, ...(o.resizeMode === 'exact' ? [{ value: 'exact', label: 'Taille exacte' }] : [])]} />
                    </Field>
                    <Field label="Codec">
                        <Segmented variant="outline" wrap value={o.videoCodec}
                            onChange={(v) => set({ videoCodec: v })}
                            options={[
                                { value: 'libx264', label: 'H.264 · compatible' },
                                { value: 'libx265', label: 'H.265 · plus léger' },
                                ...(o.videoCodec === 'libvpx-vp9' || o.videoCodec === 'libaom-av1'
                                    ? [{ value: o.videoCodec, label: o.videoCodec === 'libvpx-vp9' ? 'VP9' : 'AV1' }] : []),
                            ]} />
                    </Field>
                    <Toggle checked={o.removeAudio} onChange={(v) => set({ removeAudio: v })} label="Supprimer le son" />
                </>
            )}

            {stats.gifs > 0 && (
                <>
                    <Field label="GIF · largeur">
                        <Segmented variant="outline" wrap value={o.gifWidth} onChange={(v) => set({ gifWidth: v })}
                            options={opts(['320', '320 px'], ['480', '480 px'], ['640', '640 px'], ['800', '800 px'], ['0', 'Originale'])} />
                    </Field>
                    <Grid>
                        <Field label="Images / s">
                            <Select value={o.gifFps} onChange={(v) => set({ gifFps: v })} className="w-full" ariaLabel="Images par seconde du GIF"
                                options={opts(['5', '5'], ['8', '8'], ['10', '10'], ['12', '12'], ['15', '15'], ['20', '20'], ['24', '24'], ['25', '25'], ['30', '30'])} />
                        </Field>
                        <Field label="Vitesse">
                            <Select value={o.gifSpeed} onChange={(v) => set({ gifSpeed: v })} className="w-full" ariaLabel="Vitesse du GIF"
                                options={opts(['0.25', '× 0,25'], ['0.5', '× 0,5'], ['0.75', '× 0,75'], ['1', '× 1'], ['1.5', '× 1,5'], ['2', '× 2'], ['3', '× 3'], ['4', '× 4'])} />
                        </Field>
                    </Grid>
                </>
            )}

            {stats.images > 0 && (
                <>
                    <Slider label="Qualité des images (JPG, WebP, AVIF)" value={o.imageQuality} min={10} max={100} step={1} neutral={90}
                        onChange={(v) => set({ imageQuality: v })} format={(v) => `${v} %`} />
                    <Field label="Taille maximale des images">
                        <Segmented variant="outline" wrap value={o.imageResizeMode === 'percent' ? 'percent' : o.imageMaxSize}
                            onChange={(v) => { if (v !== 'percent') set({ imageMaxSize: v, imageResizeMode: 'max' }) }}
                            options={[
                                ...opts(['', 'Originale'], ['3840', '3840'], ['2560', '2560'], ['1920', '1920'], ['1280', '1280'], ['800', '800'], ['512', '512']),
                                ...(o.imageResizeMode === 'percent' ? [{ value: 'percent', label: `${o.imagePercent} %` }] : []),
                            ]} />
                    </Field>
                    <Field label="Agrandir (Lanczos)">
                        <Segmented variant="outline" wrap value={o.imageUpscale} onChange={(v) => set({ imageUpscale: v })}
                            options={opts(['1', 'Non'], ['2', '× 2'], ['3', '× 3'], ['4', '× 4'])} />
                    </Field>
                    {stats.pendingImages >= 2 && (
                        <div className="space-y-3 rounded-[4px] border border-border p-3">
                            <Toggle checked={o.slideshow} onChange={(v) => set({ slideshow: v })} label="Assembler les images en une vidéo"
                                description="Les images en attente deviennent un diaporama (ordre alphabétique)." />
                            {o.slideshow && (
                                <Grid>
                                    <Field label="Format">
                                        <Select value={o.slideshowFormat} onChange={(v) => set({ slideshowFormat: v as ConvertOptions['slideshowFormat'] })} className="w-full" ariaLabel="Format du diaporama"
                                            options={opts(['mp4', 'MP4'], ['webm', 'WebM'], ['gif', 'GIF'])} />
                                    </Field>
                                    <Field label="Images / s">
                                        <Select value={o.slideshowFps} onChange={(v) => set({ slideshowFps: v })} className="w-full" ariaLabel="Images par seconde du diaporama"
                                            options={opts(['0.5', '1 / 2 s'], ['1', '1'], ['2', '2'], ['5', '5'], ['12', '12'], ['24', '24'])} />
                                    </Field>
                                </Grid>
                            )}
                        </div>
                    )}
                </>
            )}

            {(stats.audioOut > 0 || hasVideo) && (
                <Field label="Débit du son">
                    <Segmented variant="outline" wrap value={o.audioBitrate} onChange={(v) => set({ audioBitrate: v })}
                        options={opts(['128k', '128k'], ['192k', '192k'], ['256k', '256k'], ['320k', '320k'], ...(['128k', '192k', '256k', '320k'].includes(o.audioBitrate) ? [] : [[o.audioBitrate, o.audioBitrate] as [string, string]]))} />
                    <Toggle checked={o.audioNormalize} onChange={(v) => set({ audioNormalize: v })} label="Normaliser le volume" description="Niveau sonore homogène (EBU R128)" />
                </Field>
            )}

            {stats.zip && (
                <Field label="Vidéo → images · par seconde">
                    <Segmented variant="outline" wrap value={o.frameFps} onChange={(v) => set({ frameFps: v })}
                        options={opts(['0.2', '1 / 5 s'], ['1', '1'], ['5', '5'], ['10', '10'])} />
                </Field>
            )}

            {hasTimed && (
                <Field label="Couper" hint="secondes ou h:mm:ss">
                    <Grid>
                        <TextInput value={o.trimStart} onChange={(v) => set({ trimStart: v })} placeholder="Début (0:05)" inputMode="decimal" ariaLabel="Début" />
                        <TextInput value={o.trimEnd} onChange={(v) => set({ trimEnd: v })} placeholder="Fin (1:30)" inputMode="decimal" ariaLabel="Fin" />
                    </Grid>
                </Field>
            )}

            {(hasVideo || stats.gifs > 0 || stats.images > 0 || stats.audioOut > 0) && (
                <Details
                    summary="Réglages avancés"
                    hint={active > 0 ? `${active} actif${active > 1 ? 's' : ''}` : 'codec, CRF, débit, recadrage, son…'}
                    open={o.advanced}
                    onToggle={(v) => set({ advanced: v })}
                >
                    <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
                        {hasVideo && <VideoEncoding o={o} set={set} targets={stats.videoTargets} />}
                        {hasVideo && <VideoPicture o={o} set={set} />}
                        {(stats.audioOut > 0 || hasVideo) && <AudioAdvanced o={o} set={set} hasVideo={hasVideo} />}
                        {stats.gifs > 0 && <GifAdvanced o={o} set={set} />}
                        {stats.images > 0 && <ImageAdvanced o={o} set={set} targets={stats.imageTargets} />}
                    </div>
                    {active > 0 && (
                        <Button size="sm" className="mt-4" onClick={() => set(resetAdvanced(o))}>Réinitialiser les réglages avancés</Button>
                    )}
                </Details>
            )}
        </div>
    )
}

function TargetSize({ o, set }: { o: ConvertOptions; set: Set_ }) {
    return (
        <div className="flex items-center gap-2">
            <TextInput value={o.videoTargetMb} onChange={(v) => set({ videoTargetMb: v.replace(',', '.') })} inputMode="decimal" ariaLabel="Poids visé en Mo" className="w-28" />
            <span className="text-[13px] text-muted-foreground">Mo par vidéo · ex. 10 ou 25 pour Discord</span>
        </div>
    )
}

// ── Advanced groups ──────────────────────────────────────

const RATE_MODES = opts(
    ['high', 'Préréglage · haute'],
    ['balanced', 'Préréglage · équilibrée'],
    ['small', 'Préréglage · légère'],
    ['crf', 'CRF (qualité constante)'],
    ['bitrate', 'Débit fixe (kb/s)'],
    ['size', 'Taille cible (Mo)'],
    ['percent', 'Réduction en %'],
)
const PRESETS = opts(['', 'Auto (rapide)'], ['ultrafast', 'ultrafast'], ['superfast', 'superfast'], ['veryfast', 'veryfast'], ['faster', 'faster'], ['fast', 'fast'], ['medium', 'medium'], ['slow', 'slow'], ['slower', 'slower'], ['veryslow', 'veryslow'])
const TUNES = opts(['none', 'Aucun'], ['film', 'Film'], ['animation', 'Animation'], ['grain', 'Grain'], ['stillimage', 'Image fixe'], ['fastdecode', 'Décodage rapide'], ['zerolatency', 'Faible latence'])
const CODECS = opts(['libx264', 'H.264 (AVC)'], ['libx265', 'H.265 (HEVC)'], ['libvpx-vp9', 'VP9'], ['libaom-av1', 'AV1 (lent)'])
const TEXT_POSITIONS = opts(['bottom', 'En bas'], ['top', 'En haut'], ['center', 'Au centre'], ['bottom-left', 'Bas gauche'], ['bottom-right', 'Bas droite'], ['top-left', 'Haut gauche'], ['top-right', 'Haut droite'])

function VideoEncoding({ o, set, targets }: { o: ConvertOptions; set: Set_; targets: string[] }) {
    const x26x = o.videoCodec === 'libx264' || o.videoCodec === 'libx265'
    const misfits = targets.filter((t) => !codecFits(o.videoCodec, t))
    return (
        <Group title="Encodage vidéo">
            <Row label="Codec"><Select value={o.videoCodec} onChange={(v) => set({ videoCodec: v as VideoCodec })} className="w-44" ariaLabel="Codec vidéo" options={CODECS} /></Row>
            {misfits.length > 0 && <Note>Incompatible avec {misfits.map((t) => t.toUpperCase()).join(', ')} : le codec par défaut du format sera utilisé.</Note>}
            <Row label="Qualité"><Select value={o.videoQuality} onChange={(v) => set({ videoQuality: v as VideoQuality })} className="w-44" ariaLabel="Contrôle de la qualité" options={RATE_MODES} /></Row>
            {o.videoQuality === 'crf' && (
                <>
                    <Slider label="CRF" value={o.videoCrf} min={0} max={51} neutral={23} onChange={(v) => set({ videoCrf: v })} format={(v) => String(v)} />
                    <Note>Plus bas = meilleure qualité, fichier plus gros. H.264 : 18 quasi sans perte, 23 standard, 28 léger.</Note>
                </>
            )}
            {o.videoQuality === 'bitrate' && (
                <>
                    <Row label="Débit vidéo (kb/s)">
                        <TextInput value={o.videoBitrateK} onChange={(v) => set({ videoBitrateK: v.replace(/[^\d]/g, '') })} inputMode="numeric" ariaLabel="Débit vidéo en kb/s" className="w-28" />
                    </Row>
                    <Toggle checked={o.twoPass} onChange={(v) => set({ twoPass: v })} label="Encodage en 2 passes" description="Débit plus précis, deux fois plus long (H.264)." />
                </>
            )}
            {o.videoQuality === 'size' && <TargetSize o={o} set={set} />}
            {o.videoQuality === 'percent' && (
                <Slider label="Réduire le poids de" value={o.videoPercent} min={5} max={95} step={5} neutral={50} onChange={(v) => set({ videoPercent: v })} format={(v) => `${v} %`} />
            )}
            {x26x && (
                <>
                    <Row label="Preset"><Select value={o.videoPreset} onChange={(v) => set({ videoPreset: v })} className="w-44" ariaLabel="Preset d'encodage" options={PRESETS} /></Row>
                    <Row label="Tune"><Select value={o.videoTune} onChange={(v) => set({ videoTune: v })} className="w-44" ariaLabel="Tune" options={TUNES} /></Row>
                    {o.videoCodec === 'libx264' && (
                        <Row label="Profil"><Select value={o.videoProfile} onChange={(v) => set({ videoProfile: v as ConvertOptions['videoProfile'] })} className="w-44" ariaLabel="Profil"
                            options={opts(['auto', 'Auto'], ['high', 'High'], ['main', 'Main'], ['baseline', 'Baseline'])} /></Row>
                    )}
                    <Row label="Pixels"><Select value={o.pixelFormat} onChange={(v) => set({ pixelFormat: v as ConvertOptions['pixelFormat'] })} className="w-44" ariaLabel="Format de pixels"
                        options={opts(['auto', 'Auto (4:2:0)'], ['yuv420p10le', '10 bits'], ['yuv422p', '4:2:2'], ['yuv444p', '4:4:4'])} /></Row>
                    {o.pixelFormat !== 'auto' && o.pixelFormat !== 'yuv420p' && (
                        <Note>En 10 bits, 4:2:2 ou 4:4:4, beaucoup de lecteurs (navigateurs, iPhone, Windows) ne liront pas la vidéo.</Note>
                    )}
                </>
            )}
        </Group>
    )
}

function VideoPicture({ o, set }: { o: ConvertOptions; set: Set_ }) {
    return (
        <Group title="Image vidéo">
            <Segmented size="sm" value={o.resizeMode} onChange={(v) => set({ resizeMode: v })}
                options={[{ value: 'max', label: 'Hauteur max' }, { value: 'exact', label: 'Taille exacte' }]} />
            {o.resizeMode === 'max' ? (
                <Select value={o.videoMaxHeight} onChange={(v) => set({ videoMaxHeight: v })} className="w-full" ariaLabel="Hauteur maximale"
                    options={opts(['', 'Originale'], ['4320', '4320p (8K)'], ['2160', '2160p (4K)'], ['1440', '1440p'], ['1080', '1080p'], ['720', '720p'], ['540', '540p'], ['480', '480p'], ['360', '360p'], ['240', '240p'])} />
            ) : (
                <Grid>
                    <TextInput value={o.resizeWidth} onChange={(v) => set({ resizeWidth: v.replace(/[^\d]/g, '') })} placeholder="Largeur (auto)" inputMode="numeric" ariaLabel="Largeur" />
                    <TextInput value={o.resizeHeight} onChange={(v) => set({ resizeHeight: v.replace(/[^\d]/g, '') })} placeholder="Hauteur (auto)" inputMode="numeric" ariaLabel="Hauteur" />
                </Grid>
            )}
            <Row label="Images / s">
                <TextInput value={o.videoFps} onChange={(v) => set({ videoFps: v.replace(',', '.').replace(/[^\d.]/g, '') })} placeholder="Original" inputMode="decimal" ariaLabel="Images par seconde" className="w-28" />
            </Row>
            <Row label="Rotation"><Select value={o.rotate} onChange={(v) => set({ rotate: v as ConvertOptions['rotate'] })} className="w-44" ariaLabel="Rotation" options={ROTATIONS} /></Row>
            <div className="space-y-1.5">
                <span className="text-[13px]">Recadrer (px retirés)</span>
                <div className="grid grid-cols-4 gap-1.5">
                    {([['cropTop', 'Haut'], ['cropBottom', 'Bas'], ['cropLeft', 'Gauche'], ['cropRight', 'Droite']] as const).map(([key, label]) => (
                        <TextInput key={key} value={o[key]} onChange={(v) => set({ [key]: v.replace(/[^\d]/g, '') } as Partial<ConvertOptions>)} placeholder={label} inputMode="numeric" ariaLabel={`Recadrer ${label}`} className="px-2 text-xs" />
                    ))}
                </div>
            </div>
            <Row label="Débruitage"><Select value={o.denoise} onChange={(v) => set({ denoise: v as ConvertOptions['denoise'] })} className="w-44" ariaLabel="Débruitage"
                options={opts(['none', 'Aucun'], ['light', 'Léger'], ['medium', 'Moyen'], ['strong', 'Fort'])} /></Row>
            <Row label="HDR → SDR"><Select value={o.hdr} onChange={(v) => set({ hdr: v as ConvertOptions['hdr'] })} className="w-44" ariaLabel="HDR vers SDR"
                options={opts(['auto', 'Auto'], ['off', 'Désactivé'])} /></Row>
            <Toggle checked={o.deinterlace} onChange={(v) => set({ deinterlace: v })} label="Désentrelacer" description="Vidéos TV / caméscope (1080i, 576i)." />
            <TextInput value={o.overlayText} onChange={(v) => set({ overlayText: v })} placeholder="Texte incrusté (optionnel)" ariaLabel="Texte incrusté" />
            {o.overlayText.trim() && (
                <Select value={o.overlayPosition} onChange={(v) => set({ overlayPosition: v as TextPosition })} className="w-full" ariaLabel="Position du texte" options={TEXT_POSITIONS} />
            )}
        </Group>
    )
}

function AudioAdvanced({ o, set, hasVideo }: { o: ConvertOptions; set: Set_; hasVideo: boolean }) {
    return (
        <Group title="Son">
            {hasVideo && (
                <Toggle checked={o.audioCopy} onChange={(v) => set({ audioCopy: v })} label="Garder la piste son d'origine"
                    description="Copie sans réencodage dans les vidéos (plus rapide)." />
            )}
            <Row label="Débit"><Select value={o.audioBitrate} onChange={(v) => set({ audioBitrate: v })} className="w-44" ariaLabel="Débit audio"
                options={opts(['64k', '64 kb/s'], ['96k', '96 kb/s'], ['128k', '128 kb/s'], ['160k', '160 kb/s'], ['192k', '192 kb/s'], ['256k', '256 kb/s'], ['320k', '320 kb/s'])} /></Row>
            <Row label="Fréquence"><Select value={o.audioSampleRate} onChange={(v) => set({ audioSampleRate: v })} className="w-44" ariaLabel="Fréquence d'échantillonnage"
                options={opts(['', 'Originale'], ['22050', '22,05 kHz'], ['44100', '44,1 kHz'], ['48000', '48 kHz'], ['96000', '96 kHz'])} /></Row>
            <Row label="Canaux"><Select value={o.audioChannels} onChange={(v) => set({ audioChannels: v })} className="w-44" ariaLabel="Canaux"
                options={opts(['', 'Originaux'], ['1', 'Mono'], ['2', 'Stéréo'])} /></Row>
            <Slider label="Volume" value={o.audioVolume} min={-20} max={20} step={0.5} onChange={(v) => set({ audioVolume: v })} format={(v) => `${v > 0 ? '+' : ''}${v} dB`} />
        </Group>
    )
}

function GifAdvanced({ o, set }: { o: ConvertOptions; set: Set_ }) {
    return (
        <Group title="GIF">
            <Slider label="Couleurs" value={o.gifColors} min={2} max={256} neutral={256} onChange={(v) => set({ gifColors: v })} format={(v) => String(v)} />
            <Row label="Tramage"><Select value={o.gifDither} onChange={(v) => set({ gifDither: v })} className="w-44" ariaLabel="Tramage"
                options={opts(['sierra2_4a', 'Sierra 2-4A'], ['floyd_steinberg', 'Floyd-Steinberg'], ['sierra2', 'Sierra 2'], ['sierra3', 'Sierra 3'], ['burkes', 'Burkes'], ['atkinson', 'Atkinson'], ['bayer', 'Bayer'], ['none', 'Aucun'])} /></Row>
            <Row label="Lecture"><Select value={o.gifLoop} onChange={(v) => set({ gifLoop: v })} className="w-44" ariaLabel="Boucle"
                options={opts(['0', 'En boucle'], ['-1', 'Une seule fois'], ['1', '2 fois'], ['2', '3 fois'])} /></Row>
        </Group>
    )
}

function ImageAdvanced({ o, set, targets }: { o: ConvertOptions; set: Set_; targets: string[] }) {
    return (
        <Group title="Images">
            <Segmented size="sm" value={o.imageResizeMode} onChange={(v) => set({ imageResizeMode: v })}
                options={[{ value: 'max', label: 'Taille max' }, { value: 'percent', label: 'Pourcentage' }]} />
            {o.imageResizeMode === 'percent' && (
                <Slider label="Échelle" value={o.imagePercent} min={5} max={300} step={5} neutral={100} onChange={(v) => set({ imagePercent: v })} format={(v) => `${v} %`} />
            )}
            <Row label="Poids visé (Mo)">
                <TextInput value={o.imageTargetMb} onChange={(v) => set({ imageTargetMb: v.replace(',', '.').replace(/[^\d.]/g, '') })} placeholder="désactivé" inputMode="decimal" ariaLabel="Poids visé des images en Mo" className="w-28" />
            </Row>
            {targets.includes('webp') && <Toggle checked={o.imageLossless} onChange={(v) => set({ imageLossless: v })} label="WebP sans perte" />}
            {targets.includes('ico') && (
                <Row label="Taille ICO"><Select value={o.icoSize} onChange={(v) => set({ icoSize: v })} className="w-44" ariaLabel="Taille ICO"
                    options={opts(['16', '16 px'], ['32', '32 px'], ['48', '48 px'], ['64', '64 px'], ['128', '128 px'], ['256', '256 px'])} /></Row>
            )}
            <Note>Lumière, couleurs et LUT des photos : onglet Color Lab.</Note>
        </Group>
    )
}
