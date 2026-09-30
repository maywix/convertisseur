import type { ReactNode } from 'react'
import { IconAudio, IconCrop, IconImage, IconSequence, IconSliders, IconVideo } from '@/components/icons'
import { Field, Section, Segmented, Select, Slider, TextInput, Toggle } from '@/components/ui'
import {
    SIMPLE_GIF_COLORS, codecFits,
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

function Grid({ children }: { children: ReactNode }) {
    return <div className="grid grid-cols-2 gap-2">{children}</div>
}

function Note({ children }: { children: ReactNode }) {
    return <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>
}

export function ConvertOptionsPanel({
    o, set, stats, kindFormats, setFormatForKind,
}: {
    o: ConvertOptions
    set: Set_
    stats: PanelStats
    kindFormats: Record<MediaKind, string>
    setFormatForKind: (kind: MediaKind, format: string) => void
}) {
    const hasVideo = stats.videoTargets.length > 0
    return (
        <>
            <div className="border-b border-border p-3">
                <Segmented
                    className="w-full"
                    value={o.advanced ? 'advanced' : 'simple'}
                    onChange={(v) => set({ advanced: v === 'advanced' })}
                    options={[
                        { value: 'simple', label: 'Simple' },
                        { value: 'advanced', label: 'Avancé', title: 'Tous les paramètres (codec, CRF, débit, recadrage…)' },
                    ]}
                />
            </div>

            <Section title="Formats de sortie" icon={<IconSliders size={15} />}>
                {stats.kinds.map((kind) => (
                    <Field key={kind} label={`${KIND_LABEL[kind]} →`}>
                        <Select
                            value={kindFormats[kind]}
                            options={FORMATS[kind]}
                            onChange={(v) => setFormatForKind(kind, v)}
                            className="w-full"
                            ariaLabel={`Format pour ${KIND_LABEL[kind]}`}
                        />
                    </Field>
                ))}
                <Note>Tu peux aussi changer le format fichier par fichier dans la liste.</Note>
            </Section>

            {hasVideo && (o.advanced
                ? <>
                    <VideoEncodingAdvanced o={o} set={set} targets={stats.videoTargets} />
                    <VideoPictureAdvanced o={o} set={set} />
                </>
                : <VideoSimple o={o} set={set} />)}
            {stats.gifs > 0 && <GifOptions o={o} set={set} />}
            {stats.zip && (
                <Section title="Vidéo → images" icon={<IconImage size={15} />}>
                    <Field label="Images extraites par seconde">
                        <Segmented value={o.frameFps} onChange={(v) => set({ frameFps: v })} className="w-full"
                            options={[{ value: '0.2', label: '1 / 5 s' }, { value: '1', label: '1' }, { value: '5', label: '5' }, { value: '10', label: '10' }]} />
                    </Field>
                </Section>
            )}
            {(stats.audioOut > 0 || hasVideo) && <AudioOptions o={o} set={set} hasVideo={hasVideo} />}
            {stats.images > 0 && <ImageOptions o={o} set={set} targets={stats.imageTargets} canSlideshow={stats.pendingImages >= 2} />}
            {(hasVideo || stats.gifs > 0 || stats.audioOut > 0) && (
                <Section title="Couper" defaultOpen={!!(o.trimStart || o.trimEnd)}>
                    <Grid>
                        <Field label="Début">
                            <TextInput value={o.trimStart} onChange={(v) => set({ trimStart: v })} placeholder="0:05" inputMode="decimal" ariaLabel="Début" />
                        </Field>
                        <Field label="Fin">
                            <TextInput value={o.trimEnd} onChange={(v) => set({ trimEnd: v })} placeholder="1:30" inputMode="decimal" ariaLabel="Fin" />
                        </Field>
                    </Grid>
                    <Note>En secondes ou en h:mm:ss. S'applique aux vidéos, GIF et sons.</Note>
                </Section>
            )}
        </>
    )
}

// ── Vidéo ────────────────────────────────────────────────

const MAX_HEIGHTS = opts(['', 'Originale'], ['4320', '8K (4320p)'], ['2160', '4K (2160p)'], ['1440', '1440p'], ['1080', '1080p'], ['720', '720p'], ['540', '540p'], ['480', '480p'], ['360', '360p'], ['240', '240p'])
const ROTATIONS = opts(['none', 'Aucune'], ['90', '90° →'], ['270', '90° ←'], ['180', '180°'], ['hflip', 'Miroir horizontal'], ['vflip', 'Miroir vertical'])

function VideoSimple({ o, set }: { o: ConvertOptions; set: Set_ }) {
    const simpleQuality = ['high', 'balanced', 'small', 'size'].includes(o.videoQuality) ? o.videoQuality : 'balanced'
    return (
        <Section title="Vidéo" icon={<IconVideo size={15} />}>
            <Field label="Qualité">
                <Segmented<VideoQuality>
                    value={simpleQuality}
                    onChange={(v) => set({ videoQuality: v })}
                    className="w-full"
                    size="sm"
                    options={[
                        { value: 'high', label: 'Haute', title: 'Fichier plus gros' },
                        { value: 'balanced', label: 'Équilibrée' },
                        { value: 'small', label: 'Légère', title: 'Fichier plus petit' },
                        { value: 'size', label: 'Taille cible' },
                    ]}
                />
            </Field>
            {simpleQuality === 'size' && <TargetSize o={o} set={set} />}
            <Grid>
                <Field label="Résolution max">
                    <Select value={o.videoMaxHeight} onChange={(v) => set({ videoMaxHeight: v })} className="w-full" ariaLabel="Résolution max" options={MAX_HEIGHTS.filter((m) => m.value !== '4320' && m.value !== '540' && m.value !== '240')} />
                </Field>
                <Field label="Images / s">
                    <Select value={['', '60', '30', '25', '24'].includes(o.videoFps) ? o.videoFps : ''} onChange={(v) => set({ videoFps: v })} className="w-full" ariaLabel="Images par seconde"
                        options={opts(['', 'Original'], ['60', '60'], ['30', '30'], ['25', '25'], ['24', '24'])} />
                </Field>
                <Field label="Codec">
                    <Select value={o.videoCodec === 'libx265' ? 'libx265' : 'libx264'} onChange={(v) => set({ videoCodec: v as VideoCodec })} className="w-full" ariaLabel="Codec"
                        options={opts(['libx264', 'H.264'], ['libx265', 'H.265 (léger)'])} />
                </Field>
                <Field label="Rotation">
                    <Select value={o.rotate === 'vflip' ? 'none' : o.rotate} onChange={(v) => set({ rotate: v as ConvertOptions['rotate'] })} className="w-full" ariaLabel="Rotation"
                        options={ROTATIONS.filter((r) => r.value !== 'vflip')} />
                </Field>
            </Grid>
            <Toggle checked={o.removeAudio} onChange={(v) => set({ removeAudio: v })} label="Supprimer le son" />
        </Section>
    )
}

function TargetSize({ o, set }: { o: ConvertOptions; set: Set_ }) {
    return (
        <Field label="Poids visé (Mo)" hint="ex. 10 ou 25 pour Discord">
            <TextInput value={o.videoTargetMb} onChange={(v) => set({ videoTargetMb: v.replace(',', '.') })} inputMode="decimal" ariaLabel="Poids visé en Mo" />
        </Field>
    )
}

const RATE_MODES = opts(
    ['high', 'Qualité haute (préréglage)'],
    ['balanced', 'Qualité équilibrée (préréglage)'],
    ['small', 'Qualité légère (préréglage)'],
    ['crf', 'CRF (qualité constante)'],
    ['bitrate', 'Débit fixe (kb/s)'],
    ['size', 'Taille cible (Mo)'],
)
const PRESETS = opts(['', 'Auto (rapide)'], ['ultrafast', 'ultrafast'], ['superfast', 'superfast'], ['veryfast', 'veryfast'], ['faster', 'faster'], ['fast', 'fast'], ['medium', 'medium'], ['slow', 'slow'], ['slower', 'slower'], ['veryslow', 'veryslow'])
const TUNES = opts(['none', 'Aucun'], ['film', 'Film'], ['animation', 'Animation'], ['grain', 'Grain'], ['stillimage', 'Image fixe'], ['fastdecode', 'Décodage rapide'], ['zerolatency', 'Faible latence'])
const CODECS = opts(['libx264', 'H.264 (AVC)'], ['libx265', 'H.265 (HEVC)'], ['libvpx-vp9', 'VP9'], ['libaom-av1', 'AV1 (lent)'])

function VideoEncodingAdvanced({ o, set, targets }: { o: ConvertOptions; set: Set_; targets: string[] }) {
    const x26x = o.videoCodec === 'libx264' || o.videoCodec === 'libx265'
    const misfits = targets.filter((t) => !codecFits(o.videoCodec, t))
    return (
        <Section title="Vidéo · encodage" icon={<IconVideo size={15} />}>
            <Field label="Codec">
                <Select value={o.videoCodec} onChange={(v) => set({ videoCodec: v as VideoCodec })} className="w-full" ariaLabel="Codec vidéo" options={CODECS} />
            </Field>
            {misfits.length > 0 && (
                <Note>Non compatible avec {misfits.map((t) => t.toUpperCase()).join(', ')} : le codec par défaut du format sera utilisé pour ceux-là.</Note>
            )}
            <Field label="Contrôle de la qualité">
                <Select value={o.videoQuality} onChange={(v) => set({ videoQuality: v as VideoQuality })} className="w-full" ariaLabel="Contrôle de la qualité" options={RATE_MODES} />
            </Field>
            {o.videoQuality === 'crf' && (
                <>
                    <Slider label="CRF" value={o.videoCrf} min={0} max={51} neutral={23} onChange={(v) => set({ videoCrf: v })} format={(v) => String(v)} />
                    <Note>Plus bas = meilleure qualité et fichier plus gros. H.264 : 18 quasi sans perte, 23 standard, 28 léger. VP9 / AV1 : ajoute ~10.</Note>
                </>
            )}
            {o.videoQuality === 'bitrate' && (
                <>
                    <Field label="Débit vidéo (kb/s)" hint="ex. 2500 en 720p, 6000 en 1080p">
                        <TextInput value={o.videoBitrateK} onChange={(v) => set({ videoBitrateK: v.replace(/[^\d]/g, '') })} inputMode="numeric" ariaLabel="Débit vidéo en kb/s" />
                    </Field>
                    <Toggle checked={o.twoPass} onChange={(v) => set({ twoPass: v })} label="Encodage en 2 passes" description="Débit plus précis, deux fois plus long (H.264)." />
                </>
            )}
            {o.videoQuality === 'size' && <TargetSize o={o} set={set} />}
            {x26x && (
                <Grid>
                    <Field label="Preset">
                        <Select value={o.videoPreset} onChange={(v) => set({ videoPreset: v })} className="w-full" ariaLabel="Preset d'encodage" options={PRESETS} />
                    </Field>
                    <Field label="Tune">
                        <Select value={o.videoTune} onChange={(v) => set({ videoTune: v })} className="w-full" ariaLabel="Tune" options={TUNES} />
                    </Field>
                    {o.videoCodec === 'libx264' && (
                        <Field label="Profil H.264">
                            <Select value={o.videoProfile} onChange={(v) => set({ videoProfile: v as ConvertOptions['videoProfile'] })} className="w-full" ariaLabel="Profil"
                                options={opts(['auto', 'Auto'], ['high', 'High'], ['main', 'Main'], ['baseline', 'Baseline'])} />
                        </Field>
                    )}
                    <Field label="Pixels">
                        <Select value={o.pixelFormat} onChange={(v) => set({ pixelFormat: v as ConvertOptions['pixelFormat'] })} className="w-full" ariaLabel="Format de pixels"
                            options={opts(['auto', 'Auto (4:2:0)'], ['yuv420p10le', '10 bits'], ['yuv422p', '4:2:2'], ['yuv444p', '4:4:4'])} />
                    </Field>
                </Grid>
            )}
            {o.pixelFormat !== 'auto' && o.pixelFormat !== 'yuv420p' && (
                <Note>Attention : en 10 bits, 4:2:2 ou 4:4:4, beaucoup de lecteurs (navigateurs, iPhone, Windows) ne liront pas la vidéo.</Note>
            )}
        </Section>
    )
}

const TEXT_POSITIONS = opts(['bottom', 'En bas, centré'], ['top', 'En haut, centré'], ['center', 'Au centre'], ['bottom-left', 'En bas à gauche'], ['bottom-right', 'En bas à droite'], ['top-left', 'En haut à gauche'], ['top-right', 'En haut à droite'])

function VideoPictureAdvanced({ o, set }: { o: ConvertOptions; set: Set_ }) {
    return (
        <Section title="Vidéo · image" icon={<IconCrop size={15} />}>
            <Field label="Redimensionner">
                <Segmented size="sm" className="w-full" value={o.resizeMode} onChange={(v) => set({ resizeMode: v })}
                    options={[{ value: 'max', label: 'Hauteur max' }, { value: 'exact', label: 'Taille exacte' }]} />
            </Field>
            {o.resizeMode === 'max' ? (
                <Select value={o.videoMaxHeight} onChange={(v) => set({ videoMaxHeight: v })} className="w-full" ariaLabel="Hauteur maximale" options={MAX_HEIGHTS} />
            ) : (
                <>
                    <Grid>
                        <Field label="Largeur (px)">
                            <TextInput value={o.resizeWidth} onChange={(v) => set({ resizeWidth: v.replace(/[^\d]/g, '') })} placeholder="auto" inputMode="numeric" ariaLabel="Largeur" />
                        </Field>
                        <Field label="Hauteur (px)">
                            <TextInput value={o.resizeHeight} onChange={(v) => set({ resizeHeight: v.replace(/[^\d]/g, '') })} placeholder="auto" inputMode="numeric" ariaLabel="Hauteur" />
                        </Field>
                    </Grid>
                    <Note>Un seul champ rempli = proportions gardées.</Note>
                </>
            )}
            <Grid>
                <Field label="Images / s">
                    <TextInput value={o.videoFps} onChange={(v) => set({ videoFps: v.replace(',', '.').replace(/[^\d.]/g, '') })} placeholder="Original" inputMode="decimal" ariaLabel="Images par seconde" />
                </Field>
                <Field label="Rotation">
                    <Select value={o.rotate} onChange={(v) => set({ rotate: v as ConvertOptions['rotate'] })} className="w-full" ariaLabel="Rotation" options={ROTATIONS} />
                </Field>
            </Grid>
            <Field label="Recadrer (px retirés)">
                <div className="grid grid-cols-4 gap-1.5">
                    {([['cropTop', 'Haut'], ['cropBottom', 'Bas'], ['cropLeft', 'Gauche'], ['cropRight', 'Droite']] as const).map(([key, label]) => (
                        <TextInput key={key} value={o[key]} onChange={(v) => set({ [key]: v.replace(/[^\d]/g, '') } as Partial<ConvertOptions>)} placeholder={label} inputMode="numeric" ariaLabel={`Recadrer ${label}`} className="px-2 text-xs" />
                    ))}
                </div>
            </Field>
            <Grid>
                <Field label="Débruitage">
                    <Select value={o.denoise} onChange={(v) => set({ denoise: v as ConvertOptions['denoise'] })} className="w-full" ariaLabel="Débruitage"
                        options={opts(['none', 'Aucun'], ['light', 'Léger'], ['medium', 'Moyen'], ['strong', 'Fort'])} />
                </Field>
                <Field label="HDR → SDR">
                    <Select value={o.hdr} onChange={(v) => set({ hdr: v as ConvertOptions['hdr'] })} className="w-full" ariaLabel="HDR vers SDR"
                        options={opts(['auto', 'Auto'], ['off', 'Désactivé'])} />
                </Field>
            </Grid>
            <Toggle checked={o.deinterlace} onChange={(v) => set({ deinterlace: v })} label="Désentrelacer" description="Pour les vidéos TV / caméscope (1080i, 576i)." />
            <Toggle checked={o.removeAudio} onChange={(v) => set({ removeAudio: v })} label="Supprimer le son" />
            <Field label="Texte incrusté">
                <TextInput value={o.overlayText} onChange={(v) => set({ overlayText: v })} placeholder="Optionnel" ariaLabel="Texte incrusté" />
            </Field>
            {o.overlayText.trim() && (
                <Select value={o.overlayPosition} onChange={(v) => set({ overlayPosition: v as TextPosition })} className="w-full" ariaLabel="Position du texte" options={TEXT_POSITIONS} />
            )}
        </Section>
    )
}

// ── GIF ──────────────────────────────────────────────────

function GifOptions({ o, set }: { o: ConvertOptions; set: Set_ }) {
    const widths = o.advanced
        ? opts(['240', '240 px'], ['320', '320 px'], ['480', '480 px'], ['640', '640 px'], ['800', '800 px'], ['1080', '1080 px'], ['0', 'Originale'])
        : opts(['320', '320 px'], ['480', '480 px'], ['640', '640 px'], ['800', '800 px'], ['0', 'Originale'])
    const fps = o.advanced
        ? opts(['5', '5'], ['8', '8'], ['10', '10'], ['12', '12'], ['15', '15'], ['20', '20'], ['24', '24'], ['25', '25'], ['30', '30'])
        : opts(['10', '10'], ['15', '15'], ['20', '20'], ['25', '25'])
    return (
        <Section title="GIF" icon={<IconSequence size={15} />}>
            <Grid>
                <Field label="Largeur">
                    <Select value={o.gifWidth} onChange={(v) => set({ gifWidth: v })} className="w-full" ariaLabel="Largeur du GIF" options={widths} />
                </Field>
                <Field label="Images / s">
                    <Select value={o.gifFps} onChange={(v) => set({ gifFps: v })} className="w-full" ariaLabel="Images par seconde du GIF" options={fps} />
                </Field>
                <Field label="Vitesse">
                    <Select value={o.gifSpeed} onChange={(v) => set({ gifSpeed: v })} className="w-full" ariaLabel="Vitesse du GIF"
                        options={opts(['0.25', '× 0,25'], ['0.5', '× 0,5'], ['0.75', '× 0,75'], ['1', '× 1'], ['1.5', '× 1,5'], ['2', '× 2'], ['3', '× 3'], ['4', '× 4'])} />
                </Field>
                {!o.advanced && (
                    <Field label="Couleurs">
                        <Select value={String(SIMPLE_GIF_COLORS.includes(o.gifColors) ? o.gifColors : 256)} onChange={(v) => set({ gifColors: parseInt(v, 10) })} className="w-full" ariaLabel="Couleurs du GIF"
                            options={opts(['64', '64 · léger'], ['128', '128'], ['256', '256 · fidèle'])} />
                    </Field>
                )}
                {o.advanced && (
                    <Field label="Lecture">
                        <Select value={o.gifLoop} onChange={(v) => set({ gifLoop: v })} className="w-full" ariaLabel="Boucle"
                            options={opts(['0', 'En boucle'], ['-1', 'Une seule fois'], ['1', '2 fois'], ['2', '3 fois'])} />
                    </Field>
                )}
            </Grid>
            {o.advanced && (
                <>
                    <Slider label="Couleurs" value={o.gifColors} min={2} max={256} neutral={256} onChange={(v) => set({ gifColors: v })} format={(v) => String(v)} />
                    <Field label="Tramage (dithering)">
                        <Select value={o.gifDither} onChange={(v) => set({ gifDither: v })} className="w-full" ariaLabel="Tramage"
                            options={opts(['sierra2_4a', 'Sierra 2-4A (défaut)'], ['floyd_steinberg', 'Floyd-Steinberg'], ['sierra2', 'Sierra 2'], ['sierra3', 'Sierra 3'], ['burkes', 'Burkes'], ['atkinson', 'Atkinson'], ['bayer', 'Bayer (motif régulier)'], ['none', 'Aucun (aplats)'])} />
                    </Field>
                </>
            )}
        </Section>
    )
}

// ── Son ──────────────────────────────────────────────────

function AudioOptions({ o, set, hasVideo }: { o: ConvertOptions; set: Set_; hasVideo: boolean }) {
    if (!o.advanced) {
        return (
            <Section key="simple" title="Son" icon={<IconAudio size={15} />} defaultOpen={false}>
                <Field label="Débit (formats compressés)">
                    <Segmented value={['128k', '192k', '256k', '320k'].includes(o.audioBitrate) ? o.audioBitrate : '192k'} onChange={(v) => set({ audioBitrate: v })} className="w-full" size="sm"
                        options={[{ value: '128k', label: '128k' }, { value: '192k', label: '192k' }, { value: '256k', label: '256k' }, { value: '320k', label: '320k' }]} />
                </Field>
                <Toggle checked={o.audioNormalize} onChange={(v) => set({ audioNormalize: v })} label="Normaliser le volume" description="Niveau sonore homogène (EBU R128)" />
            </Section>
        )
    }
    const reencode = !(hasVideo && o.audioCopy)
    return (
        <Section key="advanced" title="Son" icon={<IconAudio size={15} />}>
            {hasVideo && (
                <Toggle checked={o.audioCopy} onChange={(v) => set({ audioCopy: v })} label="Garder la piste son d'origine"
                    description="Copie sans réencodage dans les vidéos (plus rapide, qualité intacte). Doit être compatible avec le conteneur." />
            )}
            {reencode && (
                <>
                    <Grid>
                        <Field label="Débit">
                            <Select value={o.audioBitrate} onChange={(v) => set({ audioBitrate: v })} className="w-full" ariaLabel="Débit audio"
                                options={opts(['64k', '64 kb/s'], ['96k', '96 kb/s'], ['128k', '128 kb/s'], ['160k', '160 kb/s'], ['192k', '192 kb/s'], ['256k', '256 kb/s'], ['320k', '320 kb/s'])} />
                        </Field>
                        <Field label="Fréquence">
                            <Select value={o.audioSampleRate} onChange={(v) => set({ audioSampleRate: v })} className="w-full" ariaLabel="Fréquence d'échantillonnage"
                                options={opts(['', 'Originale'], ['22050', '22,05 kHz'], ['44100', '44,1 kHz'], ['48000', '48 kHz'], ['96000', '96 kHz'])} />
                        </Field>
                        <Field label="Canaux">
                            <Select value={o.audioChannels} onChange={(v) => set({ audioChannels: v })} className="w-full" ariaLabel="Canaux"
                                options={opts(['', 'Originaux'], ['1', 'Mono'], ['2', 'Stéréo'])} />
                        </Field>
                    </Grid>
                    <Slider label="Volume" value={o.audioVolume} min={-20} max={20} step={0.5} onChange={(v) => set({ audioVolume: v })}
                        format={(v) => `${v > 0 ? '+' : ''}${v} dB`} />
                    <Toggle checked={o.audioNormalize} onChange={(v) => set({ audioNormalize: v })} label="Normaliser le volume" description="Niveau sonore homogène (EBU R128)" />
                    <Note>Le débit ne s'applique pas aux formats sans perte (WAV, FLAC, AIFF).</Note>
                </>
            )}
        </Section>
    )
}

// ── Images ───────────────────────────────────────────────

function ImageOptions({ o, set, targets, canSlideshow }: { o: ConvertOptions; set: Set_; targets: string[]; canSlideshow: boolean }) {
    return (
        <Section title="Images" icon={<IconImage size={15} />}>
            <Slider label="Qualité (JPG, WebP, AVIF)" value={o.imageQuality} min={10} max={100} step={1} neutral={90}
                onChange={(v) => set({ imageQuality: v })} format={(v) => `${v} %`} />
            {o.advanced && (
                <Field label="Redimensionner">
                    <Segmented size="sm" className="w-full" value={o.imageResizeMode} onChange={(v) => set({ imageResizeMode: v })}
                        options={[{ value: 'max', label: 'Taille max' }, { value: 'percent', label: 'Pourcentage' }]} />
                </Field>
            )}
            {o.advanced && o.imageResizeMode === 'percent' ? (
                <Slider label="Échelle" value={o.imagePercent} min={5} max={300} step={5} neutral={100} onChange={(v) => set({ imagePercent: v })} format={(v) => `${v} %`} />
            ) : (
                <Grid>
                    <Field label="Taille max">
                        <Select value={o.imageMaxSize} onChange={(v) => set({ imageMaxSize: v })} className="w-full" ariaLabel="Taille maximale"
                            options={opts(['', 'Originale'], ['3840', '3840 px'], ['2560', '2560 px'], ['1920', '1920 px'], ['1280', '1280 px'], ['1080', '1080 px'], ['800', '800 px'], ['512', '512 px'], ['256', '256 px'])} />
                    </Field>
                    <Field label="Agrandir">
                        <Select value={o.imageUpscale} onChange={(v) => set({ imageUpscale: v })} className="w-full" ariaLabel="Agrandir"
                            options={opts(['1', 'Non'], ['2', '× 2'], ['3', '× 3'], ['4', '× 4'])} />
                    </Field>
                </Grid>
            )}
            {o.advanced && (
                <>
                    <Field label="Poids visé (Mo)" hint="JPG, PNG, WebP · vide = désactivé">
                        <TextInput value={o.imageTargetMb} onChange={(v) => set({ imageTargetMb: v.replace(',', '.').replace(/[^\d.]/g, '') })} placeholder="ex. 1" inputMode="decimal" ariaLabel="Poids visé des images en Mo" />
                    </Field>
                    {targets.includes('webp') && (
                        <Toggle checked={o.imageLossless} onChange={(v) => set({ imageLossless: v })} label="WebP sans perte" />
                    )}
                    {targets.includes('ico') && (
                        <Field label="Taille de l'icône">
                            <Select value={o.icoSize} onChange={(v) => set({ icoSize: v })} className="w-full" ariaLabel="Taille ICO"
                                options={opts(['16', '16 px'], ['32', '32 px'], ['48', '48 px'], ['64', '64 px'], ['128', '128 px'], ['256', '256 px'])} />
                        </Field>
                    )}
                    <Note>Pour étalonner les photos (lumière, couleurs, LUT), passe par le Color Lab.</Note>
                </>
            )}
            {canSlideshow && (
                <div className="rounded-xl border border-border bg-muted/40 p-3">
                    <Toggle checked={o.slideshow} onChange={(v) => set({ slideshow: v })} label="Assembler en une vidéo" description="Les images en attente deviennent un diaporama (ordre alphabétique)." />
                    {o.slideshow && (
                        <div className="mt-3">
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
                        </div>
                    )}
                </div>
            )}
        </Section>
    )
}
