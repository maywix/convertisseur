import { useEffect, useMemo, useRef, useState } from "react";

import {
    IconAudio, IconChevronDown, IconChevronUp,
    IconCrop, IconCube, IconDocument, IconImage, IconPlay, IconRotate,
    IconSequence, IconSliders, IconVideo, IconVolume, IconWand,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { CompressSettings, ConvertSettings, ExportMode, MediaCategory, OutputMode } from "@/types";
import { AUDIO_FORMATS, IMAGE_FORMATS, MODEL_3D_FORMATS, OFFICE_FORMATS, VIDEO_FORMATS } from "@/types";

// ──────────────────────────────────────────────────────────
// Sub-component: collapsible section
// ──────────────────────────────────────────────────────────
function Section({
    icon,
    title,
    defaultOpen = false,
    children,
}: {
    icon?: React.ReactNode;
    title: string;
    defaultOpen?: boolean;
    children: React.ReactNode;
}) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2.5 bg-muted/45 hover:bg-muted transition-colors text-left"
            >
                <span className="flex items-center gap-2 text-sm font-medium">
                    {icon && <span className="text-muted-foreground">{icon}</span>}
                    {title}
                </span>
                <span className="text-muted-foreground">
                    {open ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
                </span>
            </button>
            {open && <div className="p-3 space-y-3 border-t border-border bg-card">{children}</div>}
        </div>
    );
}

// ──────────────────────────────────────────────────────────
// Sub-component: labeled row
// ──────────────────────────────────────────────────────────
function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="grid grid-cols-[128px_1fr] items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">{label}</span>
            <div>{children}</div>
        </div>
    );
}

// ──────────────────────────────────────────────────────────
// Sub-component: small text input
// ──────────────────────────────────────────────────────────
function SmallInput({
    value,
    onChange,
    placeholder,
    className,
}: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    className?: string;
}) {
    return (
        <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className={cn(
                "h-8 w-full px-2.5 rounded-md border border-input bg-background text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring/20",
                className,
            )}
        />
    );
}

function RangeRow({
    label,
    value,
    min,
    max,
    step,
    onChange,
    display,
}: {
    label: string;
    value: string;
    min: number;
    max: number;
    step: number;
    onChange: (value: string) => void;
    display?: (value: string) => string;
}) {
    return (
        <div className="grid gap-1.5 sm:grid-cols-[128px_1fr] sm:items-center sm:gap-2">
            <span className="text-xs font-medium text-muted-foreground">{label}</span>
            <div className="min-w-0 space-y-1">
                <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    className="h-1.5 w-full accent-primary"
                />
                <span className="block text-right font-mono text-[11px] leading-none text-muted-foreground whitespace-normal break-words">
                    {display ? display(value) : value}
                </span>
            </div>
        </div>
    );
}

function SlidingSegment<T extends string>({
    options,
    value,
    onChange,
    className,
    buttonClassName,
}: {
    options: Array<{ value: T; label: React.ReactNode }>;
    value: T;
    onChange: (value: T) => void;
    className?: string;
    buttonClassName?: string;
}) {
    const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
    const gapPx = 4;
    const paddingPx = 4;

    return (
        <div
            className={cn("relative grid gap-1 overflow-hidden rounded-lg bg-muted p-1", className)}
            style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
        >
            <span
                aria-hidden="true"
                className="absolute left-1 top-1 bottom-1 rounded-md border border-border bg-card shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
                style={{
                    width: `calc((100% - ${paddingPx * 2}px - ${(options.length - 1) * gapPx}px) / ${options.length})`,
                    transform: `translateX(calc(${selectedIndex * 100}% + ${selectedIndex * gapPx}px))`,
                }}
            />
            {options.map((option) => (
                <button
                    key={option.value}
                    type="button"
                    onClick={() => onChange(option.value)}
                    className={cn(
                        "relative z-10 rounded-md text-xs font-semibold text-muted-foreground transition-colors duration-200 hover:text-foreground",
                        value === option.value && "text-foreground",
                        buttonClassName,
                    )}
                >
                    {option.label}
                </button>
            ))}
        </div>
    );
}

function SimpleCompressionGoal({
    currentAction,
    convertSettings,
    compressSettings,
    onActionChange,
    onCategoryChange,
    onFormatChange,
    onCompressSettingsChange,
}: {
    currentAction: "convert" | "compress" | "convert_compress";
    convertSettings: ConvertSettings;
    compressSettings: CompressSettings;
    onActionChange: (action: "convert" | "compress" | "convert_compress") => void;
    onCategoryChange: (category: MediaCategory) => void;
    onFormatChange: (format: string) => void;
    onCompressSettingsChange: (settings: CompressSettings) => void;
}) {
    const setCp = (patch: Partial<CompressSettings>) =>
        onCompressSettingsChange({ ...compressSettings, ...patch });
    const simpleMode =
        compressSettings.mode === "size" || compressSettings.mode === "percent" || compressSettings.mode === "crf"
            ? compressSettings.mode
            : "crf";
    const usesMp4 =
        currentAction === "convert_compress" &&
        convertSettings.category === "video" &&
        convertSettings.format === "mp4";

    const chooseMp4 = () => {
        onActionChange("convert_compress");
        onCategoryChange("video");
        onFormatChange("mp4");
    };

    return (
        <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
            <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <p className="text-sm font-semibold">Sortie simple</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">MP4 compatible partout, réglages auto.</p>
                    </div>
                    <button
                        type="button"
                        onClick={chooseMp4}
                        className={cn(
                            "rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors",
                            usesMp4
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border bg-card text-foreground hover:border-primary/50",
                        )}
                    >
                        MP4
                    </button>
                </div>
            </div>

            <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Objectif
                </label>
                <SlidingSegment
                    value={simpleMode}
                    onChange={(mode) => setCp({ mode })}
                    buttonClassName="min-h-9 px-2 py-1.5"
                    options={[
                        { value: "crf", label: "Auto" },
                        { value: "percent", label: "Réduire %" },
                        { value: "size", label: "Taille MB" },
                    ]}
                />
            </div>

            {simpleMode === "crf" && (
                <div className="rounded-md border border-border bg-card p-3">
                    <p className="text-sm font-medium">Auto</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        Le convertisseur choisit une compression équilibrée sans vous demander de codec, bitrate ou CRF.
                    </p>
                </div>
            )}

            {simpleMode === "percent" && (
                <div className="rounded-md border border-border bg-card p-3">
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium">Réduction souhaitée</span>
                        <span className="font-mono text-sm font-semibold text-primary">{compressSettings.percentReduction}%</span>
                    </div>
                    <input
                        type="range"
                        min="10"
                        max="90"
                        step="5"
                        value={compressSettings.percentReduction}
                        onChange={(e) => setCp({ percentReduction: e.target.value })}
                        className="mt-3 h-1.5 w-full accent-primary"
                    />
                    <div className="mt-3 grid grid-cols-4 gap-1.5">
                        {["25", "50", "65", "80"].map((value) => (
                            <button
                                key={value}
                                type="button"
                                onClick={() => setCp({ mode: "percent", percentReduction: value })}
                                className={cn(
                                    "rounded-md border px-2 py-1.5 text-xs font-semibold transition-colors",
                                    compressSettings.percentReduction === value
                                        ? "border-primary bg-primary/10 text-primary"
                                        : "border-border text-muted-foreground hover:text-foreground",
                                )}
                            >
                                {value}%
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {simpleMode === "size" && (
                <div className="rounded-md border border-border bg-card p-3">
                    <label className="text-sm font-medium" htmlFor="simple-target-size">
                        Taille cible
                    </label>
                    <div className="mt-2 flex items-center gap-2">
                        <input
                            id="simple-target-size"
                            type="number"
                            min="1"
                            inputMode="numeric"
                            value={compressSettings.targetSizeMb}
                            onChange={(e) => setCp({ targetSizeMb: e.target.value })}
                            placeholder="30"
                            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                        />
                        <span className="text-sm font-medium text-muted-foreground">MB</span>
                    </div>
                    <div className="mt-3 grid grid-cols-4 gap-1.5">
                        {["20", "30", "50", "100"].map((value) => (
                            <button
                                key={value}
                                type="button"
                                onClick={() => setCp({ mode: "size", targetSizeMb: value })}
                                className={cn(
                                    "rounded-md border px-2 py-1.5 text-xs font-semibold transition-colors",
                                    compressSettings.targetSizeMb === value
                                        ? "border-primary bg-primary/10 text-primary"
                                        : "border-border text-muted-foreground hover:text-foreground",
                                )}
                            >
                                {value} MB
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

export function VideoColorSampler({
    file,
    color,
    onColorPicked,
    className,
}: {
    file: File | null;
    color: string;
    onColorPicked: (color: string) => void;
    className?: string;
}) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [sampleStatus, setSampleStatus] = useState<string>("Cliquez dans la vidéo pour choisir une couleur.");

    const objectUrl = useMemo(() => file ? URL.createObjectURL(file) : null, [file]);

    useEffect(() => {
        return () => {
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [objectUrl]);

    const pickColor = (event: React.MouseEvent<HTMLVideoElement>) => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas || video.videoWidth === 0 || video.videoHeight === 0) {
            setSampleStatus("La vidéo n'est pas encore prête.");
            return;
        }

        const rect = video.getBoundingClientRect();
        const scaleX = video.videoWidth / rect.width;
        const scaleY = video.videoHeight / rect.height;
        const x = Math.max(0, Math.min(video.videoWidth - 1, Math.floor((event.clientX - rect.left) * scaleX)));
        const y = Math.max(0, Math.min(video.videoHeight - 1, Math.floor((event.clientY - rect.top) * scaleY)));

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return;

        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const [red, green, blue] = context.getImageData(x, y, 1, 1).data;
        const picked = `#${[red, green, blue]
            .map((channel) => channel.toString(16).padStart(2, "0"))
            .join("")}`;
        onColorPicked(picked);
        setSampleStatus(`Couleur capturée: ${picked.toUpperCase()}`);
    };

    if (!file || !objectUrl) {
        return (
            <div className={cn("rounded-lg border border-dashed border-border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground", className)}>
                Ajoutez une vidéo dans la file pour choisir la couleur directement sur l'image.
            </div>
        );
    }

    return (
        <div className={cn("space-y-2 rounded-lg border border-border bg-muted/30 p-3", className)}>
            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Sélection depuis la vidéo
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground" title={file.name}>
                        {file.name}
                    </p>
                </div>
                <div className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1">
                    <span
                        className="h-4 w-4 rounded border border-border"
                        style={{ backgroundColor: color }}
                    />
                    <span className="font-mono text-xs">{color.toUpperCase()}</span>
                </div>
            </div>
            <video
                ref={videoRef}
                src={objectUrl}
                controls
                playsInline
                preload="metadata"
                onClick={pickColor}
                className="aspect-video w-full cursor-crosshair rounded-md border border-border bg-black object-contain"
            />
            <canvas ref={canvasRef} className="hidden" />
            <p className="text-xs leading-5 text-muted-foreground">{sampleStatus}</p>
        </div>
    );
}

// ──────────────────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────────────────
interface ConfigPanelProps {
    currentAction: "convert" | "compress" | "convert_compress";
    onActionChange: (action: "convert" | "compress" | "convert_compress") => void;
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
    exportMode: ExportMode;
    onExportModeChange: (mode: ExportMode) => void;
    detectedTypes: Array<"video" | "audio" | "image" | "document" | "3d">;
    onApplySuggestedConvert: (type: "video" | "audio" | "image") => void;
    onApplySuggestedCompress: (type: "video" | "audio" | "image") => void;
    canStart: boolean;
    isProcessing: boolean;
    onStart: () => void;
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
    video: <IconVideo size={16} />,
    audio: <IconAudio size={16} />,
    image: <IconImage size={16} />,
    sequence: <IconSequence size={16} />,
    document: <IconDocument size={16} />,
    "3d": <IconCube size={16} />,
};
const CATEGORY_LABELS: Record<string, string> = {
    video: "Vidéo",
    audio: "Audio",
    image: "Image",
    sequence: "Images → Vidéo",
    document: "Document Office",
    "3d": "Modèle 3D",
};

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
    exportMode,
    onExportModeChange,
    detectedTypes,
    onApplySuggestedConvert,
    onApplySuggestedCompress,
    canStart,
    isProcessing,
    onStart,
}: ConfigPanelProps) {
    // In Pro mode, all advanced options are always available — no inner toggle.
    const isAdvanced = true;

    const cv = convertSettings;
    const setCv = (patch: Partial<ConvertSettings>) =>
        onConvertSettingsChange({ ...convertSettings, ...patch });
    const cp = compressSettings;
    const setCp = (patch: Partial<CompressSettings>) =>
        onCompressSettingsChange({ ...compressSettings, ...patch });

    const formats =
        cv.category === "video" || cv.category === "sequence" ? VIDEO_FORMATS
        : cv.category === "audio" ? AUDIO_FORMATS
        : cv.category === "image" ? IMAGE_FORMATS
        : cv.category === "document" ? OFFICE_FORMATS
        : cv.category === "3d" ? MODEL_3D_FORMATS
        : [];

    const isVideoOrSeq = cv.category === "video" || cv.category === "sequence";
    const displaySigned = (suffix: string = "") => (value: string) => {
        const numeric = Number(value || 0);
        const sign = numeric > 0 ? "+" : "";
        return `${sign}${numeric}${suffix}`;
    };

    // ──────────────────────────────────────────────────────────
    // Tabbed options (step 4) — replaces a stack of accordions.
    // ──────────────────────────────────────────────────────────
    type TabKey = "encode" | "transform" | "edit" | "audio" | "effects" | "compress";
    const isCompressLike = currentAction === "compress" || currentAction === "convert_compress";
    const isConvertLike = currentAction === "convert" || currentAction === "convert_compress";

    const availableTabs: TabKey[] = useMemo(() => {
        const tabs: TabKey[] = [];
        if (isConvertLike && cv.category) {
            if (cv.category === "video" || cv.category === "sequence") {
                tabs.push("encode", "transform", "effects", "audio");
            } else if (cv.category === "image") {
                tabs.push("encode", "edit", "effects");
            } else if (cv.category === "audio") {
                tabs.push("encode");
            }
        }
        if (isCompressLike) tabs.push("compress");
        return tabs;
    }, [cv.category, isConvertLike, isCompressLike]);

    const [activeTab, setActiveTab] = useState<TabKey>("encode");
    useEffect(() => {
        if (availableTabs.length === 0) return;
        if (!availableTabs.includes(activeTab)) setActiveTab(availableTabs[0]);
    }, [availableTabs, activeTab]);

    const TAB_META: Record<TabKey, { label: string; icon: React.ReactNode }> = {
        encode:    { label: "Encoder",     icon: <IconSliders size={13} /> },
        transform: { label: "Transformer", icon: <IconRotate size={13} /> },
        edit:      { label: "Édition",     icon: <IconImage size={13} /> },
        audio:     { label: "Audio",       icon: <IconVolume size={13} /> },
        effects:   { label: "Effets",      icon: <IconWand size={13} /> },
        compress:  { label: "Compresser",  icon: <IconCrop size={13} /> },
    };

    return (
        <div className="flex flex-col gap-6 rounded-2xl border border-border bg-card p-6 shadow-sm lg:sticky lg:top-[76px] max-h-[calc(100vh-6rem)] overflow-y-auto">

            {/* Header */}
            <div>
                <h2 className="text-base font-semibold tracking-tight">Réglages</h2>
                <p className="mt-1 text-xs text-muted-foreground">Choisissez l'action, le type de média et le format. Les options avancées s'adaptent à votre choix.</p>
            </div>

            {/* Smart suggestions */}
            {detectedTypes.length > 0 && (
                <div className="p-3 rounded-lg border border-primary/20 bg-primary/5 space-y-2">
                    <p className="text-xs uppercase tracking-wide text-primary font-semibold flex items-center gap-1.5">
                        <IconWand size={12} /> Suggestions rapides
                    </p>
                    {detectedTypes.map((type) => (
                        <div key={type} className="flex items-center justify-between gap-2">
                            <span className="text-xs text-muted-foreground capitalize">
                                {type === "video" ? "Vidéo"
                                 : type === "audio" ? "Audio"
                                 : type === "image" ? "Image"
                                 : type === "document" ? "Document Office"
                                 : "Modèle 3D"} détecté
                            </span>
                            {(type === "video" || type === "audio" || type === "image") ? (
                                <div className="flex gap-1.5">
                                    <Button type="button" size="sm" variant="outline" className="h-6 text-xs px-2"
                                        onClick={() => onApplySuggestedConvert(type)}>
                                        Convertir
                                    </Button>
                                    <Button type="button" size="sm" variant="outline" className="h-6 text-xs px-2"
                                        onClick={() => onApplySuggestedCompress(type)}>
                                        Compresser
                                    </Button>
                                </div>
                            ) : (
                                <span className="text-xs text-muted-foreground italic">
                                    {type === "document" ? "→ PDF auto" : "→ GLB auto"}
                                </span>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Action tabs */}
            <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-[11px] font-semibold text-background">1</span>
                    Action
                </div>
                <SlidingSegment
                    value={currentAction}
                    onChange={onActionChange}
                    buttonClassName="min-h-10 px-2 py-2"
                    options={[
                        { value: "convert", label: "Convertir" },
                        { value: "compress", label: "Compresser" },
                        { value: "convert_compress", label: "Convertir + compresser" },
                    ]}
                />
            </div>

            {/* ─── CONVERT MODE ─── */}
            {(currentAction === "convert" || currentAction === "convert_compress") && (
                <div className="space-y-5">
                    {/* Category */}
                    <div className="space-y-3">
                        <label className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-foreground">2</span>
                            Type de média
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                            {(["video", "audio", "image", "sequence", "document", "3d"] as MediaCategory[]).map((cat) => (
                                <button
                                    key={cat}
                                    type="button"
                                    onClick={() => onCategoryChange(cat)}
                                    className={cn(
                                        "flex items-center gap-2.5 px-3 py-3 rounded-xl border text-sm transition-all",
                                        cv.category === cat
                                            ? "border-primary bg-primary/10 text-primary font-semibold shadow-sm"
                                            : "border-border bg-background text-muted-foreground hover:border-muted-foreground hover:text-foreground hover:bg-muted/30",
                                    )}
                                >
                                    {CATEGORY_ICONS[cat!]}
                                    <span className="text-xs">{CATEGORY_LABELS[cat!]}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Format */}
                    <div className="space-y-3">
                        <label className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-foreground">3</span>
                            Format de sortie
                        </label>
                        {formats.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                                {formats.map((fmt) => (
                                    <button
                                        key={fmt}
                                        type="button"
                                        onClick={() => onFormatChange(fmt)}
                                        className={cn(
                                            "px-3 py-2 rounded-lg text-xs font-mono font-semibold border transition-all min-w-[52px]",
                                            cv.format === fmt
                                                ? "border-primary bg-primary text-primary-foreground shadow-sm"
                                                : "border-border bg-background text-muted-foreground hover:border-muted-foreground hover:text-foreground hover:bg-muted/30",
                                        )}
                                    >
                                        {fmt === "zip" ? "ZIP" : fmt.toUpperCase()}
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <p className="text-xs text-muted-foreground italic px-1">Sélectionnez un type d'abord</p>
                        )}
                        {cv.category === "video" && cv.format === "zip" && (
                            <p className="text-xs text-muted-foreground mt-1.5 italic">
                                Extrait la vidéo en suite d'images PNG
                            </p>
                        )}
                        {cv.category === "document" && (
                            <p className="text-xs text-muted-foreground mt-1.5 italic">
                                Conversion via LibreOffice — docx, xlsx, pptx, odt, csv…
                            </p>
                        )}
                        {cv.category === "3d" && (
                            <p className="text-xs text-muted-foreground mt-1.5 italic">
                                Conversion entre formats 3D — obj, stl, ply, glb, 3mf…
                            </p>
                        )}
                    </div>

                    {/* ─── Advanced tabbed options ─── */}
                    {isAdvanced && availableTabs.filter(t => t !== "compress").length > 0 && (
                        <div className="space-y-3">
                            <label className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-foreground">4</span>
                                Options avancées
                            </label>
                            <div className="rounded-2xl border border-border bg-card/60 overflow-hidden">
                                <div className="flex items-center gap-1 px-2 pt-2 overflow-x-auto bg-muted/30 border-b border-border">
                                    {availableTabs.filter(t => t !== "compress").map(tab => (
                                        <button
                                            key={tab}
                                            type="button"
                                            onClick={() => setActiveTab(tab)}
                                            className={cn(
                                                "inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-t-lg whitespace-nowrap transition-all",
                                                activeTab === tab
                                                    ? "bg-card text-foreground shadow-sm border-x border-t border-border -mb-px"
                                                    : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                                            )}
                                        >
                                            {TAB_META[tab].icon}
                                            {TAB_META[tab].label}
                                        </button>
                                    ))}
                                </div>
                                <div key={activeTab} className="p-5 space-y-4 animate-in fade-in duration-200">

                                    {/* ───── ENCODE tab ───── */}
                                    {activeTab === "encode" && isVideoOrSeq && (
                                        <>
                                            <Row label="Codec">
                                                <Select value={cv.videoCodec} onValueChange={(v) => setCv({ videoCodec: v })}>
                                                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="libx264">H.264 (libx264)</SelectItem>
                                                        <SelectItem value="libx265">H.265 / HEVC</SelectItem>
                                                        <SelectItem value="libvpx-vp9">VP9 (WebM)</SelectItem>
                                                        <SelectItem value="libaom-av1">AV1</SelectItem>
                                                        <SelectItem value="mpeg4">MPEG-4</SelectItem>
                                                        <SelectItem value="copy">Copier (sans réencodage)</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </Row>
                                            <Row label="Preset vitesse">
                                                <Select value={cv.videoPreset} onValueChange={(v) => setCv({ videoPreset: v })}>
                                                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="ultrafast">Ultrafast (qualité ↓)</SelectItem>
                                                        <SelectItem value="superfast">Superfast</SelectItem>
                                                        <SelectItem value="veryfast">Très rapide</SelectItem>
                                                        <SelectItem value="faster">Rapide</SelectItem>
                                                        <SelectItem value="fast">Fast</SelectItem>
                                                        <SelectItem value="medium">Medium (défaut)</SelectItem>
                                                        <SelectItem value="slow">Slow (qualité ↑)</SelectItem>
                                                        <SelectItem value="slower">Slower</SelectItem>
                                                        <SelectItem value="veryslow">Veryslow</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </Row>
                                            <Row label="Qualité (CRF)">
                                                <div className="flex items-center gap-2">
                                                    <input type="range" min="0" max="51" step="1" value={cv.videoCrf}
                                                        onChange={(e) => setCv({ videoCrf: e.target.value })}
                                                        className="flex-1 h-1.5 accent-primary" />
                                                    <span className="text-xs w-6 text-center font-mono">{cv.videoCrf}</span>
                                                </div>
                                                <p className="text-xs text-muted-foreground mt-0.5">0 = meilleure qualité · 51 = pire</p>
                                            </Row>
                                            <Row label="FPS sortie">
                                                <Select value={cv.videoFps} onValueChange={(v) => setCv({ videoFps: v })}>
                                                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="original">Original</SelectItem>
                                                        {["60", "30", "25", "24", "15", "10"].map((f) => (
                                                            <SelectItem key={f} value={f}>{f} fps</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </Row>
                                            <Row label="Résolution">
                                                <div className="flex items-center gap-1.5">
                                                    <SmallInput value={cv.videoResizeWidth} onChange={(v) => setCv({ videoResizeWidth: v })} placeholder="Largeur" />
                                                    <span className="text-xs text-muted-foreground">×</span>
                                                    <SmallInput value={cv.videoResizeHeight} onChange={(v) => setCv({ videoResizeHeight: v })} placeholder="Hauteur" />
                                                </div>
                                            </Row>
                                            {cv.category === "sequence" && (
                                                <Row label="FPS de la séquence">
                                                    <Select value={cv.sequenceFps} onValueChange={(v) => setCv({ sequenceFps: v })}>
                                                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                                        <SelectContent>
                                                            {["1", "2", "5", "10", "15", "24", "25", "30", "60"].map((f) => (
                                                                <SelectItem key={f} value={f}>{f} fps</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </Row>
                                            )}
                                            <Row label="HDR → SDR">
                                                <Switch checked={cv.videoHDRtoSDR} onCheckedChange={(v) => setCv({ videoHDRtoSDR: v })} />
                                            </Row>
                                            <Row label="Retirer l'audio">
                                                <Switch checked={cv.videoRemoveAudio} onCheckedChange={(v) => setCv({ videoRemoveAudio: v })} />
                                            </Row>
                                        </>
                                    )}

                                    {activeTab === "encode" && cv.category === "audio" && (
                                        <>
                                            <Row label="Codec">
                                                <Select value={cv.audioCodec} onValueChange={(v) => setCv({ audioCodec: v })}>
                                                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="auto">Auto (selon format)</SelectItem>
                                                        <SelectItem value="aac">AAC</SelectItem>
                                                        <SelectItem value="libmp3lame">MP3</SelectItem>
                                                        <SelectItem value="libopus">Opus</SelectItem>
                                                        <SelectItem value="libvorbis">Vorbis</SelectItem>
                                                        <SelectItem value="flac">FLAC (lossless)</SelectItem>
                                                        <SelectItem value="pcm_s16le">WAV PCM 16-bit</SelectItem>
                                                        <SelectItem value="copy">Copier (sans réencodage)</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </Row>
                                            <Row label="Bitrate">
                                                <Select value={cv.audioBitrate} onValueChange={(v) => setCv({ audioBitrate: v })}>
                                                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        {["64k", "96k", "128k", "160k", "192k", "256k", "320k"].map((b) => (
                                                            <SelectItem key={b} value={b}>{b}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </Row>
                                            <Row label="Volume (dB)">
                                                <div className="flex items-center gap-2">
                                                    <input type="range" min="-20" max="20" step="0.5" value={cv.audioVolume}
                                                        onChange={(e) => setCv({ audioVolume: e.target.value })}
                                                        className="flex-1 h-1.5 accent-primary" />
                                                    <span className="text-xs w-10 text-right font-mono">
                                                        {parseFloat(cv.audioVolume) >= 0 ? "+" : ""}{cv.audioVolume} dB
                                                    </span>
                                                </div>
                                            </Row>
                                            <Row label="Normaliser">
                                                <Switch checked={cv.audioNormalize} onCheckedChange={(v) => setCv({ audioNormalize: v })} />
                                            </Row>
                                        </>
                                    )}

                                    {activeTab === "encode" && cv.category === "image" && (
                                        <>
                                            <Row label="Qualité">
                                                <div className="flex items-center gap-2">
                                                    <input type="range" min="1" max="100" step="1"
                                                        value={cv.imageQuality === "lossless" ? "100" : cv.imageQuality}
                                                        onChange={(e) => setCv({ imageQuality: e.target.value })}
                                                        className="flex-1 h-1.5 accent-primary" />
                                                    <span className="text-xs w-6 text-center font-mono">{cv.imageQuality}</span>
                                                </div>
                                            </Row>
                                            <Row label="Redimensionner">
                                                <Select value={cv.imageResizeMode} onValueChange={(v) => setCv({ imageResizeMode: v as ConvertSettings["imageResizeMode"] })}>
                                                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="none">Aucun</SelectItem>
                                                        <SelectItem value="dimension">Dimension max (px)</SelectItem>
                                                        <SelectItem value="percent">Pourcentage (%)</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </Row>
                                            {cv.imageResizeMode === "dimension" && (
                                                <Row label="Taille max (px)">
                                                    <SmallInput value={cv.imageMaxSize} onChange={(v) => setCv({ imageMaxSize: v })} placeholder="ex: 1920" />
                                                </Row>
                                            )}
                                            {cv.imageResizeMode === "percent" && (
                                                <Row label="Réduction (%)">
                                                    <SmallInput value={cv.imageResizePercent} onChange={(v) => setCv({ imageResizePercent: v })} placeholder="75" />
                                                </Row>
                                            )}
                                            {cv.format === "ico" && (
                                                <Row label="Taille ICO">
                                                    <Select value={cv.icoSize} onValueChange={(v) => setCv({ icoSize: v })}>
                                                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                                        <SelectContent>
                                                            {["16", "32", "48", "64", "128", "256"].map((s) => (
                                                                <SelectItem key={s} value={s}>{s}×{s}px</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </Row>
                                            )}
                                            <div className="pt-2 border-t border-border">
                                                <Row label="Upscaler">
                                                    <Select value={cv.imageUpscale} onValueChange={(v) => setCv({ imageUpscale: v })}>
                                                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="1">Aucun (taille originale)</SelectItem>
                                                            <SelectItem value="2">×2 (Lanczos)</SelectItem>
                                                            <SelectItem value="3">×3 (Lanczos)</SelectItem>
                                                            <SelectItem value="4">×4 (Lanczos)</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </Row>
                                                <p className="text-[11px] text-muted-foreground italic mt-1">
                                                    Agrandit l'image avec interpolation Lanczos. Pour de l'IA upscaling (ESRGAN), il faudrait un modèle externe.
                                                </p>
                                            </div>
                                        </>
                                    )}

                                    {/* ───── TRANSFORM tab (video / sequence) ───── */}
                                    {activeTab === "transform" && isVideoOrSeq && (
                                        <>
                                            <Row label="Rotation">
                                                <Select value={cv.videoRotate} onValueChange={(v) => setCv({ videoRotate: v as ConvertSettings["videoRotate"] })}>
                                                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="none">Aucune</SelectItem>
                                                        <SelectItem value="90">90° horaire</SelectItem>
                                                        <SelectItem value="180">180°</SelectItem>
                                                        <SelectItem value="270">90° anti-horaire</SelectItem>
                                                        <SelectItem value="hflip">Miroir horizontal</SelectItem>
                                                        <SelectItem value="vflip">Miroir vertical</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </Row>
                                            <Row label="Débruitage">
                                                <Select value={cv.videoDenoise} onValueChange={(v) => setCv({ videoDenoise: v as ConvertSettings["videoDenoise"] })}>
                                                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="none">Aucun</SelectItem>
                                                        <SelectItem value="light">Léger</SelectItem>
                                                        <SelectItem value="medium">Moyen</SelectItem>
                                                        <SelectItem value="strong">Fort</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </Row>
                                            <div>
                                                <p className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1">
                                                    <IconCrop size={11} /> Rogner (px à supprimer)
                                                </p>
                                                <div className="grid grid-cols-2 gap-1.5">
                                                    <SmallInput value={cv.videoCropTop} onChange={(v) => setCv({ videoCropTop: v })} placeholder="Haut" />
                                                    <SmallInput value={cv.videoCropBottom} onChange={(v) => setCv({ videoCropBottom: v })} placeholder="Bas" />
                                                    <SmallInput value={cv.videoCropLeft} onChange={(v) => setCv({ videoCropLeft: v })} placeholder="Gauche" />
                                                    <SmallInput value={cv.videoCropRight} onChange={(v) => setCv({ videoCropRight: v })} placeholder="Droite" />
                                                </div>
                                            </div>
                                            {cv.category === "video" && cv.format === "gif" && (
                                                <div className="space-y-3 rounded-md border border-border bg-muted/30 p-2.5">
                                                    <p className="text-xs font-semibold text-foreground">Paramètres GIF</p>
                                                    <Row label="Vitesse">
                                                        <Select value={cv.gifSpeed} onValueChange={(v) => setCv({ gifSpeed: v })}>
                                                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="1.0">Normal (1×)</SelectItem>
                                                                <SelectItem value="0.5">2× plus rapide</SelectItem>
                                                                <SelectItem value="0.25">4× plus rapide</SelectItem>
                                                                <SelectItem value="0.1">10× plus rapide</SelectItem>
                                                                <SelectItem value="2.0">2× plus lent</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </Row>
                                                    <Row label="FPS GIF">
                                                        <Select value={cv.gifFps} onValueChange={(v) => setCv({ gifFps: v })}>
                                                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                                            <SelectContent>
                                                                {["5", "10", "15", "20", "24", "30"].map((f) => (
                                                                    <SelectItem key={f} value={f}>{f} fps</SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    </Row>
                                                    <Row label="Couleurs">
                                                        <Select value={cv.gifColors} onValueChange={(v) => setCv({ gifColors: v })}>
                                                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                                            <SelectContent>
                                                                {["256", "192", "128", "96", "64", "32", "16"].map((c) => (
                                                                    <SelectItem key={c} value={c}>{c} couleurs</SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    </Row>
                                                    <Row label="Dithering">
                                                        <Select value={cv.gifDither} onValueChange={(v) => setCv({ gifDither: v })}>
                                                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="sierra2_4a">Sierra2_4a (recommandé)</SelectItem>
                                                                <SelectItem value="floyd_steinberg">Floyd-Steinberg</SelectItem>
                                                                <SelectItem value="bayer">Bayer</SelectItem>
                                                                <SelectItem value="none">Aucun</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </Row>
                                                    <Row label="Boucle">
                                                        <Select value={cv.gifLoop} onValueChange={(v) => setCv({ gifLoop: v })}>
                                                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="0">Infini</SelectItem>
                                                                <SelectItem value="1">1 fois</SelectItem>
                                                                <SelectItem value="2">2 fois</SelectItem>
                                                                <SelectItem value="3">3 fois</SelectItem>
                                                                <SelectItem value="5">5 fois</SelectItem>
                                                                <SelectItem value="10">10 fois</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </Row>
                                                </div>
                                            )}
                                        </>
                                    )}

                                    {/* ───── EDIT tab (image — photo edits) ───── */}
                                    {activeTab === "edit" && cv.category === "image" && (
                                        <div className="space-y-3">
                                            <RangeRow label="Exposition" value={cv.photoExposure} min={-3} max={3} step={0.1} onChange={(v) => setCv({ photoExposure: v })} display={(v) => `${Number(v).toFixed(1)} EV`} />
                                            <RangeRow label="Contraste" value={cv.photoContrast} min={-100} max={100} step={1} onChange={(v) => setCv({ photoContrast: v })} display={displaySigned("%")} />
                                            <RangeRow label="Hautes lumières" value={cv.photoHighlights} min={-100} max={100} step={1} onChange={(v) => setCv({ photoHighlights: v })} display={displaySigned("%")} />
                                            <RangeRow label="Ombres" value={cv.photoShadows} min={-100} max={100} step={1} onChange={(v) => setCv({ photoShadows: v })} display={displaySigned("%")} />
                                            <RangeRow label="Blancs" value={cv.photoWhites} min={-100} max={100} step={1} onChange={(v) => setCv({ photoWhites: v })} display={displaySigned("%")} />
                                            <RangeRow label="Noirs" value={cv.photoBlacks} min={-100} max={100} step={1} onChange={(v) => setCv({ photoBlacks: v })} display={displaySigned("%")} />
                                            <RangeRow label="Température" value={cv.photoTemperature} min={-100} max={100} step={1} onChange={(v) => setCv({ photoTemperature: v })} display={displaySigned("%")} />
                                            <RangeRow label="Teinte" value={cv.photoTint} min={-100} max={100} step={1} onChange={(v) => setCv({ photoTint: v })} display={displaySigned("%")} />
                                            <RangeRow label="Saturation" value={cv.photoSaturation} min={-100} max={100} step={1} onChange={(v) => setCv({ photoSaturation: v })} display={displaySigned("%")} />
                                            <RangeRow label="Netteté" value={cv.photoSharpness} min={-100} max={100} step={1} onChange={(v) => setCv({ photoSharpness: v })} display={displaySigned("%")} />
                                        </div>
                                    )}

                                    {/* ───── AUDIO tab (video) ───── */}
                                    {activeTab === "audio" && isVideoOrSeq && (
                                        <>
                                            <Row label="Codec">
                                                <Select value={cv.audioCodec} onValueChange={(v) => setCv({ audioCodec: v })}>
                                                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="auto">Auto (selon format)</SelectItem>
                                                        <SelectItem value="aac">AAC</SelectItem>
                                                        <SelectItem value="libmp3lame">MP3</SelectItem>
                                                        <SelectItem value="libopus">Opus</SelectItem>
                                                        <SelectItem value="libvorbis">Vorbis</SelectItem>
                                                        <SelectItem value="copy">Copier (sans réencodage)</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </Row>
                                            <Row label="Bitrate">
                                                <Select value={cv.audioBitrate} onValueChange={(v) => setCv({ audioBitrate: v })}>
                                                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        {["64k", "96k", "128k", "160k", "192k", "256k", "320k"].map((b) => (
                                                            <SelectItem key={b} value={b}>{b}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </Row>
                                            <Row label="Volume (dB)">
                                                <div className="flex items-center gap-2">
                                                    <input type="range" min="-20" max="20" step="0.5" value={cv.audioVolume}
                                                        onChange={(e) => setCv({ audioVolume: e.target.value })}
                                                        className="flex-1 h-1.5 accent-primary" />
                                                    <span className="text-xs w-10 text-right font-mono">
                                                        {parseFloat(cv.audioVolume) >= 0 ? "+" : ""}{cv.audioVolume} dB
                                                    </span>
                                                </div>
                                            </Row>
                                            <Row label="Normaliser">
                                                <Switch checked={cv.audioNormalize} onCheckedChange={(v) => setCv({ audioNormalize: v })} />
                                            </Row>
                                        </>
                                    )}

                                    {/* ───── EFFECTS tab (video, image, sequence) ───── */}
                                    {activeTab === "effects" && (
                                        <div className="space-y-3">
                                            {/* Video color grading */}
                                            {isVideoOrSeq && (
                                                <div className="rounded-md border border-border bg-muted/30 p-2.5 space-y-2.5">
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-xs font-semibold flex items-center gap-1.5">
                                                            <IconWand size={12} /> Étalonnage couleur (créer un look)
                                                        </span>
                                                        <button
                                                            type="button"
                                                            onClick={() => setCv({
                                                                videoExposure: "0", videoContrast: "0",
                                                                videoSaturation: "0", videoTemperature: "0", videoHue: "0",
                                                            })}
                                                            className="text-[10px] text-muted-foreground hover:text-destructive"
                                                        >
                                                            Reset
                                                        </button>
                                                    </div>
                                                    <RangeRow label="Exposition" value={cv.videoExposure} min={-2} max={2} step={0.1} onChange={(v) => setCv({ videoExposure: v })} display={(v) => `${Number(v).toFixed(1)} EV`} />
                                                    <RangeRow label="Contraste" value={cv.videoContrast} min={-100} max={100} step={1} onChange={(v) => setCv({ videoContrast: v })} display={displaySigned("%")} />
                                                    <RangeRow label="Saturation" value={cv.videoSaturation} min={-100} max={100} step={1} onChange={(v) => setCv({ videoSaturation: v })} display={displaySigned("%")} />
                                                    <RangeRow label="Température" value={cv.videoTemperature} min={-100} max={100} step={1} onChange={(v) => setCv({ videoTemperature: v })} display={(v) => `${displaySigned("")(v)} (froid↔chaud)`} />
                                                    <RangeRow label="Teinte (°)" value={cv.videoHue} min={-180} max={180} step={1} onChange={(v) => setCv({ videoHue: v })} display={(v) => `${displaySigned("°")(v)}`} />
                                                    <p className="text-[11px] text-muted-foreground italic">Les réglages sont appliqués par FFmpeg (eq + colortemperature + hue).</p>
                                                </div>
                                            )}

                                            {/* Color remover */}
                                            <div className="rounded-md border border-border bg-muted/30 p-2.5 space-y-2">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-xs font-semibold flex items-center gap-1.5">
                                                        <IconWand size={12} /> Retirer une couleur
                                                    </span>
                                                    <Switch
                                                        checked={cv.colorRemoveEnabled}
                                                        onCheckedChange={(v) => setCv({ colorRemoveEnabled: v })}
                                                    />
                                                </div>
                                                {cv.colorRemoveEnabled && (
                                                    <>
                                                        <div className="flex items-center gap-2">
                                                            <input type="color" value={cv.colorRemoveColor}
                                                                onChange={(e) => setCv({ colorRemoveColor: e.target.value })}
                                                                className="h-8 w-10 rounded border border-input bg-background cursor-pointer" />
                                                            <SmallInput
                                                                value={cv.colorRemoveColor}
                                                                onChange={(v) => setCv({ colorRemoveColor: v })}
                                                                placeholder="#ffffff"
                                                            />
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-xs text-muted-foreground w-20">Tolérance</span>
                                                            <input type="range" min="0" max="100" step="1"
                                                                value={cv.colorRemoveTolerance}
                                                                onChange={(e) => setCv({ colorRemoveTolerance: e.target.value })}
                                                                className="flex-1 h-1.5 accent-primary" />
                                                            <span className="text-xs w-8 text-right font-mono">{cv.colorRemoveTolerance}%</span>
                                                        </div>
                                                        <p className="text-[11px] text-muted-foreground italic">
                                                            {cv.category === "image"
                                                                ? "Sortie PNG/WebP pour préserver la transparence."
                                                                : "Sortie WebM/MOV pour préserver la transparence."}
                                                        </p>
                                                    </>
                                                )}
                                            </div>

                                            {/* Video-only: trim + overlay + LUT */}
                                            {cv.category === "video" && (
                                                <>
                                                    <div className="rounded-md border border-border bg-muted/30 p-2.5 space-y-2">
                                                        <p className="text-xs font-semibold">Trim</p>
                                                        <Row label="Début">
                                                            <SmallInput value={cv.videoTrimStart} onChange={(v) => setCv({ videoTrimStart: v })} placeholder="00:00:05" />
                                                        </Row>
                                                        <Row label="Fin">
                                                            <SmallInput value={cv.videoTrimEnd} onChange={(v) => setCv({ videoTrimEnd: v })} placeholder="00:01:30" />
                                                        </Row>
                                                    </div>
                                                    <div className="rounded-md border border-border bg-muted/30 p-2.5 space-y-2">
                                                        <p className="text-xs font-semibold">Texte incrusté</p>
                                                        <SmallInput value={cv.overlayText} onChange={(v) => setCv({ overlayText: v })} placeholder="Texte à afficher…" />
                                                        {cv.overlayText && (
                                                            <div className="grid grid-cols-2 gap-1.5">
                                                                <SmallInput value={cv.overlayTextX} onChange={(v) => setCv({ overlayTextX: v })} placeholder="X" />
                                                                <SmallInput value={cv.overlayTextY} onChange={(v) => setCv({ overlayTextY: v })} placeholder="Y" />
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="rounded-md border border-border bg-muted/30 p-2.5 space-y-2">
                                                        <p className="text-xs font-semibold">LUT colorimétrique (.cube)</p>
                                                        {cv.lutFile ? (
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-xs text-emerald-400 truncate flex-1">{cv.lutFile.name}</span>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setCv({ lutFile: null })}
                                                                    className="text-xs text-muted-foreground hover:text-destructive px-1.5 py-0.5 rounded border border-border"
                                                                >
                                                                    ✕
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <label className="flex items-center gap-2 h-8 px-3 rounded-md border border-dashed border-border bg-muted/20 hover:border-primary/50 cursor-pointer transition-colors">
                                                                <span className="text-xs text-muted-foreground">Choisir un fichier .cube…</span>
                                                                <input type="file" accept=".cube" className="hidden"
                                                                    onChange={(e) => {
                                                                        const f = e.target.files?.[0] || null;
                                                                        setCv({ lutFile: f });
                                                                        e.target.value = "";
                                                                    }}
                                                                />
                                                            </label>
                                                        )}
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    )}

                                </div>
                            </div>
                        </div>
                    )}

                    {/* Color remover quick-toggle for non-advanced mode */}
                    {!isAdvanced && (cv.category === "image" || cv.category === "video" || cv.category === "sequence") && (
                        <Section icon={<IconWand size={14} />} title="Retirer une couleur" defaultOpen={false}>
                            <Row label="Activer">
                                <Switch
                                    checked={cv.colorRemoveEnabled}
                                    onCheckedChange={(v) => setCv({ colorRemoveEnabled: v })}
                                />
                            </Row>
                            {cv.colorRemoveEnabled && (
                                <>
                                    <Row label="Couleur">
                                        <div className="flex items-center gap-2">
                                            <input type="color" value={cv.colorRemoveColor}
                                                onChange={(e) => setCv({ colorRemoveColor: e.target.value })}
                                                className="h-8 w-10 rounded border border-input bg-background cursor-pointer" />
                                            <SmallInput value={cv.colorRemoveColor}
                                                onChange={(v) => setCv({ colorRemoveColor: v })}
                                                placeholder="#ffffff" />
                                        </div>
                                    </Row>
                                    <Row label="Tolérance">
                                        <div className="flex items-center gap-2">
                                            <input type="range" min="0" max="100" step="1"
                                                value={cv.colorRemoveTolerance}
                                                onChange={(e) => setCv({ colorRemoveTolerance: e.target.value })}
                                                className="flex-1 h-1.5 accent-primary" />
                                            <span className="text-xs w-8 text-right font-mono">{cv.colorRemoveTolerance}%</span>
                                        </div>
                                    </Row>
                                </>
                            )}
                        </Section>
                    )}
                </div>
            )}

            {/* ─── COMPRESS MODE ─── */}
            {(currentAction === "compress" || currentAction === "convert_compress") && (
                <div className="space-y-3">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-foreground">
                            {currentAction === "compress" ? "2" : "4"}
                        </span>
                        Objectif de compression
                    </label>

                    {!isAdvanced ? (
                        <SimpleCompressionGoal
                            currentAction={currentAction}
                            convertSettings={convertSettings}
                            compressSettings={compressSettings}
                            onActionChange={onActionChange}
                            onCategoryChange={onCategoryChange}
                            onFormatChange={onFormatChange}
                            onCompressSettingsChange={onCompressSettingsChange}
                        />
                    ) : (
                        <>
                            <div className="space-y-2">
                                <label className="text-xs text-muted-foreground block">Mode de compression</label>
                                <div className="grid grid-cols-2 gap-1.5">
                                    {([
                                        { value: "crf", label: "Auto" },
                                        { value: "size", label: "Taille cible" },
                                        { value: "percent", label: "Réduction %" },
                                        { value: "res", label: "Résolution" },
                                    ] as { value: CompressSettings["mode"]; label: string }[]).map(({ value, label }) => (
                                        <button
                                            key={value}
                                            type="button"
                                            onClick={() => setCp({ mode: value })}
                                            className={cn(
                                                "px-3 py-2.5 rounded-lg border text-xs font-semibold transition-all",
                                                cp.mode === value
                                                    ? "border-primary bg-primary/10 text-primary"
                                                    : "border-border bg-background text-muted-foreground hover:border-muted-foreground hover:text-foreground",
                                            )}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {cp.mode === "crf" && (
                                <div>
                                    <label className="text-xs text-muted-foreground block mb-1.5">Profil automatique</label>
                                    <SlidingSegment
                                        value={cp.crfLevel}
                                        onChange={(level) => setCp({ crfLevel: level })}
                                        buttonClassName="py-1.5 px-2"
                                        options={[
                                            { value: "low", label: "Qualité max" },
                                            { value: "medium", label: "Auto" },
                                            { value: "high", label: "Fichier léger" },
                                        ]}
                                    />
                                </div>
                            )}
                            {cp.mode === "size" && (
                                <Row label="Taille cible (MB)">
                                    <SmallInput value={cp.targetSizeMb} onChange={(v) => setCp({ targetSizeMb: v })} placeholder="ex: 50" />
                                </Row>
                            )}
                            {cp.mode === "percent" && (
                                <Row label="Réduction (%)">
                                    <div className="flex items-center gap-2">
                                        <input type="range" min="10" max="90" step="5"
                                            value={cp.percentReduction}
                                            onChange={(e) => setCp({ percentReduction: e.target.value })}
                                            className="flex-1 h-1.5 accent-primary" />
                                        <span className="text-xs w-8 text-right font-mono">{cp.percentReduction}%</span>
                                    </div>
                                </Row>
                            )}
                            {cp.mode === "res" && (
                                <Row label="Résolution max">
                                    <Select value={cp.resolution} onValueChange={(v) => setCp({ resolution: v })}>
                                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {["360", "480", "720", "1080", "1440", "2160"].map((r) => (
                                                <SelectItem key={r} value={r}>{r}p</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </Row>
                            )}
                        </>
                    )}

                    {isAdvanced && (
                        <div className="rounded-xl border border-border bg-card/60 p-3 space-y-3">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold flex items-center gap-1.5">
                                    <IconSliders size={12} /> Paramètres techniques
                                </span>
                                <Switch checked={cp.advancedEnabled} onCheckedChange={(v) => setCp({ advancedEnabled: v })} />
                            </div>
                            {cp.advancedEnabled && (
                                <div className="space-y-3 pt-1 border-t border-border">
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="space-y-1.5">
                                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Codec vidéo</span>
                                            <Select value={cp.videoCodec} onValueChange={(v) => setCp({ videoCodec: v })}>
                                                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="libx264">H.264</SelectItem>
                                                    <SelectItem value="libx265">H.265 / HEVC</SelectItem>
                                                    <SelectItem value="libvpx-vp9">VP9</SelectItem>
                                                    <SelectItem value="libaom-av1">AV1</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-1.5">
                                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Preset</span>
                                            <Select value={cp.preset} onValueChange={(v) => setCp({ preset: v })}>
                                                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    {["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"].map((p) => (
                                                        <SelectItem key={p} value={p}>{p}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-1.5">
                                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Qualité</span>
                                            <Select value={cp.qualityMode} onValueChange={(v) => setCp({ qualityMode: v as CompressSettings["qualityMode"] })}>
                                                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="auto">Auto</SelectItem>
                                                    <SelectItem value="crf">CRF</SelectItem>
                                                    <SelectItem value="bitrate">Bitrate</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-1.5">
                                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">FPS</span>
                                            <Select value={cp.fps} onValueChange={(v) => setCp({ fps: v })}>
                                                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="original">Original</SelectItem>
                                                    {["60", "30", "25", "24", "15", "10"].map((f) => (
                                                        <SelectItem key={f} value={f}>{f} fps</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>

                                    {cp.qualityMode === "crf" && (
                                        <Row label="CRF">
                                            <div className="flex items-center gap-2">
                                                <input type="range" min="0" max="51" step="1"
                                                    value={cp.videoCrf}
                                                    onChange={(e) => setCp({ videoCrf: e.target.value })}
                                                    className="flex-1 h-1.5 accent-primary" />
                                                <span className="text-xs w-6 text-center font-mono">{cp.videoCrf}</span>
                                            </div>
                                        </Row>
                                    )}
                                    {cp.qualityMode === "bitrate" && (
                                        <Row label="Bitrate (kbps)">
                                            <SmallInput value={cp.videoBitrateK} onChange={(v) => setCp({ videoBitrateK: v })} placeholder="2500" />
                                        </Row>
                                    )}

                                    <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border">
                                        <div className="space-y-1.5">
                                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Codec audio</span>
                                            <Select value={cp.audioCodec} onValueChange={(v) => setCp({ audioCodec: v })}>
                                                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="original">Original</SelectItem>
                                                    <SelectItem value="aac">AAC</SelectItem>
                                                    <SelectItem value="libmp3lame">MP3</SelectItem>
                                                    <SelectItem value="libopus">Opus</SelectItem>
                                                    <SelectItem value="copy">Copier</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-1.5">
                                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Bitrate audio</span>
                                            <Select value={cp.audioBitrate} onValueChange={(v) => setCp({ audioBitrate: v })}>
                                                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="original">Original</SelectItem>
                                                    {["64k", "96k", "128k", "160k", "192k", "256k", "320k"].map((b) => (
                                                        <SelectItem key={b} value={b}>{b}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>

                                    <div className="space-y-2 pt-1 border-t border-border">
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs">Résolution max</span>
                                            <div className="flex items-center gap-1.5">
                                                <SmallInput className="w-20" value={cp.videoResizeWidth} onChange={(v) => setCp({ videoResizeWidth: v })} placeholder="L" />
                                                <span className="text-xs text-muted-foreground">×</span>
                                                <SmallInput className="w-20" value={cp.videoResizeHeight} onChange={(v) => setCp({ videoResizeHeight: v })} placeholder="H" />
                                            </div>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs">Taille image max</span>
                                            <SmallInput className="w-28" value={cp.imageMaxSize} onChange={(v) => setCp({ imageMaxSize: v })} placeholder="1920" />
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs">2-pass encoding</span>
                                            <Switch checked={cp.twoPass} onCheckedChange={(v) => setCp({ twoPass: v })} />
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs">Faststart (streaming)</span>
                                            <Switch checked={cp.faststart} onCheckedChange={(v) => setCp({ faststart: v })} />
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs">Désentrelacement</span>
                                            <Switch checked={cp.deinterlace} onCheckedChange={(v) => setCp({ deinterlace: v })} />
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* ─── Global options ─── */}
            <div className="border-t border-border pt-5 space-y-4">
                {isAdvanced && <div className="space-y-2">
                    <label className="text-xs text-muted-foreground uppercase tracking-wide font-semibold block">
                        Mode de sortie
                    </label>
                    <SlidingSegment
                        value={outputMode}
                        onChange={onOutputModeChange}
                        buttonClassName="py-2 px-3"
                        options={[
                            { value: "global", label: "Tous pareils" },
                            { value: "per-file", label: "Par fichier" },
                        ]}
                    />
                </div>}

                <div className="space-y-3 rounded-xl border border-border bg-muted/35 p-4">
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-xs font-medium">Export</span>
                        <Select value={exportMode} onValueChange={(v) => onExportModeChange(v as ExportMode)}>
                            <SelectTrigger className="h-9 w-[140px] bg-card text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="zip">ZIP</SelectItem>
                                <SelectItem value="files">Fichiers</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">Traitement arrière-plan</span>
                        <Switch checked={backgroundEnabled} onCheckedChange={onBackgroundEnabledChange} />
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">Téléchargement auto</span>
                        <Switch checked={autoDownloadEnabled} onCheckedChange={onAutoDownloadEnabledChange} />
                    </div>
                </div>
            </div>

            {/* ─── Start button ─── */}
            <Button
                onClick={onStart}
                disabled={!canStart || isProcessing}
                className="w-full h-12 text-sm font-semibold gap-2 shadow-sm rounded-xl"
            >
                <IconPlay size={16} />
                {isProcessing
                    ? "Traitement en cours…"
                    : currentAction === "convert"
                        ? "Démarrer la conversion"
                        : currentAction === "compress"
                            ? "Démarrer la compression"
                            : "Démarrer conversion + compression"}
            </Button>
        </div>
    );
}
