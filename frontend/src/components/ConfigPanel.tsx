import { IconAudio, IconImage, IconVideo } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { CompressSettings, ConvertSettings, MediaCategory, OutputMode } from "@/types";
import { AUDIO_FORMATS, IMAGE_FORMATS, VIDEO_FORMATS } from "@/types";

interface ConfigPanelProps {
  currentAction: "convert" | "compress";
  onActionChange: (action: "convert" | "compress") => void;
  convertSettings: ConvertSettings;
  compressSettings: CompressSettings;
  onConvertSettingsChange: (settings: ConvertSettings) => void;
  onCompressSettingsChange: (settings: CompressSettings) => void;
  onCategoryChange: (category: MediaCategory) => void;
  onFormatChange: (format: string) => void;
  outputMode: OutputMode;
  onOutputModeChange: (mode: OutputMode) => void;
  backgroundEnabled: boolean;
  onBackgroundEnabledChange: (enabled: boolean) => void;
  autoDownloadEnabled: boolean;
  onAutoDownloadEnabledChange: (enabled: boolean) => void;
  detectedTypes: Array<"video" | "audio" | "image">;
  onApplySuggestedConvert: (type: "video" | "audio" | "image") => void;
  onApplySuggestedCompress: (type: "video" | "audio" | "image") => void;
  canStart: boolean;
  isProcessing: boolean;
  onStart: () => void;
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
  outputMode,
  onOutputModeChange,
  backgroundEnabled,
  onBackgroundEnabledChange,
  autoDownloadEnabled,
  onAutoDownloadEnabledChange,
  detectedTypes,
  onApplySuggestedConvert,
  onApplySuggestedCompress,
  canStart,
  isProcessing,
  onStart,
}: ConfigPanelProps) {
  const formats =
    convertSettings.category === "video"
      ? VIDEO_FORMATS
      : convertSettings.category === "audio"
        ? AUDIO_FORMATS
        : convertSettings.category === "image"
          ? IMAGE_FORMATS
          : [];

  return (
    <div className="bg-card rounded-xl border border-border p-4 lg:p-6 lg:sticky lg:top-20">
      {detectedTypes.length > 0 && (
        <div className="mb-6 p-3 rounded-lg border border-border bg-background space-y-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
            Suggestions intelligentes
          </p>
          <div className="space-y-2">
            {detectedTypes.map((type) => {
              const label =
                type === "video"
                  ? "Vidéo"
                  : type === "audio"
                    ? "Audio"
                    : "Image";
              return (
                <div
                  key={type}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <span className="text-sm font-medium">{label}</span>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onApplySuggestedConvert(type)}
                    >
                      Convertir
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onApplySuggestedCompress(type)}
                    >
                      Compresser
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            Astuce: ajoutez des images et des vidéos ensemble pour appliquer une
            compression commune en mode taille cible.
          </p>
        </div>
      )}

      <div className="mb-4 p-3 rounded-lg border border-border bg-background space-y-3">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Mode de sortie</p>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={outputMode === "global" ? "default" : "outline"}
              onClick={() => onOutputModeChange("global")}
              className="text-xs"
            >
              Tous pareils
            </Button>
            <Button
              type="button"
              variant={outputMode === "per-file" ? "default" : "outline"}
              onClick={() => onOutputModeChange("per-file")}
              className="text-xs"
            >
              Fichier par fichier
            </Button>
          </div>
        </div>
        <div className="space-y-2 pt-1 border-t border-border">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm">Traitement en arrière-plan</span>
            <Switch
              checked={backgroundEnabled}
              onCheckedChange={onBackgroundEnabledChange}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm">Téléchargement auto à la fin</span>
            <Switch
              checked={autoDownloadEnabled}
              onCheckedChange={onAutoDownloadEnabledChange}
            />
          </div>
        </div>
      </div>

      <Tabs
        value={currentAction}
        onValueChange={(v) => onActionChange(v as "convert" | "compress")}
      >
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
              {(["video", "audio", "image"] as MediaCategory[]).map((cat) => (
                <Button
                  key={cat}
                  variant={
                    convertSettings.category === cat ? "default" : "outline"
                  }
                  className={cn(
                    "flex flex-col h-auto py-3",
                    convertSettings.category === cat &&
                      "bg-primary text-primary-foreground",
                  )}
                  onClick={() => onCategoryChange(cat)}
                >
                  <span className="text-lg mb-1">
                    {cat === "video" ? (
                      <IconVideo size={18} />
                    ) : cat === "audio" ? (
                      <IconAudio size={18} />
                    ) : (
                      <IconImage size={18} />
                    )}
                  </span>
                  <span className="text-xs capitalize">
                    {cat === "video"
                      ? "Vidéo"
                      : cat === "audio"
                        ? "Audio"
                        : "Image"}
                  </span>
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
                <SelectValue
                  placeholder={
                    convertSettings.category
                      ? "Choisir un format..."
                      : "Sélectionnez un type d'abord..."
                  }
                />
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
          {convertSettings.category === "video" &&
            convertSettings.format === "gif" && (
              <div className="p-2 lg:p-4 bg-background rounded-lg border border-border space-y-4">
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Paramètres GIF
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">
                      Vitesse
                    </label>
                    <Select
                      value={convertSettings.gifSpeed}
                      onValueChange={(v) =>
                        onConvertSettingsChange({
                          ...convertSettings,
                          gifSpeed: v,
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
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
                    <label className="text-xs text-muted-foreground mb-1 block">
                      Framerate (FPS)
                    </label>
                    <Select
                      value={convertSettings.gifFps}
                      onValueChange={(v) =>
                        onConvertSettingsChange({
                          ...convertSettings,
                          gifFps: v,
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
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
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Résolution
                  </label>
                  <Select
                    value={convertSettings.gifResolution}
                    onValueChange={(v) =>
                      onConvertSettingsChange({
                        ...convertSettings,
                        gifResolution: v,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
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

          {convertSettings.category === "video" && (
            <div className="p-2 lg:p-4 bg-background rounded-lg border border-border space-y-4">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Mini Éditeur Vidéo
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Début (HH:MM:SS)</label>
                  <input
                    type="text"
                    value={convertSettings.videoTrimStart}
                    onChange={(e) =>
                      onConvertSettingsChange({
                        ...convertSettings,
                        videoTrimStart: e.target.value,
                      })
                    }
                    placeholder="00:00:00"
                    className="w-full h-9 px-3 rounded-md border border-input bg-card text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Fin (HH:MM:SS)</label>
                  <input
                    type="text"
                    value={convertSettings.videoTrimEnd}
                    onChange={(e) =>
                      onConvertSettingsChange({
                        ...convertSettings,
                        videoTrimEnd: e.target.value,
                      })
                    }
                    placeholder="00:00:15"
                    className="w-full h-9 px-3 rounded-md border border-input bg-card text-sm"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-muted-foreground mb-1 block">Texte superposé</label>
                <input
                  type="text"
                  value={convertSettings.overlayText}
                  onChange={(e) =>
                    onConvertSettingsChange({
                      ...convertSettings,
                      overlayText: e.target.value,
                    })
                  }
                  placeholder="Ex: Mon titre"
                  className="w-full h-9 px-3 rounded-md border border-input bg-card text-sm"
                />
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    value={convertSettings.overlayTextX}
                    onChange={(e) =>
                      onConvertSettingsChange({
                        ...convertSettings,
                        overlayTextX: e.target.value,
                      })
                    }
                    placeholder="X ex: (w-text_w)/2"
                    className="w-full h-9 px-3 rounded-md border border-input bg-card text-xs"
                  />
                  <input
                    type="text"
                    value={convertSettings.overlayTextY}
                    onChange={(e) =>
                      onConvertSettingsChange({
                        ...convertSettings,
                        overlayTextY: e.target.value,
                      })
                    }
                    placeholder="Y ex: h-(text_h*2)"
                    className="w-full h-9 px-3 rounded-md border border-input bg-card text-xs"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Audio Settings */}
          {convertSettings.category === "audio" && (
            <div className="p-2 lg:p-4 bg-background rounded-lg border border-border space-y-4">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Audio
              </h4>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Bitrate
                </label>
                <Select
                  value={convertSettings.audioBitrate}
                  onValueChange={(v) =>
                    onConvertSettingsChange({
                      ...convertSettings,
                      audioBitrate: v,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
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
              <p className="text-xs text-muted-foreground italic">
                S'applique aux formats compatibles (MP3, AAC, etc.).
              </p>
            </div>
          )}

          {/* Image Settings */}
          {convertSettings.category === "image" && (
            <div className="p-2 lg:p-4 bg-background rounded-lg border border-border space-y-4">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Qualité Image
              </h4>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Qualité
                </label>
                <Select
                  value={convertSettings.imageQuality}
                  onValueChange={(v) =>
                    onConvertSettingsChange({
                      ...convertSettings,
                      imageQuality: v,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lossless">
                      🔒 Sans perte (Lossless)
                    </SelectItem>
                    <SelectItem value="95">95% (Très haute)</SelectItem>
                    <SelectItem value="90">90% (Haute)</SelectItem>
                    <SelectItem value="80">80% (Bonne)</SelectItem>
                    <SelectItem value="70">70% (Moyenne)</SelectItem>
                    <SelectItem value="60">60% (Économique)</SelectItem>
                    <SelectItem value="50">50% (Compressée)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground italic">
                💡 La transparence est préservée automatiquement (PNG, WebP)
              </p>

              <div className="space-y-4">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Redimensionnement
                  </label>
                  <RadioGroup
                    value={convertSettings.imageResizeMode}
                    onValueChange={(v) =>
                      onConvertSettingsChange({
                        ...convertSettings,
                        imageResizeMode:
                          v as ConvertSettings["imageResizeMode"],
                      })
                    }
                    className="space-y-3"
                  >
                    {(
                      [
                        {
                          value: "none",
                          label: "Aucun redimensionnement",
                          description: "Reste sur la taille originale",
                        },
                        {
                          value: "dimension",
                          label: "Limiter la dimension max",
                          description: "Cap sur la plus grande longueur (px)",
                        },
                        {
                          value: "percent",
                          label: "Réduction en %",
                          description: `${convertSettings.imageResizePercent}% de l'original`,
                        },
                      ] as const
                    ).map((opt) => (
                      <div key={opt.value} className="flex items-start gap-2">
                        <RadioGroupItem
                          value={opt.value}
                          id={`resize-${opt.value}`}
                        />
                        <div className="text-sm leading-tight">
                          <label
                            htmlFor={`resize-${opt.value}`}
                            className="font-semibold text-sm"
                          >
                            {opt.label}
                          </label>
                          <p className="text-xs text-muted-foreground mt-1">
                            {opt.description}
                          </p>
                        </div>
                      </div>
                    ))}
                  </RadioGroup>
                </div>

                {convertSettings.imageResizeMode === "dimension" && (
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">
                      Dimension max
                    </label>
                    <Select
                      value={convertSettings.imageMaxSize || "original"}
                      onValueChange={(v) =>
                        onConvertSettingsChange({
                          ...convertSettings,
                          imageMaxSize: v === "original" ? "" : v,
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
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
                )}

                {convertSettings.imageResizeMode === "percent" && (
                  <div className="space-y-2">
                    <div>
                      <span className="text-xs font-semibold text-muted-foreground">
                        Taille cible: {convertSettings.imageResizePercent}%
                      </span>
                    </div>
                    <Slider
                      value={[
                        Math.max(
                          10,
                          Math.min(
                            200,
                            parseInt(convertSettings.imageResizePercent, 10) ||
                              75,
                          ),
                        ),
                      ]}
                      min={10}
                      max={200}
                      step={5}
                      onValueChange={([value]) =>
                        onConvertSettingsChange({
                          ...convertSettings,
                          imageResizePercent: String(value),
                        })
                      }
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>10%</span>
                      <span>200%</span>
                    </div>
                  </div>
                )}
              </div>

              {/* ICO Settings */}
              {convertSettings.format === "ico" && (
                <div className="pt-2 border-t border-border">
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Taille ICO
                  </label>
                  <Select
                    value={convertSettings.icoSize}
                    onValueChange={(v) =>
                      onConvertSettingsChange({
                        ...convertSettings,
                        icoSize: v,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="256">256 px (recommandé)</SelectItem>
                      <SelectItem value="128">128 px</SelectItem>
                      <SelectItem value="64">64 px</SelectItem>
                      <SelectItem value="48">48 px</SelectItem>
                      <SelectItem value="32">32 px</SelectItem>
                      <SelectItem value="16">16 px</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground italic mt-2">
                    Limite ICO: 256 px max.
                  </p>
                </div>
              )}
            </div>
          )}
        </TabsContent>

        {/* COMPRESS MODE */}
        <TabsContent value="compress" className="space-y-6 mt-0">
          <div>
            <label className="text-sm font-semibold text-muted-foreground block mb-3">
              Mode de compression
            </label>
            <RadioGroup
              value={compressSettings.mode}
              onValueChange={(v) =>
                onCompressSettingsChange({
                  ...compressSettings,
                  mode: v as CompressSettings["mode"],
                })
              }
              className="space-y-2"
            >
              {[
                { value: "crf", label: "Qualité (Standard)" },
                { value: "size", label: "Taille Cible (MB)" },
                { value: "percent", label: "Réduction (%)" },
                { value: "res", label: "Résolution" },
              ].map((opt) => (
                <div key={opt.value} className="flex items-center space-x-2">
                  <RadioGroupItem value={opt.value} id={opt.value} />
                  <label htmlFor={opt.value} className="text-sm cursor-pointer">
                    {opt.label}
                  </label>
                </div>
              ))}
            </RadioGroup>
          </div>

          {/* Dynamic Input */}
          <div className="p-4 bg-background rounded-lg border border-border">
            {compressSettings.mode === "crf" && (
              <div>
                <Slider
                  value={[
                    compressSettings.crfLevel === "low"
                      ? 1
                      : compressSettings.crfLevel === "high"
                        ? 3
                        : 2,
                  ]}
                  min={1}
                  max={3}
                  step={1}
                  onValueChange={([v]) =>
                    onCompressSettingsChange({
                      ...compressSettings,
                      crfLevel: v === 1 ? "low" : v === 3 ? "high" : "medium",
                    })
                  }
                />
                <div className="flex justify-between text-xs text-muted-foreground mt-2">
                  <span>Faible</span>
                  <span>Moyen</span>
                  <span>Forte</span>
                </div>
              </div>
            )}

            {compressSettings.mode === "size" && (
              <div className="relative">
                <input
                  type="number"
                  value={compressSettings.targetSizeMb}
                  onChange={(e) =>
                    onCompressSettingsChange({
                      ...compressSettings,
                      targetSizeMb: e.target.value,
                    })
                  }
                  placeholder="Ex: 50"
                  min={1}
                  className="w-full px-3 py-2 pr-12 bg-card border border-input rounded-md text-sm"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  MB
                </span>
              </div>
            )}

            {compressSettings.mode === "percent" && (
              <div>
                <Slider
                  value={[parseInt(compressSettings.percentReduction) || 50]}
                  min={10}
                  max={90}
                  step={1}
                  onValueChange={([v]) =>
                    onCompressSettingsChange({
                      ...compressSettings,
                      percentReduction: String(v),
                    })
                  }
                />
                <div className="text-center text-sm font-semibold text-primary mt-2">
                  {compressSettings.percentReduction}% de réduction
                </div>
              </div>
            )}

            {compressSettings.mode === "res" && (
              <Select
                value={compressSettings.resolution}
                onValueChange={(v) =>
                  onCompressSettingsChange({
                    ...compressSettings,
                    resolution: v,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
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
              onCheckedChange={(checked) =>
                onCompressSettingsChange({
                  ...compressSettings,
                  advancedEnabled: checked,
                })
              }
            />
            <span className="font-semibold text-sm">Options Avancées</span>
          </div>

          {/* Advanced Settings */}
          {compressSettings.advancedEnabled && (
            <div className="p-2 lg:p-4 bg-background rounded-lg border border-border space-y-4">
              {/* VIDEO ADVANCED - Show ONLY if video detected */}
              {detectedTypes.includes("video") && (
                <>
                  <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                    Paramètres Vidéo
                  </h4>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">
                        Codec vidéo
                      </label>
                  <Select
                    value={compressSettings.videoCodec}
                    onValueChange={(v) =>
                      onCompressSettingsChange({
                        ...compressSettings,
                        videoCodec: v,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="libx264">H.264 (AVC)</SelectItem>
                      <SelectItem value="libx265">H.265 (HEVC)</SelectItem>
                      <SelectItem value="libaom-av1">AV1</SelectItem>
                      <SelectItem value="libvpx-vp9">VP9</SelectItem>
                      <SelectItem value="mpeg4">MPEG-4</SelectItem>
                      <SelectItem value="mpeg2video">MPEG-2</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Preset encodage
                  </label>
                  <Select
                    value={compressSettings.preset}
                    onValueChange={(v) =>
                      onCompressSettingsChange({
                        ...compressSettings,
                        preset: v,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ultrafast">Ultrafast</SelectItem>
                      <SelectItem value="superfast">Superfast</SelectItem>
                      <SelectItem value="veryfast">Veryfast</SelectItem>
                      <SelectItem value="faster">Faster</SelectItem>
                      <SelectItem value="fast">Fast</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="slow">Slow</SelectItem>
                      <SelectItem value="slower">Slower</SelectItem>
                      <SelectItem value="veryslow">Veryslow</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Profil vidéo
                  </label>
                  <Select
                    value={compressSettings.videoProfile}
                    onValueChange={(v) =>
                      onCompressSettingsChange({
                        ...compressSettings,
                        videoProfile: v,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto</SelectItem>
                      <SelectItem value="baseline">Baseline</SelectItem>
                      <SelectItem value="main">Main</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Tune vidéo
                  </label>
                  <Select
                    value={compressSettings.videoTune}
                    onValueChange={(v) =>
                      onCompressSettingsChange({
                        ...compressSettings,
                        videoTune: v,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Aucun</SelectItem>
                      <SelectItem value="film">Film</SelectItem>
                      <SelectItem value="animation">Animation</SelectItem>
                      <SelectItem value="grain">Grain</SelectItem>
                      <SelectItem value="fastdecode">Fastdecode</SelectItem>
                      <SelectItem value="zerolatency">Zero latency</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Framerate (FPS)
                  </label>
                  <Select
                    value={compressSettings.fps}
                    onValueChange={(v) =>
                      onCompressSettingsChange({ ...compressSettings, fps: v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Original" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="original">Original</SelectItem>
                      <SelectItem value="15">15 fps</SelectItem>
                      <SelectItem value="20">20 fps</SelectItem>
                      <SelectItem value="23.976">23.976 fps (NTSC)</SelectItem>
                      <SelectItem value="24">24</SelectItem>
                      <SelectItem value="25">25 fps (PAL)</SelectItem>
                      <SelectItem value="29.97">29.97 fps (NTSC)</SelectItem>
                      <SelectItem value="30">30</SelectItem>
                      <SelectItem value="50">50 fps (PAL)</SelectItem>
                      <SelectItem value="59.94">59.94 fps (NTSC)</SelectItem>
                      <SelectItem value="60">60</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Pixel format
                  </label>
                  <Select
                    value={compressSettings.videoPixelFormat}
                    onValueChange={(v) =>
                      onCompressSettingsChange({
                        ...compressSettings,
                        videoPixelFormat: v,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto</SelectItem>
                      <SelectItem value="yuv420p">yuv420p</SelectItem>
                      <SelectItem value="yuv422p">yuv422p</SelectItem>
                      <SelectItem value="yuv444p">yuv444p</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Mode qualité vidéo
                  </label>
                  <Select
                    value={compressSettings.qualityMode}
                    onValueChange={(v) =>
                      onCompressSettingsChange({
                        ...compressSettings,
                        qualityMode: v as CompressSettings["qualityMode"],
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto (selon mode)</SelectItem>
                      <SelectItem value="crf">Qualité constante (CRF)</SelectItem>
                      <SelectItem value="bitrate">Bitrate moyen (kbit/s)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    CRF vidéo
                  </label>
                  <Select
                    value={compressSettings.videoCrf}
                    onValueChange={(v) =>
                      onCompressSettingsChange({ ...compressSettings, videoCrf: v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="18">18 (très haute qualité)</SelectItem>
                      <SelectItem value="20">20</SelectItem>
                      <SelectItem value="23">23 (défaut)</SelectItem>
                      <SelectItem value="26">26</SelectItem>
                      <SelectItem value="28">28</SelectItem>
                      <SelectItem value="30">30</SelectItem>
                      <SelectItem value="32">32</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Bitrate vidéo (kbit/s)
                  </label>
                  <input
                    type="number"
                    min={100}
                    step={100}
                    value={compressSettings.videoBitrateK}
                    onChange={(e) =>
                      onCompressSettingsChange({
                        ...compressSettings,
                        videoBitrateK: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 bg-card border border-input rounded-md text-sm"
                  />
                </div>
                <div className="space-y-3">
                  <div className="flex items-center gap-3 pt-5">
                    <Switch
                      checked={compressSettings.twoPass}
                      onCheckedChange={(checked) =>
                        onCompressSettingsChange({
                          ...compressSettings,
                          twoPass: checked,
                        })
                      }
                    />
                    <span className="text-sm">Activer 2-pass</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={compressSettings.faststart}
                      onCheckedChange={(checked) =>
                        onCompressSettingsChange({
                          ...compressSettings,
                          faststart: checked,
                        })
                      }
                    />
                    <span className="text-sm">Optimiser streaming (faststart)</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={compressSettings.deinterlace}
                      onCheckedChange={(checked) =>
                        onCompressSettingsChange({
                          ...compressSettings,
                          deinterlace: checked,
                        })
                      }
                    />
                    <span className="text-sm">Désentrelacement (bwdif)</span>
                  </div>
                </div>
              </div>
              </>
              )}

              {/* AUDIO ADVANCED - Show if VIDEO or AUDIO present */}
              {(detectedTypes.includes("audio") || detectedTypes.includes("video")) && (
                <>
                  <div className="border-t border-border pt-4 text-xs uppercase tracking-wide text-muted-foreground font-semibold">
                    Audio avancé
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Codec audio
                  </label>
                  <Select
                    value={compressSettings.audioCodec}
                    onValueChange={(v) =>
                      onCompressSettingsChange({
                        ...compressSettings,
                        audioCodec: v,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Original" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="original">Sans modification</SelectItem>
                      <SelectItem value="copy">Pass-through (copier)</SelectItem>
                      <SelectItem value="aac">AAC</SelectItem>
                      <SelectItem value="libmp3lame">MP3</SelectItem>
                      <SelectItem value="libopus">Opus</SelectItem>
                      <SelectItem value="flac">FLAC</SelectItem>
                      <SelectItem value="ac3">AC3</SelectItem>
                      <SelectItem value="eac3">E-AC3</SelectItem>
                      <SelectItem value="libvorbis">Vorbis</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Audio Bitrate
                  </label>
                  <Select
                    value={compressSettings.audioBitrate}
                    onValueChange={(v) =>
                      onCompressSettingsChange({
                        ...compressSettings,
                        audioBitrate: v,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Original" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="original">Original</SelectItem>
                      <SelectItem value="48k">48k</SelectItem>
                      <SelectItem value="64k">64k</SelectItem>
                      <SelectItem value="96k">96k</SelectItem>
                      <SelectItem value="128k">128k</SelectItem>
                      <SelectItem value="160k">160k</SelectItem>
                      <SelectItem value="192k">192k</SelectItem>
                      <SelectItem value="256k">256k</SelectItem>
                      <SelectItem value="320k">320k</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Audio Channels
                  </label>
                  <Select
                    value={compressSettings.audioChannels}
                    onValueChange={(v) =>
                      onCompressSettingsChange({
                        ...compressSettings,
                        audioChannels: v,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Original" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="original">Original</SelectItem>
                      <SelectItem value="1">Mono (1.0)</SelectItem>
                      <SelectItem value="2">Stéréo (2.0)</SelectItem>
                      <SelectItem value="3">2.1</SelectItem>
                      <SelectItem value="4">Quadraphonie (4.0)</SelectItem>
                      <SelectItem value="5">5.0</SelectItem>
                      <SelectItem value="6">5.1</SelectItem>
                      <SelectItem value="7">7.0</SelectItem>
                      <SelectItem value="8">7.1</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Fréquence audio
                  </label>
                  <Select
                    value={compressSettings.audioSampleRate}
                    onValueChange={(v) =>
                      onCompressSettingsChange({
                        ...compressSettings,
                        audioSampleRate: v,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Original" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="original">Auto (Pas de modification)</SelectItem>
                      <SelectItem value="16000">16000 Hz</SelectItem>
                      <SelectItem value="22050">22050 Hz</SelectItem>
                      <SelectItem value="24000">24000 Hz</SelectItem>
                      <SelectItem value="32000">32000 Hz</SelectItem>
                      <SelectItem value="44100">44100 Hz</SelectItem>
                      <SelectItem value="48000">48000 Hz</SelectItem>
                      <SelectItem value="64000">64000 Hz</SelectItem>
                      <SelectItem value="88200">88200 Hz</SelectItem>
                      <SelectItem value="96000">96000 Hz</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
                </>
              )}
            </div>
          )}

          {/* Image Compress Options */}
          <div className="p-2 lg:p-4 bg-background rounded-lg border border-border space-y-4">
            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Options Image
            </h4>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Résolution
              </label>
              <Select
                value={compressSettings.imageMaxSize || "original"}
                onValueChange={(v) =>
                  onCompressSettingsChange({
                    ...compressSettings,
                    imageMaxSize: v === "original" ? "" : v,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
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
            <p className="text-xs text-muted-foreground italic">
              S'applique uniquement aux images. En mode taille cible, la valeur
              MB est appliquee par image.
            </p>
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
        {isProcessing ? "Conversion en cours..." : "Lancer le traitement"}
      </Button>
    </div>
  );
}
