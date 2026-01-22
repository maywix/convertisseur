import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import type { ConvertSettings, CompressSettings, MediaCategory } from '@/types'
import { VIDEO_FORMATS, AUDIO_FORMATS, IMAGE_FORMATS } from '@/types'
import { cn } from '@/lib/utils'
import { IconAudio, IconImage, IconVideo } from '@/components/icons'

interface ConfigPanelProps {
    currentAction: 'convert' | 'compress'
    onActionChange: (action: 'convert' | 'compress') => void
    convertSettings: ConvertSettings
    compressSettings: CompressSettings
    onConvertSettingsChange: (settings: ConvertSettings) => void
    onCompressSettingsChange: (settings: CompressSettings) => void
    onCategoryChange: (category: MediaCategory) => void
    onFormatChange: (format: string) => void
    canStart: boolean
    isProcessing: boolean
    onStart: () => void
}

export function ConfigPanel({
    currentAction,
    onActionChange,
    convertSettings,
    compressSettings,
    onConvertSettingsChange,
    onCompressSettingsChange,
    onCategoryChange,
    onFormatChange,
    canStart,
    isProcessing,
    onStart,
}: ConfigPanelProps) {
    const formats = convertSettings.category === 'video' ? VIDEO_FORMATS :
        convertSettings.category === 'audio' ? AUDIO_FORMATS :
            convertSettings.category === 'image' ? IMAGE_FORMATS : []

    return (
        <div className="bg-card rounded-xl border border-border p-4 lg:p-6 lg:sticky lg:top-20">
            <Tabs value={currentAction} onValueChange={(v) => onActionChange(v as 'convert' | 'compress')}>
                <TabsList className="w-full grid grid-cols-2 mb-6">
                    <TabsTrigger value="convert">Convertir</TabsTrigger>
                    <TabsTrigger value="compress">Compresser</TabsTrigger>
                </TabsList>

                {/* CONVERT MODE */}
                <TabsContent value="convert" className="space-y-6 mt-0">
                    {/* Category Selection */}
                    <div>
                        <label className="text-sm font-semibold text-muted-foreground block mb-2">
                            1. Type de média
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                            {(['video', 'audio', 'image'] as MediaCategory[]).map((cat) => (
                                <Button
                                    key={cat}
                                    variant={convertSettings.category === cat ? 'default' : 'outline'}
                                    className={cn(
                                        'flex flex-col h-auto py-3',
                                        convertSettings.category === cat && 'bg-primary text-primary-foreground'
                                    )}
                                    onClick={() => onCategoryChange(cat)}
                                >
                                    <span className="text-lg mb-1">
                                        {cat === 'video' ? <IconVideo size={18} /> : cat === 'audio' ? <IconAudio size={18} /> : <IconImage size={18} />}
                                    </span>
                                    <span className="text-xs capitalize">{cat === 'video' ? 'Vidéo' : cat === 'audio' ? 'Audio' : 'Image'}</span>
                                </Button>
                            ))}
                        </div>
                    </div>

                    {/* Format Selection */}
                    <div>
                        <label className="text-sm font-semibold text-muted-foreground block mb-2">
                            2. Format de sortie
                        </label>
                        <Select
                            value={convertSettings.format}
                            onValueChange={onFormatChange}
                            disabled={!convertSettings.category}
                        >
                            <SelectTrigger className="w-full">
                                <SelectValue placeholder={convertSettings.category ? 'Choisir un format...' : "Sélectionnez un type d'abord..."} />
                            </SelectTrigger>
                            <SelectContent>
                                {formats.map((fmt) => (
                                    <SelectItem key={fmt} value={fmt}>
                                        {fmt.toUpperCase()}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* GIF Settings */}
                    {convertSettings.category === 'video' && convertSettings.format === 'gif' && (
                        <div className="p-4 bg-background rounded-lg border border-border space-y-4">
                            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Paramètres GIF</h4>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs text-muted-foreground mb-1 block">Vitesse</label>
                                    <Select
                                        value={convertSettings.gifSpeed}
                                        onValueChange={(v) => onConvertSettingsChange({ ...convertSettings, gifSpeed: v })}
                                    >
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="1.0">Normal (1x)</SelectItem>
                                            <SelectItem value="0.5">2x plus rapide</SelectItem>
                                            <SelectItem value="0.25">4x plus rapide</SelectItem>
                                            <SelectItem value="0.1">10x plus rapide</SelectItem>
                                            <SelectItem value="2.0">2x plus lent</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div>
                                    <label className="text-xs text-muted-foreground mb-1 block">Framerate (FPS)</label>
                                    <Select
                                        value={convertSettings.gifFps}
                                        onValueChange={(v) => onConvertSettingsChange({ ...convertSettings, gifFps: v })}
                                    >
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="10">10</SelectItem>
                                            <SelectItem value="15">15</SelectItem>
                                            <SelectItem value="20">20</SelectItem>
                                            <SelectItem value="24">24</SelectItem>
                                            <SelectItem value="30">30</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <div>
                                <label className="text-xs text-muted-foreground mb-1 block">Résolution</label>
                                <Select
                                    value={convertSettings.gifResolution}
                                    onValueChange={(v) => onConvertSettingsChange({ ...convertSettings, gifResolution: v })}
                                >
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="1080">1080p</SelectItem>
                                        <SelectItem value="720">720p</SelectItem>
                                        <SelectItem value="480">480p</SelectItem>
                                        <SelectItem value="360">360p</SelectItem>
                                        <SelectItem value="240">240p</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    )}

                    {/* Audio Settings */}
                    {convertSettings.category === 'audio' && (
                        <div className="p-4 bg-background rounded-lg border border-border space-y-4">
                            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Audio</h4>
                            <div>
                                <label className="text-xs text-muted-foreground mb-1 block">Bitrate</label>
                                <Select
                                    value={convertSettings.audioBitrate}
                                    onValueChange={(v) => onConvertSettingsChange({ ...convertSettings, audioBitrate: v })}
                                >
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="64k">64 kbps</SelectItem>
                                        <SelectItem value="96k">96 kbps</SelectItem>
                                        <SelectItem value="128k">128 kbps</SelectItem>
                                        <SelectItem value="160k">160 kbps</SelectItem>
                                        <SelectItem value="192k">192 kbps</SelectItem>
                                        <SelectItem value="256k">256 kbps</SelectItem>
                                        <SelectItem value="320k">320 kbps</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <p className="text-xs text-muted-foreground italic">S'applique aux formats compatibles (MP3, AAC, etc.).</p>
                        </div>
                    )}

                    {/* Image Settings */}
                    {convertSettings.category === 'image' && (
                        <div className="p-4 bg-background rounded-lg border border-border space-y-4">
                            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Qualité Image</h4>
                            <div>
                                <label className="text-xs text-muted-foreground mb-1 block">Qualité</label>
                                <Select
                                    value={convertSettings.imageQuality}
                                    onValueChange={(v) => onConvertSettingsChange({ ...convertSettings, imageQuality: v })}
                                >
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="lossless">🔒 Sans perte (Lossless)</SelectItem>
                                        <SelectItem value="95">95% (Très haute)</SelectItem>
                                        <SelectItem value="90">90% (Haute)</SelectItem>
                                        <SelectItem value="80">80% (Bonne)</SelectItem>
                                        <SelectItem value="70">70% (Moyenne)</SelectItem>
                                        <SelectItem value="60">60% (Économique)</SelectItem>
                                        <SelectItem value="50">50% (Compressée)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <p className="text-xs text-muted-foreground italic">💡 La transparence est préservée automatiquement (PNG, WebP)</p>

                            <div>
                                <label className="text-xs text-muted-foreground mb-1 block">Résolution</label>
                                <Select
                                    value={convertSettings.imageMaxSize || 'original'}
                                    onValueChange={(v) => onConvertSettingsChange({ ...convertSettings, imageMaxSize: v === 'original' ? '' : v })}
                                >
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="original">Originale</SelectItem>
                                        <SelectItem value="3840">4K (3840 px)</SelectItem>
                                        <SelectItem value="2560">QHD (2560 px)</SelectItem>
                                        <SelectItem value="1920">1080p (1920 px)</SelectItem>
                                        <SelectItem value="1280">1280 px</SelectItem>
                                        <SelectItem value="1080">1080 px</SelectItem>
                                        <SelectItem value="720">720 px</SelectItem>
                                        <SelectItem value="480">480 px</SelectItem>
                                        <SelectItem value="256">256 px (favicon)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* ICO Settings */}
                            {convertSettings.format === 'ico' && (
                                <div className="pt-2 border-t border-border">
                                    <label className="text-xs text-muted-foreground mb-1 block">Taille ICO</label>
                                    <Select
                                        value={convertSettings.icoSize}
                                        onValueChange={(v) => onConvertSettingsChange({ ...convertSettings, icoSize: v })}
                                    >
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="256">256 px (recommandé)</SelectItem>
                                            <SelectItem value="128">128 px</SelectItem>
                                            <SelectItem value="64">64 px</SelectItem>
                                            <SelectItem value="48">48 px</SelectItem>
                                            <SelectItem value="32">32 px</SelectItem>
                                            <SelectItem value="16">16 px</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <p className="text-xs text-muted-foreground italic mt-2">Limite ICO: 256 px max.</p>
                                </div>
                            )}
                        </div>
                    )}
                </TabsContent>

                {/* COMPRESS MODE */}
                <TabsContent value="compress" className="space-y-6 mt-0">
                    <div>
                        <label className="text-sm font-semibold text-muted-foreground block mb-3">Mode de compression</label>
                        <RadioGroup
                            value={compressSettings.mode}
                            onValueChange={(v) => onCompressSettingsChange({ ...compressSettings, mode: v as CompressSettings['mode'] })}
                            className="space-y-2"
                        >
                            {[
                                { value: 'crf', label: 'Qualité (Standard)' },
                                { value: 'size', label: 'Taille Cible (MB)' },
                                { value: 'percent', label: 'Réduction (%)' },
                                { value: 'res', label: 'Résolution' },
                            ].map((opt) => (
                                <div key={opt.value} className="flex items-center space-x-2">
                                    <RadioGroupItem value={opt.value} id={opt.value} />
                                    <label htmlFor={opt.value} className="text-sm cursor-pointer">{opt.label}</label>
                                </div>
                            ))}
                        </RadioGroup>
                    </div>

                    {/* Dynamic Input */}
                    <div className="p-4 bg-background rounded-lg border border-border">
                        {compressSettings.mode === 'crf' && (
                            <div>
                                <Slider
                                    value={[compressSettings.crfLevel === 'low' ? 1 : compressSettings.crfLevel === 'high' ? 3 : 2]}
                                    min={1}
                                    max={3}
                                    step={1}
                                    onValueChange={([v]) => onCompressSettingsChange({
                                        ...compressSettings,
                                        crfLevel: v === 1 ? 'low' : v === 3 ? 'high' : 'medium'
                                    })}
                                />
                                <div className="flex justify-between text-xs text-muted-foreground mt-2">
                                    <span>Faible</span>
                                    <span>Moyen</span>
                                    <span>Forte</span>
                                </div>
                            </div>
                        )}

                        {compressSettings.mode === 'size' && (
                            <div className="relative">
                                <input
                                    type="number"
                                    value={compressSettings.targetSizeMb}
                                    onChange={(e) => onCompressSettingsChange({ ...compressSettings, targetSizeMb: e.target.value })}
                                    placeholder="Ex: 50"
                                    min={1}
                                    className="w-full px-3 py-2 pr-12 bg-card border border-input rounded-md text-sm"
                                />
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">MB</span>
                            </div>
                        )}

                        {compressSettings.mode === 'percent' && (
                            <div>
                                <Slider
                                    value={[parseInt(compressSettings.percentReduction) || 50]}
                                    min={10}
                                    max={90}
                                    step={1}
                                    onValueChange={([v]) => onCompressSettingsChange({ ...compressSettings, percentReduction: String(v) })}
                                />
                                <div className="text-center text-sm font-semibold text-primary mt-2">
                                    {compressSettings.percentReduction}% de réduction
                                </div>
                            </div>
                        )}

                        {compressSettings.mode === 'res' && (
                            <Select
                                value={compressSettings.resolution}
                                onValueChange={(v) => onCompressSettingsChange({ ...compressSettings, resolution: v })}
                            >
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="1080">1080p (FHD)</SelectItem>
                                    <SelectItem value="720">720p (HD)</SelectItem>
                                    <SelectItem value="480">480p (SD)</SelectItem>
                                    <SelectItem value="360">360p (Low)</SelectItem>
                                </SelectContent>
                            </Select>
                        )}
                    </div>

                    {/* Advanced Toggle */}
                    <div className="flex items-center gap-3 pt-4 border-t border-border">
                        <Switch
                            checked={compressSettings.advancedEnabled}
                            onCheckedChange={(checked) => onCompressSettingsChange({ ...compressSettings, advancedEnabled: checked })}
                        />
                        <span className="font-semibold text-sm">Options Avancées</span>
                    </div>

                    {/* Advanced Settings */}
                    {compressSettings.advancedEnabled && (
                        <div className="p-4 bg-background rounded-lg border border-border space-y-4">
                            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Paramètres Avancés</h4>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs text-muted-foreground mb-1 block">Framerate (FPS)</label>
                                    <Select
                                        value={compressSettings.fps}
                                        onValueChange={(v) => onCompressSettingsChange({ ...compressSettings, fps: v })}
                                    >
                                        <SelectTrigger><SelectValue placeholder="Original" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="original">Original</SelectItem>
                                            <SelectItem value="24">24</SelectItem>
                                            <SelectItem value="30">30</SelectItem>
                                            <SelectItem value="60">60</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div>
                                    <label className="text-xs text-muted-foreground mb-1 block">Preset Encodage</label>
                                    <Select
                                        value={compressSettings.preset}
                                        onValueChange={(v) => onCompressSettingsChange({ ...compressSettings, preset: v })}
                                    >
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="ultrafast">Ultrafast</SelectItem>
                                            <SelectItem value="fast">Fast</SelectItem>
                                            <SelectItem value="medium">Medium</SelectItem>
                                            <SelectItem value="slow">Slow</SelectItem>
                                            <SelectItem value="veryslow">Very Slow</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs text-muted-foreground mb-1 block">Audio Bitrate</label>
                                    <Select
                                        value={compressSettings.audioBitrate}
                                        onValueChange={(v) => onCompressSettingsChange({ ...compressSettings, audioBitrate: v })}
                                    >
                                        <SelectTrigger><SelectValue placeholder="Original" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="original">Original</SelectItem>
                                            <SelectItem value="64k">64k</SelectItem>
                                            <SelectItem value="128k">128k</SelectItem>
                                            <SelectItem value="192k">192k</SelectItem>
                                            <SelectItem value="320k">320k</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div>
                                    <label className="text-xs text-muted-foreground mb-1 block">Audio Channels</label>
                                    <Select
                                        value={compressSettings.audioChannels}
                                        onValueChange={(v) => onCompressSettingsChange({ ...compressSettings, audioChannels: v })}
                                    >
                                        <SelectTrigger><SelectValue placeholder="Original" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="original">Original</SelectItem>
                                            <SelectItem value="1">Mono</SelectItem>
                                            <SelectItem value="2">Stereo</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Image Compress Options */}
                    <div className="p-4 bg-background rounded-lg border border-border space-y-4">
                        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Options Image</h4>
                        <div>
                            <label className="text-xs text-muted-foreground mb-1 block">Résolution</label>
                            <Select
                                value={compressSettings.imageMaxSize || 'original'}
                                onValueChange={(v) => onCompressSettingsChange({ ...compressSettings, imageMaxSize: v === 'original' ? '' : v })}
                            >
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="original">Originale</SelectItem>
                                    <SelectItem value="3840">4K (3840 px)</SelectItem>
                                    <SelectItem value="2560">QHD (2560 px)</SelectItem>
                                    <SelectItem value="1920">1080p (1920 px)</SelectItem>
                                    <SelectItem value="1280">1280 px</SelectItem>
                                    <SelectItem value="720">720 px</SelectItem>
                                    <SelectItem value="480">480 px</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <p className="text-xs text-muted-foreground italic">S'applique uniquement aux images.</p>
                    </div>
                </TabsContent>
            </Tabs>

            {/* Start Button */}
            <Button
                className="w-full mt-6"
                size="lg"
                disabled={!canStart || isProcessing}
                onClick={onStart}
            >
                {isProcessing ? 'Conversion en cours...' : 'Lancer le traitement'}
            </Button>
        </div>
    )
}
