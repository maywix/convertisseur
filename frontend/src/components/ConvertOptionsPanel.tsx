import type { ReactNode } from 'react'
import { IconAudio, IconCube, IconDocument, IconImage, IconSequence, IconVideo } from '@/components/icons'
import { Select, TextInput, type SelectOption } from '@/components/ui'
import {
    codecFits,
    type Action, type Category, type CompressLevel, type CompressMode, type ConvertOptions, type GroupKey,
    type Rotate, type TextPosition, type VideoCodec, type VideoQuality,
} from '@/lib/convertPlan'
import { cn } from '@/lib/utils'
import type { FormatOption } from '@/types'

type Set_ = (p: Partial<ConvertOptions>) => void

const opts = (...values: [string, string][]): SelectOption[] => values.map(([value, label]) => ({ value, label }))

/** Keeps a custom value (set before, or restored) selectable. */
function withCurrent(options: SelectOption[], value: string, label = value): SelectOption[] {
    return options.some((o) => o.value === value) ? options : [...options, { value, label }]
}

// ── Layout pieces ────────────────────────────────────────

/** Numbered step title ("1 · ACTION"). */
export function StepTitle({ n, children, aside }: { n: number; children: ReactNode; aside?: ReactNode }) {
    return (
        <div className="mb-3 flex items-center gap-2.5">
            <span className="flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full border border-input text-[10px] font-bold text-foreground tabular-nums">{n}</span>
            <span className="text-[10px] font-bold tracking-[0.1em] text-muted-foreground uppercase">{children}</span>
            {aside && <span className="ml-auto text-[11px] text-faint">{aside}</span>}
        </div>
    )
}

function Grid({ children }: { children: ReactNode }) {
    return <div className="grid grid-cols-2 gap-x-2.5 gap-y-3.5">{children}</div>
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
    return <p className="mt-2.5 text-[11px] leading-relaxed text-faint">{children}</p>
}

/** Output format for one kind of file, as a dropdown. */
export function FormatSelect({ value, options, onChange, label }: { value: string; options: FormatOption[]; onChange: (v: string) => void; label: string }) {
    return <Pick label={label} value={value} options={options} onChange={onChange} />
}

// ── Steps ────────────────────────────────────────────────

const ACTIONS: [Action, string][] = [['convert', 'Convertir'], ['compress', 'Compresser'], ['convert_compress', 'Convertir + compresser']]

export function ActionPicker({ value, onChange }: { value: Action; onChange: (a: Action) => void }) {
    return (
        <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Action">
            {ACTIONS.map(([v, label]) => (
                <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={value === v}
                    onClick={() => onChange(v)}
                    className={cn(
                        'min-h-11 rounded-[4px] border px-2 py-1.5 text-[12px] leading-tight font-semibold transition-colors',
                        value === v ? 'border-primary bg-primary text-primary-foreground' : 'border-input text-muted-foreground hover:border-faint hover:text-foreground',
                    )}
                >
                    {label}
                </button>
            ))}
        </div>
    )
}

const CATEGORIES: { value: Category; label: string; icon: ReactNode }[] = [
    { value: 'video', label: 'Vidéo', icon: <IconVideo size={16} /> },
    { value: 'audio', label: 'Audio', icon: <IconAudio size={16} /> },
    { value: 'image', label: 'Image', icon: <IconImage size={16} /> },
    { value: 'slideshow', label: 'Images → Vidéo', icon: <IconSequence size={16} /> },
    { value: 'document', label: 'Document Office', icon: <IconDocument size={16} /> },
    { value: '3d', label: 'Modèle 3D', icon: <IconCube size={16} /> },
]

export function CategoryPicker({ value, counts, onChange }: { value: Category | null; counts: Partial<Record<Category, number>>; onChange: (c: Category) => void }) {
    return (
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Type de média">
            {CATEGORIES.map((c) => {
                const active = value === c.value
                const n = counts[c.value] ?? 0
                return (
                    <button
                        key={c.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => onChange(c.value)}
                        className={cn(
                            'flex min-w-0 items-center gap-2.5 rounded-[4px] border px-3 py-2.5 text-left text-[13px] transition-colors',
                            active ? 'border-foreground bg-foreground/[0.06] font-semibold text-foreground' : 'border-border text-muted-foreground hover:border-input hover:text-foreground',
                        )}
                    >
                        <span className={cn('shrink-0', active ? 'text-foreground' : 'text-faint')}>{c.icon}</span>
                        <span className="min-w-0 flex-1 truncate">{c.label}</span>
                        {n > 0 && <span className="text-[11px] font-normal text-faint tabular-nums">{n}</span>}
                    </button>
                )
            })}
        </div>
    )
}

export function FormatChips({ formats, value, onChange }: { formats: FormatOption[]; value: string; onChange: (f: string) => void }) {
    return (
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Format de sortie">
            {formats.map((f) => (
                <button
                    key={f.value}
                    type="button"
                    role="radio"
                    aria-checked={value === f.value}
                    onClick={() => onChange(f.value)}
                    className={cn(
                        'h-8 min-w-[52px] rounded-[3px] border px-2.5 text-[12px] font-semibold transition-colors',
                        value === f.value ? 'border-primary bg-primary text-primary-foreground' : 'border-input text-muted-foreground hover:border-faint hover:text-foreground',
                    )}
                >
                    {f.label}
                </button>
            ))}
        </div>
    )
}

const COMPRESS_MODES = opts(['level', 'Niveau'], ['size', 'Poids cible (Mo)'], ['percent', 'Réduire de … %'])
const COMPRESS_LEVELS = opts(['low', 'Légère'], ['medium', 'Moyenne'], ['high', 'Forte'])
const PERCENTS = [10, 20, 30, 40, 50, 60, 70, 80, 90].map((n) => ({ value: String(n), label: `− ${n} %` }))

export function CompressFields({ o, set }: { o: ConvertOptions; set: Set_ }) {
    return (
        <>
            <Grid>
                <Pick label="Objectif" value={o.compressMode} options={COMPRESS_MODES} onChange={(v) => set({ compressMode: v as CompressMode })} />
                {o.compressMode === 'level' && (
                    <Pick label="Niveau" value={o.compressLevel} options={COMPRESS_LEVELS} onChange={(v) => set({ compressLevel: v as CompressLevel })} />
                )}
                {o.compressMode === 'size' && (
                    <TextField label="Poids visé (Mo)" value={o.compressTargetMb} onChange={(v) => set({ compressTargetMb: decimal(v) })} inputMode="decimal" placeholder="25" />
                )}
                {o.compressMode === 'percent' && (
                    <Pick label="Réduction" value={String(o.compressPercent)} options={withCurrent(PERCENTS, String(o.compressPercent), `− ${o.compressPercent} %`)}
                        onChange={(v) => set({ compressPercent: parseInt(v, 10) })} />
                )}
            </Grid>
            <Note>
                {o.compressMode === 'size'
                    ? 'Par fichier. Pratique pour Discord (10 ou 25 Mo). Un fichier déjà plus léger est gardé tel quel.'
                    : o.compressMode === 'percent'
                        ? 'Poids visé par rapport au fichier d’origine.'
                        : `${{ low: 'Légère : qualité presque intacte.', medium: 'Moyenne : bon compromis.', high: 'Forte : fichier le plus petit, qualité en baisse.' }[o.compressLevel]} Vidéos, sons, images et PDF ; les documents et modèles 3D sont simplement convertis.`}
            </Note>
        </>
    )
}

// ── Option groups ────────────────────────────────────────

const QUALITIES = opts(['high', 'Haute'], ['balanced', 'Équilibrée'], ['small', 'Légère'], ['crf', 'CRF (qualité constante)'], ['bitrate', 'Débit fixe (kb/s)'])
const RESOLUTIONS = opts(
    ['', 'Originale'], ['4320', '4320p (8K)'], ['2160', '2160p (4K)'], ['1440', '1440p'], ['1080', '1080p (Full HD)'],
    ['720', '720p (HD)'], ['540', '540p'], ['480', '480p'], ['360', '360p'], ['240', '240p'],
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
const SLIDESHOW_FPS = opts(['0.5', '1 image toutes les 2 s'], ['1', '1 image par seconde'], ['2', '2 par seconde'], ['5', '5 par seconde'], ['12', '12 par seconde'], ['24', '24 par seconde'])

const AUDIO_BITRATES = opts(['64k', '64 kb/s'], ['96k', '96 kb/s'], ['128k', '128 kb/s'], ['160k', '160 kb/s'], ['192k', '192 kb/s'], ['256k', '256 kb/s'], ['320k', '320 kb/s'])
const SAMPLE_RATES = opts(['', 'Originale'], ['22050', '22,05 kHz'], ['44100', '44,1 kHz'], ['48000', '48 kHz'], ['96000', '96 kHz'])
const CHANNELS = opts(['', 'Originaux'], ['1', 'Mono'], ['2', 'Stéréo'])
const VOLUMES = opts(['norm', 'Normaliser (EBU R128)'], ['0', 'Inchangé'], ['-10', '− 10 dB'], ['-6', '− 6 dB'], ['-3', '− 3 dB'], ['3', '+ 3 dB'], ['6', '+ 6 dB'], ['10', '+ 10 dB'])
const SPEEDS = opts(['0.25', '× 0,25 (ralenti)'], ['0.5', '× 0,5'], ['0.75', '× 0,75'], ['1', 'Normale'], ['1.25', '× 1,25'], ['1.5', '× 1,5'], ['2', '× 2'], ['3', '× 3'], ['4', '× 4 (accéléré)'])
const ASPECTS = opts(['', 'Original'], ['16:9', '16:9 · paysage'], ['9:16', '9:16 · Reels / TikTok'], ['1:1', '1:1 · carré'], ['4:5', '4:5 · Instagram'], ['4:3', '4:3'], ['3:4', '3:4'], ['21:9', '21:9 · cinéma'])
const FRAME_FPS = opts(['0.2', '1 toutes les 5 s'], ['0.5', '1 toutes les 2 s'], ['1', '1 par seconde'], ['5', '5 par seconde'], ['10', '10 par seconde'], ['24', '24 par seconde'], ['30', '30 par seconde'])

const digits = (v: string) => v.replace(/[^\d]/g, '')
const decimal = (v: string) => v.replace(',', '.').replace(/[^\d.]/g, '')

const GROUP_TITLES: Record<GroupKey, string> = {
    video: 'Vidéo', gif: 'GIF animé', frames: 'Images extraites', capture: 'Capture', image: 'Images', audio: 'Son',
    slideshow: 'Diaporama', trim: 'Découper', timing: 'Découper et vitesse',
}

function Group({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
    return (
        <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-2">
                <h4 className="text-[13px] font-bold">{title}</h4>
                {aside && <span className="truncate text-[11px] text-faint">{aside}</span>}
            </div>
            {children}
        </section>
    )
}

function SubTitle({ children }: { children: ReactNode }) {
    return <p className="pt-1 text-[11px] text-faint">{children}</p>
}

/**
 * Every option of the chosen output type, as dropdowns. While compressing,
 * the quality settings give way to the compression target.
 */
export function OptionGroups({
    o, set, groups, compressing, videoTargets = [], imageTargets = [],
}: {
    o: ConvertOptions
    set: Set_
    groups: GroupKey[]
    compressing: boolean
    videoTargets?: string[]
    imageTargets?: string[]
}) {
    const audioTrack = o.removeAudio ? 'remove' : o.audioCopy ? 'copy' : 'encode'
    const misfits = videoTargets.filter((t) => !codecFits(o.videoCodec, t))
    const imageSize = o.imageResizeMode === 'percent' ? `%${o.imagePercent}` : o.imageMaxSize

    const render: Record<GroupKey, () => ReactNode> = {
        video: () => (
            <Group title={GROUP_TITLES.video}>
                <Grid>
                    {!compressing && (
                        <Pick label="Qualité" value={o.videoQuality} options={withCurrent(QUALITIES, o.videoQuality)}
                            onChange={(v) => set({ videoQuality: v as VideoQuality })} />
                    )}
                    {!compressing && o.videoQuality === 'crf' && (
                        <Pick label="CRF" value={String(o.videoCrf)} options={withCurrent(CRFS, String(o.videoCrf))} onChange={(v) => set({ videoCrf: parseInt(v, 10) })} />
                    )}
                    {!compressing && o.videoQuality === 'bitrate' && (
                        <>
                            <TextField label="Débit (kb/s)" value={o.videoBitrateK} onChange={(v) => set({ videoBitrateK: digits(v) })} inputMode="numeric" placeholder="4000" />
                            <Pick label="Passes" value={o.twoPass ? '1' : '0'} options={opts(['0', '1 passe'], ['1', '2 passes'])} onChange={(v) => set({ twoPass: v === '1' })} />
                        </>
                    )}
                    <Pick label="Résolution max" value={o.resizeMode === 'exact' ? 'exact' : o.videoMaxHeight}
                        options={withCurrent([...RESOLUTIONS, { value: 'exact', label: 'Taille exacte…' }], o.videoMaxHeight, `${o.videoMaxHeight}p`)}
                        onChange={(v) => set(v === 'exact' ? { resizeMode: 'exact' } : { resizeMode: 'max', videoMaxHeight: v })} />
                    {o.resizeMode === 'exact' && (
                        <>
                            <TextField label="Largeur (px)" value={o.resizeWidth} onChange={(v) => set({ resizeWidth: digits(v) })} inputMode="numeric" placeholder="auto" />
                            <TextField label="Hauteur (px)" value={o.resizeHeight} onChange={(v) => set({ resizeHeight: digits(v) })} inputMode="numeric" placeholder="auto" />
                        </>
                    )}
                    <Pick label="Piste son" value={audioTrack} options={AUDIO_TRACK} onChange={(v) => set({ removeAudio: v === 'remove', audioCopy: v === 'copy' })} />
                    <Pick label="Codec" value={o.videoCodec} options={CODECS} onChange={(v) => set({ videoCodec: v as VideoCodec })} />
                    <Pick label="Images / s" value={o.videoFps} options={withCurrent(VIDEO_FPS, o.videoFps)} onChange={(v) => set({ videoFps: v })} />
                    <Pick label="Rotation" value={o.rotate} options={ROTATIONS} onChange={(v) => set({ rotate: v as Rotate })} />
                    <Pick label="Format d'image" value={o.aspect} options={withCurrent(ASPECTS, o.aspect)} onChange={(v) => set({ aspect: v })} wide />
                </Grid>
                {o.aspect && <Note>Recadrage au centre : les bords qui dépassent sont coupés.</Note>}
                <SubTitle>Encodage</SubTitle>
                <Grid>
                    <Pick label="Preset" value={o.videoPreset} options={PRESETS} onChange={(v) => set({ videoPreset: v })} />
                    <Pick label="Tune" value={o.videoTune} options={TUNES} onChange={(v) => set({ videoTune: v })} />
                    {o.videoCodec === 'libx264' && (
                        <Pick label="Profil" value={o.videoProfile} options={PROFILES} onChange={(v) => set({ videoProfile: v as ConvertOptions['videoProfile'] })} />
                    )}
                    <Pick label="Pixels" value={o.pixelFormat} options={withCurrent(PIXELS, o.pixelFormat)} onChange={(v) => set({ pixelFormat: v as ConvertOptions['pixelFormat'] })} />
                </Grid>
                <SubTitle>Image</SubTitle>
                <Grid>
                    <Pick label="Débruitage" value={o.denoise} options={DENOISE} onChange={(v) => set({ denoise: v as ConvertOptions['denoise'] })} />
                    <Pick label="HDR → SDR" value={o.hdr} options={HDR} onChange={(v) => set({ hdr: v as ConvertOptions['hdr'] })} />
                    <Pick label="Désentrelacer" value={o.deinterlace ? '1' : '0'} options={YES_NO} onChange={(v) => set({ deinterlace: v === '1' })} />
                </Grid>
                <SubTitle>Rogner (pixels retirés)</SubTitle>
                <div className="grid grid-cols-4 gap-1.5">
                    {([['cropTop', 'Haut'], ['cropBottom', 'Bas'], ['cropLeft', 'Gauche'], ['cropRight', 'Droite']] as const).map(([key, label]) => (
                        <TextInput key={key} value={o[key]} onChange={(v) => set({ [key]: digits(v) } as Partial<ConvertOptions>)} placeholder={label} inputMode="numeric" ariaLabel={`Rogner ${label}`} className="px-2 text-xs" />
                    ))}
                </div>
                <Grid>
                    <TextField label="Texte incrusté" value={o.overlayText} onChange={(v) => set({ overlayText: v })} placeholder="Optionnel" wide />
                    {o.overlayText.trim() && (
                        <Pick label="Position du texte" value={o.overlayPosition} options={TEXT_POSITIONS} onChange={(v) => set({ overlayPosition: v as TextPosition })} wide />
                    )}
                </Grid>
                {o.pixelFormat !== 'auto' && o.pixelFormat !== 'yuv420p' && (
                    <Note>En 10 bits, 4:2:2 ou 4:4:4, beaucoup de lecteurs (navigateurs, iPhone, Windows) ne liront pas la vidéo.</Note>
                )}
                {misfits.length > 0 && (
                    <Note>{CODECS.find((c) => c.value === o.videoCodec)?.label} ne va pas dans {misfits.map((t) => t.toUpperCase()).join(', ')} : le codec habituel du format sera utilisé.</Note>
                )}
            </Group>
        ),
        gif: () => (
            <Group title={GROUP_TITLES.gif}>
                <Grid>
                    <Pick label="Largeur" value={o.gifWidth} options={withCurrent(GIF_WIDTHS, o.gifWidth, `${o.gifWidth} px`)} onChange={(v) => set({ gifWidth: v })} />
                    <Pick label="Images / s" value={o.gifFps} options={withCurrent(GIF_FPS, o.gifFps)} onChange={(v) => set({ gifFps: v })} />
                    <Pick label="Vitesse" value={o.gifSpeed} options={withCurrent(GIF_SPEEDS, o.gifSpeed)} onChange={(v) => set({ gifSpeed: v })} />
                    <Pick label="Lecture" value={o.gifLoop} options={withCurrent(GIF_LOOP, o.gifLoop)} onChange={(v) => set({ gifLoop: v })} />
                    <Pick label="Couleurs" value={String(o.gifColors)} options={withCurrent(GIF_COLORS, String(o.gifColors))} onChange={(v) => set({ gifColors: parseInt(v, 10) })} />
                    <Pick label="Tramage" value={o.gifDither} options={GIF_DITHER} onChange={(v) => set({ gifDither: v })} />
                    <Pick label="Format d'image" value={o.aspect} options={withCurrent(ASPECTS, o.aspect)} onChange={(v) => set({ aspect: v })} wide />
                </Grid>
            </Group>
        ),
        frames: () => (
            <Group title={GROUP_TITLES.frames}>
                <Grid>
                    <Pick label="Fréquence" value={o.frameFps} options={withCurrent(FRAME_FPS, o.frameFps)} onChange={(v) => set({ frameFps: v })} wide />
                </Grid>
                <Note>La vidéo devient une suite d’images PNG, dans un ZIP.</Note>
            </Group>
        ),
        capture: () => (
            <Group title={GROUP_TITLES.capture}>
                <Grid>
                    <TextField label="Instant" value={o.captureAt} onChange={(v) => set({ captureAt: v })} placeholder="auto" inputMode="decimal" />
                    <Pick label="Taille max" value={o.videoMaxHeight} options={withCurrent(RESOLUTIONS, o.videoMaxHeight, `${o.videoMaxHeight}p`)}
                        onChange={(v) => set({ videoMaxHeight: v === 'exact' ? '' : v })} />
                    <Pick label="Format d'image" value={o.aspect} options={withCurrent(ASPECTS, o.aspect)} onChange={(v) => set({ aspect: v })} wide />
                </Grid>
                <Note>Une seule image, prise à l’instant choisi (secondes ou h:mm:ss). Vide : un peu après le début, pour éviter l’écran noir.</Note>
            </Group>
        ),
        image: () => (
            <Group title={GROUP_TITLES.image}>
                <Grid>
                    {!compressing && (
                        <Pick label="Qualité" value={String(o.imageQuality)} options={withCurrent(IMAGE_QUALITIES, String(o.imageQuality), `${o.imageQuality} %`)}
                            onChange={(v) => set({ imageQuality: parseInt(v, 10) })} />
                    )}
                    <Pick label="Taille max" value={imageSize}
                        options={withCurrent(IMAGE_SIZES, imageSize, imageSize.startsWith('%') ? `${imageSize.slice(1)} %` : `${imageSize} px`)}
                        onChange={(v) => set(v.startsWith('%') ? { imageResizeMode: 'percent', imagePercent: parseInt(v.slice(1), 10) } : { imageResizeMode: 'max', imageMaxSize: v })} />
                    <Pick label="Agrandir" value={o.imageUpscale} options={UPSCALES} onChange={(v) => set({ imageUpscale: v })} />
                    {!compressing && (
                        <TextField label="Poids visé (Mo)" value={o.imageTargetMb} onChange={(v) => set({ imageTargetMb: decimal(v) })} inputMode="decimal" placeholder="—" />
                    )}
                    {imageTargets.includes('webp') && (
                        <Pick label="WebP" value={o.imageLossless ? '1' : '0'} options={opts(['0', 'Avec perte'], ['1', 'Sans perte'])} onChange={(v) => set({ imageLossless: v === '1' })} />
                    )}
                    {imageTargets.includes('ico') && (
                        <Pick label="Taille de l'icône" value={o.icoSize} options={ICO_SIZES} onChange={(v) => set({ icoSize: v })} />
                    )}
                </Grid>
                <Note>Qualité : JPG, WebP, AVIF. Taille max : côté le plus long, sans agrandir. Lumière, couleurs et LUT : Color Lab.</Note>
            </Group>
        ),
        audio: () => (
            <Group title={GROUP_TITLES.audio}>
                <Grid>
                    {!compressing && (
                        <Pick label="Débit" value={o.audioBitrate} options={withCurrent(AUDIO_BITRATES, o.audioBitrate)} onChange={(v) => set({ audioBitrate: v })} />
                    )}
                    <Pick label="Volume" value={o.audioNormalize ? 'norm' : String(o.audioVolume)}
                        options={withCurrent(VOLUMES, String(o.audioVolume), `${o.audioVolume > 0 ? '+ ' : ''}${o.audioVolume} dB`)}
                        onChange={(v) => set(v === 'norm' ? { audioNormalize: true, audioVolume: 0 } : { audioNormalize: false, audioVolume: parseFloat(v) })} />
                    <Pick label="Fréquence" value={o.audioSampleRate} options={withCurrent(SAMPLE_RATES, o.audioSampleRate, `${o.audioSampleRate} Hz`)} onChange={(v) => set({ audioSampleRate: v })} />
                    <Pick label="Canaux" value={o.audioChannels} options={withCurrent(CHANNELS, o.audioChannels)} onChange={(v) => set({ audioChannels: v })} />
                </Grid>
            </Group>
        ),
        slideshow: () => (
            <Group title={GROUP_TITLES.slideshow}>
                <Grid>
                    <Pick label="Rythme" value={o.slideshowFps} options={withCurrent(SLIDESHOW_FPS, o.slideshowFps)} onChange={(v) => set({ slideshowFps: v })} wide />
                </Grid>
                <Note>Toutes les images de la file deviennent une seule vidéo, dans l’ordre alphabétique.</Note>
            </Group>
        ),
        trim: () => (
            <Group title={GROUP_TITLES.trim} aside="secondes ou h:mm:ss">
                <Grid>
                    <TextField label="Début" value={o.trimStart} onChange={(v) => set({ trimStart: v })} placeholder="0:05" inputMode="decimal" />
                    <TextField label="Fin" value={o.trimEnd} onChange={(v) => set({ trimEnd: v })} placeholder="1:30" inputMode="decimal" />
                </Grid>
            </Group>
        ),
        timing: () => (
            <Group title={GROUP_TITLES.timing} aside="secondes ou h:mm:ss">
                <Grid>
                    <TextField label="Début" value={o.trimStart} onChange={(v) => set({ trimStart: v })} placeholder="0:05" inputMode="decimal" />
                    <TextField label="Fin" value={o.trimEnd} onChange={(v) => set({ trimEnd: v })} placeholder="1:30" inputMode="decimal" />
                    <Pick label="Vitesse de lecture" value={o.speed} options={withCurrent(SPEEDS, o.speed, `× ${o.speed}`)} onChange={(v) => set({ speed: v })} wide />
                </Grid>
                {o.speed !== '1' && <Note>Le son suit la vitesse sans changer de tonalité. Début et fin se lisent sur la vidéo d’origine.</Note>}
            </Group>
        ),
    }

    if (groups.length === 0) return null
    return (
        <div className="space-y-6">
            {groups.map((g) => <div key={g}>{render[g]()}</div>)}
        </div>
    )
}
