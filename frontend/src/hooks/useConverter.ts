import type {
    CompressSettings,
    ConvertSettings,
    ExportMode,
    JobResponse,
    MediaCategory,
  OutputMode,
    QueueItem,
} from "@/types";
import {
    AUDIO_FORMATS,
    IMAGE_FORMATS,
    VIDEO_FORMATS,
    getFileType,
} from "@/types";
import { useCallback, useEffect, useRef, useState } from "react";

const MAX_CONCURRENT_UPLOADS = 1;
const POLL_INTERVAL_MS = 1500;
const UPLOAD_RETRY_DELAY_MS = 1500;
const MAX_UPLOAD_RETRIES = 120;
const LS_BACKGROUND = "converter_background_enabled";
const LS_AUTODOWNLOAD = "converter_autodownload_enabled";
const LS_EXPORT_MODE = "converter_export_mode";
const LS_UI_MODE = "converter_ui_mode";
const LS_DOWNLOADED_BUNDLES = "converter_downloaded_bundle_signatures";
// Tracks job IDs submitted by this user — used to restore background jobs on reload
const LS_TRACKED_JOBS = "converter_tracked_job_ids";

type DetectedMediaType = "video" | "audio" | "image" | "document" | "3d";
type ActionMode = "convert" | "compress" | "convert_compress";

const DEFAULT_CONVERT_FORMAT: Record<DetectedMediaType, string> = {
  video: "mp4",
  audio: "mp3",
  image: "jpg",
  document: "pdf",
  "3d": "glb",
};

const DEFAULT_SEQUENCE_FORMAT = "mp4";

const DEFAULT_COMPRESS_TARGET_MB: Record<DetectedMediaType, string> = {
  video: "50",
  audio: "8",
  image: "2",
  document: "5",
  "3d": "5",
};

function generateId(): string {
  return Math.random().toString(36).substring(7);
}

function lsGetBool(key: string, defaultVal: boolean): boolean {
  const raw = localStorage.getItem(key);
  if (raw === null) return defaultVal;
  return raw === "true";
}

function lsGetSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function lsSaveSet(key: string, set: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(set)));
  } catch {
    // localStorage may be full, ignore
  }
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function useConverter() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [currentAction, setCurrentAction] = useState<ActionMode>(
    "convert",
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [outputMode, setOutputMode] = useState<OutputMode>("global");
  const [backgroundEnabled, setBackgroundEnabledState] = useState(() =>
    lsGetBool(LS_BACKGROUND, true)
  );
  const [autoDownloadEnabled, setAutoDownloadEnabledState] = useState(() =>
    lsGetBool(LS_AUTODOWNLOAD, true)
  );
  const [exportMode, setExportModeState] = useState<ExportMode>(() => {
    const raw = localStorage.getItem(LS_EXPORT_MODE);
    return raw === "files" ? "files" : "zip";
  });
  const [uiMode, setUiModeState] = useState<"simple" | "pro" | "color-lab">(() => {
    const raw = localStorage.getItem(LS_UI_MODE);
    if (raw === "pro" || raw === "color-lab") return raw;
    return "simple";
  });
  const pollingRef = useRef<number | null>(null);
  const uploadingRef = useRef(false);
  // Load downloaded bundle signatures from localStorage so we don't re-download on reload
  const downloadedBundleSignaturesRef = useRef<Set<string>>(
    lsGetSet(LS_DOWNLOADED_BUNDLES),
  );
  // Tracked job IDs: jobs submitted by this user (restored on background reload)
  const trackedJobIdsRef = useRef<Set<string>>(lsGetSet(LS_TRACKED_JOBS));

  const setBackgroundEnabled = useCallback((val: boolean) => {
    localStorage.setItem(LS_BACKGROUND, String(val));
    setBackgroundEnabledState(val);
  }, []);

  const setAutoDownloadEnabled = useCallback((val: boolean) => {
    localStorage.setItem(LS_AUTODOWNLOAD, String(val));
    setAutoDownloadEnabledState(val);
  }, []);

  const setExportMode = useCallback((val: ExportMode) => {
    localStorage.setItem(LS_EXPORT_MODE, val);
    setExportModeState(val);
  }, []);

  const setUiMode = useCallback((val: "simple" | "pro" | "color-lab") => {
    localStorage.setItem(LS_UI_MODE, val);
    setUiModeState(val);
  }, []);

  const triggerBrowserDownload = useCallback((href: string, filename?: string) => {
    const link = document.createElement("a");
    link.href = href;
    if (filename) {
      link.download = filename;
    }
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, []);

  const exportCompletedFiles = useCallback(() => {
    const doneItems = queue.filter(
      (item) => item.status === "done" && !!item.downloadUrl,
    );
    if (doneItems.length === 0) return;

    // If there is only one output, always download it directly.
    if (doneItems.length === 1) {
      const only = doneItems[0];
      triggerBrowserDownload(only.downloadUrl as string, only.outputFilename || undefined);
      return;
    }

    if (exportMode === "files") {
      for (const item of doneItems) {
        triggerBrowserDownload(item.downloadUrl as string, item.outputFilename || undefined);
      }
      return;
    }

    triggerBrowserDownload("/download-all?mode=zip", "converted_files.zip");
  }, [exportMode, queue, triggerBrowserDownload]);

  // Convert settings
  const [convertSettings, setConvertSettings] = useState<ConvertSettings>({
    category: null,
    format: "",
    gifSpeed: "1.0",
    gifFps: "20",
    gifResolution: "480",
    gifColors: "128",
    gifDither: "sierra2_4a",
    gifLoop: "0",
    audioBitrate: "192k",
    audioCodec: "auto",
    audioVolume: "0",
    audioNormalize: false,
    imageQuality: "90",
    imageMaxSize: "",
    imageResizeMode: "none",
    imageResizePercent: "75",
    icoSize: "256",
    photoExposure: "0",
    photoContrast: "0",
    photoHighlights: "0",
    photoShadows: "0",
    photoWhites: "0",
    photoBlacks: "0",
    photoTemperature: "0",
    photoTint: "0",
    photoSaturation: "0",
    photoSharpness: "0",
    videoCodec: "libx264",
    videoPreset: "medium",
    videoCrf: "23",
    videoFps: "original",
    videoResizeWidth: "",
    videoResizeHeight: "",
    videoRotate: "none",
    videoCropTop: "",
    videoCropBottom: "",
    videoCropLeft: "",
    videoCropRight: "",
    videoDenoise: "none",
    videoHDRtoSDR: false,
    videoRemoveAudio: false,
    videoExposure: "0",
    videoContrast: "0",
    videoSaturation: "0",
    videoTemperature: "0",
    videoHue: "0",
    imageUpscale: "1",
    videoTrimStart: "",
    videoTrimEnd: "",
    overlayText: "",
    overlayTextX: "(w-text_w)/2",
    overlayTextY: "h-(text_h*2)",
    sequenceFps: "1",
    lutFile: null,
    colorRemoveEnabled: false,
    colorRemoveColor: "#ffffff",
    colorRemoveTolerance: "15",
  });

  // Compress settings
  const [compressSettings, setCompressSettings] = useState<CompressSettings>({
    mode: "crf",
    crfLevel: "medium",
    targetSizeMb: "",
    percentReduction: "50",
    resolution: "720",
    advancedEnabled: false,
    fps: "original",
    preset: "medium",
    videoCodec: "libx264",
    videoProfile: "auto",
    videoTune: "none",
    qualityMode: "auto",
    videoCrf: "23",
    videoBitrateK: "2500",
    videoPixelFormat: "auto",
    twoPass: false,
    faststart: true,
    deinterlace: false,
    audioBitrate: "original",
    audioCodec: "original",
    audioChannels: "original",
    audioSampleRate: "original",
    imageMaxSize: "",
    videoResizeWidth: "",
    videoResizeHeight: "",
  });

  // Computed values
  const pendingCount = queue.filter((item) => item.status === "pending").length;
  const completedCount = queue.filter((item) => item.status === "done").length;
  const totalCount = queue.length;
  const hasCompletedFiles = completedCount > 0;
  const hasNewFiles = queue.some((x) => x.file && x.status === "pending");

  const detectedTypesSet = new Set<DetectedMediaType>();
  for (const item of queue) {
    const t = getFileType(item.file?.name || "");
    if (t === "video" || t === "audio" || t === "image" || t === "document" || t === "3d") {
      detectedTypesSet.add(t);
    }
  }
  const detectedTypes = Array.from(detectedTypesSet);

  const hasPerFileReadyItem = queue.some((item) => {
    if (item.status !== "pending") return false;
    if (item.outputMode !== "custom") return false;

    const effectiveAction = item.customAction || item.action;
    if (effectiveAction === "compress") return true;

    if (item.targetFormat) return true;
    if (item.customConvertSettings?.format) return true;

    const t = getFileType(item.file?.name || "");
    return t === "video" || t === "audio" || t === "image";
  });

  // Document and 3D files can always start — format is auto-derived
  const hasDocumentOrModelFiles = queue.some((item) => {
    if (item.status !== "pending") return false;
    const t = getFileType(item.file?.name || "");
    return t === "document" || t === "3d";
  });

  const canStart =
    (currentAction === "convert" || currentAction === "convert_compress")
      ? hasNewFiles &&
        (hasDocumentOrModelFiles ||
          (outputMode === "global" &&
            !!convertSettings.category &&
            !!convertSettings.format) ||
          hasPerFileReadyItem)
      : hasNewFiles;

  // Add files to queue
  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const incomingFiles = Array.from(files);
      const visibleFiles = incomingFiles.filter((file) => {
        const baseName = file.name || "";
        const lowerName = baseName.toLowerCase();
        if (
          baseName.startsWith("._") ||
          lowerName === ".ds_store" ||
          lowerName === "thumbs.db"
        ) {
          return false;
        }
        if (["cover.jpg", "cover.jpeg", "cover.png"].includes(lowerName)) {
          return false;
        }
        return true;
      });

      // Simple mode: each file goes to its own best default format, no global
      // category. We reuse the existing per-file ("custom") plumbing so that
      // uploadItem/startProcessing send the right param block for every file.
      if (uiMode === "simple") {
        const simpleItems: QueueItem[] = visibleFiles.map((file) => {
          const detectedType = getFileType(file.name);
          const isMedia =
            detectedType === "video" ||
            detectedType === "audio" ||
            detectedType === "image" ||
            detectedType === "document" ||
            detectedType === "3d";
          const fmt =
            detectedType === "document"
              ? "pdf"
              : detectedType === "3d"
                ? "glb"
                : detectedType === "video" ||
                    detectedType === "audio" ||
                    detectedType === "image"
                  ? DEFAULT_CONVERT_FORMAT[detectedType]
                  : "";
          const category: MediaCategory = isMedia
            ? (detectedType as MediaCategory)
            : null;
          return {
            id: generateId(),
            file,
            mediaKind: isMedia
              ? (detectedType as QueueItem["mediaKind"])
              : undefined,
            relativePath:
              (file as File & { webkitRelativePath?: string })
                .webkitRelativePath || "",
            status: "pending",
            jobId: null,
            downloadUrl: null,
            outputFilename: null,
            error: null,
            action: currentAction,
            targetFormat: fmt || null,
            outputMode: "custom",
            customAction: null,
            customConvertSettings: { ...convertSettings, category, format: fmt },
            customCompressSettings: null,
          };
        });
        setQueue((prev) => [...prev, ...simpleItems]);
        return;
      }

      const sequenceMode =
        (currentAction === "convert" || currentAction === "convert_compress") &&
        convertSettings.category === "sequence" &&
        visibleFiles.length > 0 &&
        visibleFiles.every((file) => getFileType(file.name) === "image");
      const detectedVisibleTypes = visibleFiles
        .map((file) => getFileType(file.name))
        .filter((type): type is DetectedMediaType => type !== "unknown");
      const uniqueDetectedTypes = Array.from(new Set(detectedVisibleTypes));
      const autoDetectedType = uniqueDetectedTypes.length === 1 ? uniqueDetectedTypes[0] : null;
      const autoCategory: MediaCategory = sequenceMode ? "sequence" : autoDetectedType;
      const autoFormat =
        autoCategory === "sequence"
          ? DEFAULT_SEQUENCE_FORMAT
          : autoDetectedType
            ? DEFAULT_CONVERT_FORMAT[autoDetectedType]
            : convertSettings.format;
      const targetFormat =
        currentAction === "convert" || currentAction === "convert_compress"
          ? autoFormat
          : null;

      const newItems: QueueItem[] = [];

      if (sequenceMode) {
        const [firstFile, ...restFiles] = visibleFiles;
        newItems.push({
          id: generateId(),
          file: firstFile,
          extraFiles: restFiles,
          mediaKind: "sequence",
          relativePath:
            (firstFile as File & { webkitRelativePath?: string })
              .webkitRelativePath || "",
          status: "pending",
          jobId: null,
          downloadUrl: null,
          outputFilename: null,
          error: null,
          action: currentAction,
          targetFormat,
          outputMode: outputMode === "per-file" ? "custom" : "global",
          customAction: null,
          customConvertSettings: null,
          customCompressSettings: null,
        });
      } else {
        for (const file of visibleFiles) {
          const detectedType = getFileType(file.name);

          newItems.push({
            id: generateId(),
            file,
            mediaKind:
              detectedType === "video" ? "video"
              : detectedType === "audio" ? "audio"
              : detectedType === "image" ? "image"
              : detectedType === "document" ? "document"
              : detectedType === "3d" ? "3d"
              : undefined,
            relativePath:
              (file as File & { webkitRelativePath?: string })
                .webkitRelativePath || "",
            status: "pending",
            jobId: null,
            downloadUrl: null,
            outputFilename: null,
            error: null,
            action: currentAction,
            targetFormat,
            outputMode: outputMode === "per-file" ? "custom" : "global",
            customAction: null,
            customConvertSettings: null,
            customCompressSettings: null,
          });
        }
      }

      if (autoCategory && (currentAction === "convert" || currentAction === "convert_compress")) {
        setConvertSettings((prev) => ({
          ...prev,
          category: autoCategory,
          format: autoFormat,
        }));
      }

      setQueue((prev) => [...prev, ...newItems]);
    },
    [currentAction, convertSettings, outputMode, uiMode],
  );

  // Remove file from queue
  const removeFile = useCallback((id: string) => {
    setQueue((prev) => {
      const item = prev.find((i) => i.id === id);
      if (item?.jobId) {
        trackedJobIdsRef.current.delete(item.jobId);
        lsSaveSet(LS_TRACKED_JOBS, trackedJobIdsRef.current);
      }
      return prev.filter((i) => i.id !== id);
    });
  }, []);

  // Clear all files
  const clearAll = useCallback(async () => {
    try {
      await fetch("/clear-all", { method: "DELETE" });
    } catch (e) {
      console.error("Failed to clear server files:", e);
    }
    // Clear tracked job IDs so background mode doesn't restore these jobs on reload
    trackedJobIdsRef.current.clear();
    lsSaveSet(LS_TRACKED_JOBS, trackedJobIdsRef.current);
    downloadedBundleSignaturesRef.current.clear();
    lsSaveSet(LS_DOWNLOADED_BUNDLES, downloadedBundleSignaturesRef.current);
    setQueue([]);
  }, []);

  // Upload a single item
  const uploadItem = useCallback(
    async (item: QueueItem): Promise<void> => {
      const effectiveAction =
        item.outputMode === "custom" && item.customAction
          ? item.customAction
          : item.action;
      const effectiveConvertSettings =
        item.outputMode === "custom" && item.customConvertSettings
          ? item.customConvertSettings
          : convertSettings;
      const effectiveCompressSettings =
        item.outputMode === "custom" && item.customCompressSettings
          ? item.customCompressSettings
          : compressSettings;
      const isConvertLike =
        effectiveAction === "convert" || effectiveAction === "convert_compress";
      const isCompressLike =
        effectiveAction === "compress" || effectiveAction === "convert_compress";

      // ─── Client-side image conversion shortcut ───
      // When the user picked "Frontend" mode and we're doing an image
      // conversion (no LUT, supported target format), process entirely in the
      // browser via Canvas and skip the upload to the server.
      try {
        const procMode = localStorage.getItem("converter_processing_mode") || "frontend";
        const detectedType = getFileType(item.file?.name || "");
        const targetFormat = (item.targetFormat || effectiveConvertSettings.format || "").toLowerCase();
        const clientSupportedOut = ["png", "jpg", "jpeg", "webp", "avif", "bmp", "ico", "tiff", "tif", "gif", "pdf"].includes(targetFormat);
        const isImage = detectedType === "image";
        // LUT is supported client-side too now — passed straight to the processor.
        const canDoClientSide =
          procMode === "frontend" &&
          isImage &&
          clientSupportedOut &&
          (isConvertLike || isCompressLike);

        // Verbose log so the user can verify in DevTools console what happens.
        // eslint-disable-next-line no-console
        console.info("[convert]", {
          name: item.file?.name,
          procMode,
          detectedType,
          targetFormat,
          clientSupportedOut,
          hasLut: !!effectiveConvertSettings.lutFile,
          isConvertLike,
          isCompressLike,
          path: canDoClientSide ? "→ LOCAL (browser)" : "→ SERVER",
        });

        if (canDoClientSide) {
          const { processImageClientSide } = await import("@/lib/clientProcessor");
          const cg = {
            exposure: parseFloat(effectiveConvertSettings.photoExposure || "0") || 0,
            contrast: parseFloat(effectiveConvertSettings.photoContrast || "0") || 0,
            highlights: parseFloat(effectiveConvertSettings.photoHighlights || "0") || 0,
            shadows: parseFloat(effectiveConvertSettings.photoShadows || "0") || 0,
            whites: parseFloat(effectiveConvertSettings.photoWhites || "0") || 0,
            blacks: parseFloat(effectiveConvertSettings.photoBlacks || "0") || 0,
            saturation: parseFloat(effectiveConvertSettings.photoSaturation || "0") || 0,
            temperature: parseFloat(effectiveConvertSettings.photoTemperature || "0") || 0,
            tint: parseFloat(effectiveConvertSettings.photoTint || "0") || 0,
            sharpness: parseFloat(effectiveConvertSettings.photoSharpness || "0") || 0,
            vignette: 0, grain: 0, chromatic: 0, glow: 0,
            removeEnabled: !!effectiveConvertSettings.colorRemoveEnabled,
            removeColor: effectiveConvertSettings.colorRemoveColor || "#ffffff",
            removeTolerance: parseFloat(effectiveConvertSettings.colorRemoveTolerance || "15") || 15,
          };
          setQueue((prev) =>
            prev.map((it) => it.id === item.id ? { ...it, status: "processing", progress: 10 } : it),
          );
          const { blob, filename } = await processImageClientSide(
            item.file, cg, targetFormat, undefined, effectiveConvertSettings.lutFile || null,
          );
          const url = URL.createObjectURL(blob);
          setQueue((prev) =>
            prev.map((it) =>
              it.id === item.id
                ? { ...it, status: "done", downloadUrl: url, outputFilename: filename, jobId: `local-${item.id}`, error: null, progress: 100 }
                : it,
            ),
          );
          return;
        }

        // ── Client-side VIDEO conversion via ffmpeg.wasm ──
        const isVideo = detectedType === "video";
        const { isClientSupportedVideoFormat } = await import("@/lib/clientVideoProcessor");
        const videoSupportedOut = isClientSupportedVideoFormat(targetFormat);
        const canDoClientVideo =
          procMode === "frontend" &&
          isVideo &&
          videoSupportedOut &&
          isConvertLike;

        console.info("[convert.video]", {
          name: item.file?.name, isVideo, targetFormat, videoSupportedOut, canDoClientVideo,
        });

        if (canDoClientVideo) {
          const { processVideoClientSide } = await import("@/lib/clientVideoProcessor");
          const fpsRaw = effectiveConvertSettings.videoFps || "";
          const targetFps = fpsRaw && fpsRaw !== "original" ? parseInt(fpsRaw, 10) || null : null;
          const vg = {
            exposure: parseFloat(effectiveConvertSettings.photoExposure || "0") || 0,
            contrast: parseFloat(effectiveConvertSettings.photoContrast || "0") || 0,
            highlights: parseFloat(effectiveConvertSettings.photoHighlights || "0") || 0,
            shadows: parseFloat(effectiveConvertSettings.photoShadows || "0") || 0,
            whites: parseFloat(effectiveConvertSettings.photoWhites || "0") || 0,
            blacks: parseFloat(effectiveConvertSettings.photoBlacks || "0") || 0,
            saturation: parseFloat(effectiveConvertSettings.photoSaturation || "0") || 0,
            temperature: parseFloat(effectiveConvertSettings.photoTemperature || "0") || 0,
            tint: parseFloat(effectiveConvertSettings.photoTint || "0") || 0,
            hue: 0, sharpness: 0,
            vignette: 0, grain: 0, chromatic: 0, glow: 0,
            targetFps,
          };
          setQueue((prev) =>
            prev.map((it) => it.id === item.id ? { ...it, status: "processing", progress: 5 } : it),
          );
          const { blob, filename } = await processVideoClientSide(
            item.file, targetFormat, vg,
            (_msg, ratio) => {
              if (typeof ratio === "number") {
                setQueue((prev) =>
                  prev.map((it) => it.id === item.id ? { ...it, progress: Math.round(ratio * 100) } : it),
                );
              }
            },
            effectiveConvertSettings.lutFile || null,
          );
          const url = URL.createObjectURL(blob);
          setQueue((prev) =>
            prev.map((it) =>
              it.id === item.id
                ? { ...it, status: "done", downloadUrl: url, outputFilename: filename, jobId: `local-${item.id}`, error: null, progress: 100 }
                : it,
            ),
          );
          return;
        }
      } catch (e) {
        console.warn("[client-side] fallback to backend:", e);
      }

      const formData = new FormData();
      formData.append("file", item.file);
      if (item.relativePath) {
        formData.append("relative_path", item.relativePath);
      }
      formData.append("action", effectiveAction);

      // Attach LUT file for video colorimetric conversion
      if (isConvertLike && effectiveConvertSettings.lutFile) {
        formData.append("lut_file", effectiveConvertSettings.lutFile);
      }

      if (isConvertLike) {
        const targetFormat = item.targetFormat || effectiveConvertSettings.format;
        formData.append("format", targetFormat);

        const usesSequenceFrames =
          effectiveConvertSettings.category === "sequence" ||
          targetFormat === "zip" ||
          (item.extraFiles?.length || 0) > 0;

        if (usesSequenceFrames) {
          formData.append("sequence_fps", effectiveConvertSettings.sequenceFps || "1");
        }

        if (item.extraFiles && item.extraFiles.length > 0) {
          for (const extraFile of item.extraFiles) {
            formData.append("files", extraFile);
          }
        }

        // Video encoding settings
        if (effectiveConvertSettings.category === "video" || effectiveConvertSettings.category === "sequence") {
          if (effectiveConvertSettings.videoCodec && effectiveConvertSettings.videoCodec !== "auto") {
            formData.append("video_codec", effectiveConvertSettings.videoCodec);
          }
          if (effectiveConvertSettings.videoPreset) {
            formData.append("video_preset", effectiveConvertSettings.videoPreset);
          }
          if (effectiveConvertSettings.videoCrf) {
            formData.append("video_crf", effectiveConvertSettings.videoCrf);
          }
          if (effectiveConvertSettings.videoFps && effectiveConvertSettings.videoFps !== "original") {
            formData.append("fps", effectiveConvertSettings.videoFps);
          }
          // Transforms
          if (effectiveConvertSettings.videoRotate && effectiveConvertSettings.videoRotate !== "none") {
            formData.append("rotate", effectiveConvertSettings.videoRotate);
          }
          if (effectiveConvertSettings.videoCropTop) formData.append("crop_top", effectiveConvertSettings.videoCropTop);
          if (effectiveConvertSettings.videoCropBottom) formData.append("crop_bottom", effectiveConvertSettings.videoCropBottom);
          if (effectiveConvertSettings.videoCropLeft) formData.append("crop_left", effectiveConvertSettings.videoCropLeft);
          if (effectiveConvertSettings.videoCropRight) formData.append("crop_right", effectiveConvertSettings.videoCropRight);
          if (effectiveConvertSettings.videoDenoise && effectiveConvertSettings.videoDenoise !== "none") {
            formData.append("denoise", effectiveConvertSettings.videoDenoise);
          }
          if (effectiveConvertSettings.videoHDRtoSDR) {
            formData.append("hdr_to_sdr", "true");
          }
          if (effectiveConvertSettings.videoRemoveAudio) {
            formData.append("remove_audio", "true");
          }
          // Video color grading
          if (parseFloat(effectiveConvertSettings.videoExposure) !== 0) {
            formData.append("video_exposure", effectiveConvertSettings.videoExposure);
          }
          if (parseFloat(effectiveConvertSettings.videoContrast) !== 0) {
            formData.append("video_contrast", effectiveConvertSettings.videoContrast);
          }
          if (parseFloat(effectiveConvertSettings.videoSaturation) !== 0) {
            formData.append("video_saturation", effectiveConvertSettings.videoSaturation);
          }
          if (parseFloat(effectiveConvertSettings.videoTemperature) !== 0) {
            formData.append("video_temperature", effectiveConvertSettings.videoTemperature);
          }
          if (parseFloat(effectiveConvertSettings.videoHue) !== 0) {
            formData.append("video_hue", effectiveConvertSettings.videoHue);
          }
        }

        // Image upscaler
        if (
          effectiveConvertSettings.category === "image" &&
          effectiveConvertSettings.imageUpscale &&
          effectiveConvertSettings.imageUpscale !== "1"
        ) {
          formData.append("image_upscale", effectiveConvertSettings.imageUpscale);
        }

        // GIF settings
        if (effectiveConvertSettings.category === "video" && targetFormat === "gif") {
          formData.append("gif_speed", effectiveConvertSettings.gifSpeed);
          formData.append("gif_fps", effectiveConvertSettings.gifFps);
          formData.append("gif_resolution", effectiveConvertSettings.gifResolution);
          formData.append("gif_colors", effectiveConvertSettings.gifColors);
          formData.append("gif_dither", effectiveConvertSettings.gifDither);
          formData.append("gif_loop", effectiveConvertSettings.gifLoop);
        }

        if (effectiveConvertSettings.videoResizeWidth.trim()) {
          formData.append("video_resize_width", effectiveConvertSettings.videoResizeWidth.trim());
        }
        if (effectiveConvertSettings.videoResizeHeight.trim()) {
          formData.append("video_resize_height", effectiveConvertSettings.videoResizeHeight.trim());
        }

        // Mini video editor settings
        if (effectiveConvertSettings.category === "video") {
          if (effectiveConvertSettings.videoTrimStart.trim()) {
            formData.append("trim_start", effectiveConvertSettings.videoTrimStart.trim());
          }
          if (effectiveConvertSettings.videoTrimEnd.trim()) {
            formData.append("trim_end", effectiveConvertSettings.videoTrimEnd.trim());
          }
          if (effectiveConvertSettings.overlayText.trim()) {
            formData.append("overlay_text", effectiveConvertSettings.overlayText.trim());
            formData.append("overlay_text_x", effectiveConvertSettings.overlayTextX || "(w-text_w)/2");
            formData.append("overlay_text_y", effectiveConvertSettings.overlayTextY || "h-(text_h*2)");
          }
        }

        // Audio settings
        if (effectiveConvertSettings.category === "audio" || effectiveConvertSettings.category === "video") {
          formData.append("audio_bitrate", effectiveConvertSettings.audioBitrate);
          if (effectiveConvertSettings.audioCodec && effectiveConvertSettings.audioCodec !== "auto") {
            formData.append("audio_codec", effectiveConvertSettings.audioCodec);
          }
          const vol = parseFloat(effectiveConvertSettings.audioVolume);
          if (!isNaN(vol) && vol !== 0) {
            formData.append("audio_volume", effectiveConvertSettings.audioVolume);
          }
          if (effectiveConvertSettings.audioNormalize) {
            formData.append("audio_normalize", "true");
          }
        }

        // Image settings
        if (effectiveConvertSettings.category === "image") {
          if (effectiveConvertSettings.imageQuality === "lossless") {
            formData.append("lossless", "true");
          } else {
            formData.append("image_quality", effectiveConvertSettings.imageQuality);
          }
          if (
            effectiveConvertSettings.imageResizeMode === "dimension" &&
            effectiveConvertSettings.imageMaxSize
          ) {
            formData.append("image_resize_mode", "dimension");
            formData.append("image_max_size", effectiveConvertSettings.imageMaxSize);
          } else if (effectiveConvertSettings.imageResizeMode === "percent") {
            formData.append("image_resize_mode", "percent");
            formData.append(
              "image_resize_percent",
              effectiveConvertSettings.imageResizePercent || "75",
            );
          }
          if (targetFormat === "ico" && effectiveConvertSettings.icoSize) {
            formData.append("ico_size", effectiveConvertSettings.icoSize);
          }

          if (effectiveConvertSettings.photoExposure !== "0") {
            formData.append("photo_exposure", effectiveConvertSettings.photoExposure);
          }
          if (effectiveConvertSettings.photoContrast !== "0") {
            formData.append("photo_contrast", effectiveConvertSettings.photoContrast);
          }
          if (effectiveConvertSettings.photoHighlights !== "0") {
            formData.append("photo_highlights", effectiveConvertSettings.photoHighlights);
          }
          if (effectiveConvertSettings.photoShadows !== "0") {
            formData.append("photo_shadows", effectiveConvertSettings.photoShadows);
          }
          if (effectiveConvertSettings.photoWhites !== "0") {
            formData.append("photo_whites", effectiveConvertSettings.photoWhites);
          }
          if (effectiveConvertSettings.photoBlacks !== "0") {
            formData.append("photo_blacks", effectiveConvertSettings.photoBlacks);
          }
          if (effectiveConvertSettings.photoTemperature !== "0") {
            formData.append("photo_temperature", effectiveConvertSettings.photoTemperature);
          }
          if (effectiveConvertSettings.photoTint !== "0") {
            formData.append("photo_tint", effectiveConvertSettings.photoTint);
          }
          if (effectiveConvertSettings.photoSaturation !== "0") {
            formData.append("photo_saturation", effectiveConvertSettings.photoSaturation);
          }
          if (effectiveConvertSettings.photoSharpness !== "0") {
            formData.append("photo_sharpness", effectiveConvertSettings.photoSharpness);
          }
        }

        // Color remover (image or video)
        if (
          effectiveConvertSettings.colorRemoveEnabled &&
          effectiveConvertSettings.colorRemoveColor &&
          (effectiveConvertSettings.category === "image" ||
            effectiveConvertSettings.category === "video" ||
            effectiveConvertSettings.category === "sequence")
        ) {
          formData.append("color_remove_color", effectiveConvertSettings.colorRemoveColor);
          formData.append(
            "color_remove_tolerance",
            effectiveConvertSettings.colorRemoveTolerance || "15",
          );
        }
      }

      if (isCompressLike) {
        // Compress mode
        formData.append("comp_mode", effectiveCompressSettings.mode);

        let compValue = "";
        if (effectiveCompressSettings.mode === "crf") {
          compValue = effectiveCompressSettings.crfLevel;
        } else if (effectiveCompressSettings.mode === "size") {
          compValue = effectiveCompressSettings.targetSizeMb;
        } else if (effectiveCompressSettings.mode === "percent") {
          compValue = effectiveCompressSettings.percentReduction;
        } else if (effectiveCompressSettings.mode === "res") {
          compValue = effectiveCompressSettings.resolution;
        }
        formData.append("comp_value", compValue);

        if (effectiveCompressSettings.advancedEnabled) {
          if (effectiveCompressSettings.fps && effectiveCompressSettings.fps !== "original")
            formData.append("fps", effectiveCompressSettings.fps);
          if (effectiveCompressSettings.preset)
            formData.append("video_preset", effectiveCompressSettings.preset);
          if (effectiveCompressSettings.videoCodec)
            formData.append("video_codec", effectiveCompressSettings.videoCodec);
          if (
            effectiveCompressSettings.videoProfile &&
            effectiveCompressSettings.videoProfile !== "auto"
          )
            formData.append("video_profile", effectiveCompressSettings.videoProfile);
          if (
            effectiveCompressSettings.videoTune &&
            effectiveCompressSettings.videoTune !== "none"
          )
            formData.append("video_tune", effectiveCompressSettings.videoTune);
          if (
            effectiveCompressSettings.qualityMode &&
            effectiveCompressSettings.qualityMode !== "auto"
          )
            formData.append("video_quality_mode", effectiveCompressSettings.qualityMode);
          if (effectiveCompressSettings.videoCrf)
            formData.append("video_crf", effectiveCompressSettings.videoCrf);
          if (effectiveCompressSettings.videoBitrateK)
            formData.append("video_bitrate_k", effectiveCompressSettings.videoBitrateK);
          if (
            effectiveCompressSettings.videoPixelFormat &&
            effectiveCompressSettings.videoPixelFormat !== "auto"
          )
            formData.append(
              "video_pixel_format",
              effectiveCompressSettings.videoPixelFormat,
            );
          if (effectiveCompressSettings.twoPass) formData.append("two_pass", "true");
          if (effectiveCompressSettings.faststart)
            formData.append("faststart", "true");
          if (effectiveCompressSettings.deinterlace)
            formData.append("deinterlace", "true");
          if (
            effectiveCompressSettings.audioCodec &&
            effectiveCompressSettings.audioCodec !== "original"
          )
            formData.append("audio_codec", effectiveCompressSettings.audioCodec);
          if (
            effectiveCompressSettings.audioBitrate &&
            effectiveCompressSettings.audioBitrate !== "original"
          )
            formData.append("audio_bitrate", effectiveCompressSettings.audioBitrate);
          if (
            effectiveCompressSettings.audioChannels &&
            effectiveCompressSettings.audioChannels !== "original"
          )
            formData.append("audio_channels", effectiveCompressSettings.audioChannels);
          if (
            effectiveCompressSettings.audioSampleRate &&
            effectiveCompressSettings.audioSampleRate !== "original"
          )
            formData.append(
              "audio_sample_rate",
              effectiveCompressSettings.audioSampleRate,
            );
        }

        if (effectiveCompressSettings.imageMaxSize) {
          formData.append("image_max_size", effectiveCompressSettings.imageMaxSize);
        }
        if (effectiveCompressSettings.videoResizeWidth.trim()) {
          formData.append(
            "video_resize_width",
            effectiveCompressSettings.videoResizeWidth.trim(),
          );
        }
        if (effectiveCompressSettings.videoResizeHeight.trim()) {
          formData.append(
            "video_resize_height",
            effectiveCompressSettings.videoResizeHeight.trim(),
          );
        }
      }

      setQueue((prev) =>
        prev.map((i) =>
          i.id === item.id ? { ...i, status: "uploading" as const } : i,
        ),
      );

      try {
        for (let attempt = 0; attempt <= MAX_UPLOAD_RETRIES; attempt += 1) {
          const response = await fetch("/jobs", {
            method: "POST",
            body: formData,
          });

          let data: { job_id?: string; error?: string } = {};
          try {
            data = await response.json();
          } catch {
            data = {};
          }

          if (response.ok) {
            // Track this job ID so it can be restored after a page reload
            trackedJobIdsRef.current.add(data.job_id || "");
            trackedJobIdsRef.current.delete("");
            lsSaveSet(LS_TRACKED_JOBS, trackedJobIdsRef.current);
            setQueue((prev) =>
              prev.map((i) =>
                i.id === item.id
                  ? { ...i, status: "queued" as const, jobId: data.job_id || null }
                  : i,
              ),
            );
            return;
          }

          if (response.status === 429 && attempt < MAX_UPLOAD_RETRIES) {
            await waitMs(UPLOAD_RETRY_DELAY_MS);
            continue;
          }

          throw new Error(data.error || `HTTP ${response.status}`);
        }

        throw new Error("timeout: impossible de mettre en file")
      } catch (error) {
        setQueue((prev) =>
          prev.map((i) =>
            i.id === item.id
              ? { ...i, status: "error" as const, error: String(error) }
              : i,
          ),
        );
      }
    },
    [convertSettings, compressSettings],
  );

  // Poll for job updates
  const pollJobs = useCallback(async () => {
    try {
      const response = await fetch("/jobs?limit=200");
      if (!response.ok) return;

      const data = await response.json();
      const jobsMap = new Map<string, JobResponse>();
      (data.jobs || []).forEach((j: JobResponse) => jobsMap.set(j.id, j));

      setQueue((prev) => {
        const existingIds = new Set(prev.map((item) => item.jobId).filter(Boolean));
        const hydrated = [...prev];

        for (const job of jobsMap.values()) {
          // Only hydrate jobs that belong to this user's tracked submissions.
          // This prevents showing old completed jobs from previous sessions while
          // still restoring jobs that were actively converting during a page reload.
          if (!existingIds.has(job.id) && trackedJobIdsRef.current.has(job.id)) {
            const filename = job.original_filename || job.output_filename || `job-${job.id}`;
            hydrated.push({
              id: generateId(),
              file: new File([], filename),
              relativePath: "",
              status: job.status as QueueItem["status"],
              progress: job.status === "done" ? 100 : (job.progress ?? 0),
              jobId: job.id,
              downloadUrl: job.download_url,
              outputFilename: job.output_filename,
              error: job.error,
              action: job.action || "convert",
              targetFormat: job.target_format || null,
              mediaKind:
                job.media_type === "image_sequence"
                  ? "sequence"
                  : job.media_type === "video" ||
                      job.media_type === "audio" ||
                      job.media_type === "image"
                    ? job.media_type
                    : undefined,
              outputMode: "global",
              customAction: null,
              customConvertSettings: null,
              customCompressSettings: null,
            });
          }
        }

        const next = hydrated.map((item) => {
          if (
            !item.jobId ||
            (item.status !== "queued" && item.status !== "processing")
          ) {
            return item;
          }

          const job = jobsMap.get(item.jobId);
          if (!job) return item;

          if (job.status === "processing") {
            return {
              ...item,
              status: "processing" as const,
              progress: job.progress ?? item.progress,
            };
          }

          if (job.status === "done") {
            return {
              ...item,
              status: "done" as const,
              progress: 100,
              downloadUrl: job.download_url,
              outputFilename: job.output_filename,
            };
          }

          if (job.status === "error") {
            return { ...item, status: "error" as const, error: job.error };
          }

          return item;
        });

        if (next.length === prev.length) {
          let hasDiff = false;
          for (let i = 0; i < next.length; i += 1) {
            if (next[i] !== prev[i]) {
              hasDiff = true;
              break;
            }
          }
          if (!hasDiff) {
            return prev;
          }
        }

        return next;
      });
    } catch (e) {
      console.error("Polling error", e);
    }
  }, []);

  // Start processing
  const startProcessing = useCallback(async () => {
    if (isProcessing || !canStart) return;

    setIsProcessing(true);
    setHasStarted(true);
    uploadingRef.current = true;

    const updatedQueue = queue.map((item) => {
      if (item.status !== "pending") return item;

      const itemType = getFileType(item.file.name);
      const fallbackFormat =
        itemType === "video" || itemType === "audio" || itemType === "image"
          ? DEFAULT_CONVERT_FORMAT[itemType]
          : "";

      const effectiveAction =
        item.outputMode === "custom" && item.customAction
          ? item.customAction
          : currentAction;

      // Auto-detect output format for document and 3D files
      const autoFormat =
        itemType === "document" ? "pdf"
        : itemType === "3d" ? "glb"
        : fallbackFormat;

      let resolvedFormat: string | null = null;
      if (effectiveAction === "convert" || effectiveAction === "convert_compress") {
        if (item.outputMode === "custom") {
          // Custom mode: respect per-file target format
          resolvedFormat =
            item.targetFormat ||
            item.customConvertSettings?.format ||
            convertSettings.format ||
            autoFormat;
        } else if (itemType === "document" || itemType === "3d") {
          // Document/3D: always auto-derive format (user doesn't pick a category)
          resolvedFormat = item.targetFormat || autoFormat;
        } else {
          // Global mode: always use current global settings (ignore stale item.targetFormat)
          resolvedFormat = convertSettings.format || autoFormat;
        }
      }

      return {
        ...item,
        action: effectiveAction,
        targetFormat: resolvedFormat,
      };
    });
    setQueue(updatedQueue);

    // Start polling
    if (!pollingRef.current) {
      pollingRef.current = window.setInterval(pollJobs, POLL_INTERVAL_MS);
    }

    const pendingItems = updatedQueue.filter(
      (item) => item.status === "pending",
    );
    let index = 0;
    const activeUploads: Promise<void>[] = [];

    while (index < pendingItems.length || activeUploads.length > 0) {
      while (
        activeUploads.length < MAX_CONCURRENT_UPLOADS &&
        index < pendingItems.length
      ) {
        const item = pendingItems[index++];
        const p = uploadItem(item).then(() => {
          const idx = activeUploads.indexOf(p);
          if (idx > -1) activeUploads.splice(idx, 1);
        });
        activeUploads.push(p);
      }

      if (activeUploads.length === 0) break;
      await Promise.race(activeUploads);
    }

    uploadingRef.current = false;
    setIsProcessing(false);
  }, [
    isProcessing,
    canStart,
    currentAction,
    convertSettings.format,
    queue,
    uploadItem,
    pollJobs,
  ]);

  // Stop polling when all done
  useEffect(() => {
    const activeItems = queue.filter(
      (item) =>
        (item.status === "queued" || item.status === "processing") &&
        item.jobId,
    );
    const anyPending = queue.some((x) => x.status === "pending");

    if (
      activeItems.length === 0 &&
      !uploadingRef.current &&
      !anyPending &&
      pollingRef.current
    ) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, [queue]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  // Background polling on page load (only if enabled)
  useEffect(() => {
    if (!backgroundEnabled) return;
    if (trackedJobIdsRef.current.size === 0) return;
    if (!pollingRef.current) {
      pollingRef.current = window.setInterval(pollJobs, POLL_INTERVAL_MS);
    }
    pollJobs();
  }, [backgroundEnabled, pollJobs]);

  const setCategory = useCallback((category: MediaCategory) => {
    const defaultFormat =
      category === "video"
        ? VIDEO_FORMATS[0]
        : category === "audio"
          ? AUDIO_FORMATS[0]
            : category === "image"
              ? IMAGE_FORMATS[0]
              : category === "sequence"
                ? DEFAULT_SEQUENCE_FORMAT
                : "";

    setConvertSettings((prev) => ({
      ...prev,
      category,
      format: defaultFormat,
    }));
  }, []);

  const setFormat = useCallback((format: string) => {
    setConvertSettings((prev) => ({ ...prev, format }));
  }, []);

  const applySuggestedConvert = useCallback((type: DetectedMediaType) => {
    const category: MediaCategory = type;
    const format = DEFAULT_CONVERT_FORMAT[type];
    setCurrentAction("convert");
    setConvertSettings((prev) => ({ ...prev, category, format }));
  }, []);

  const applySuggestedCompress = useCallback((type: DetectedMediaType) => {
    setCurrentAction("compress");
    setCompressSettings((prev) => ({
      ...prev,
      mode: "size",
      targetSizeMb: prev.targetSizeMb || DEFAULT_COMPRESS_TARGET_MB[type],
    }));
  }, []);

  // Simple-mode per-file format change: update the target format (and the
  // mirrored customConvertSettings.format) while leaving customAction null so
  // the global "Réduire le poids" toggle still applies.
  const setSimpleFormat = useCallback((id: string, format: string) => {
    setQueue((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              targetFormat: format,
              customConvertSettings: item.customConvertSettings
                ? { ...item.customConvertSettings, format }
                : item.customConvertSettings,
            }
          : item,
      ),
    );
  }, []);

  const setItemTargetFormat = useCallback((id: string, format: string) => {
    setQueue((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              targetFormat: format,
              outputMode: "custom",
              customAction: currentAction === "convert_compress" ? "convert_compress" : "convert",
            }
          : item,
      ),
    );
  }, [currentAction]);

  const setItemCustomAction = useCallback(
    (id: string, action: ActionMode) => {
      setQueue((prev) =>
        prev.map((item) => {
          if (item.id !== id) return item;
          return {
            ...item,
            outputMode: "custom",
            customAction: action,
            customConvertSettings: item.customConvertSettings || { ...convertSettings },
            customCompressSettings: item.customCompressSettings || { ...compressSettings },
            targetFormat:
              action === "convert" || action === "convert_compress"
                ? item.targetFormat ||
                  item.customConvertSettings?.format ||
                  convertSettings.format
                : null,
          };
        }),
      );
    },
    [compressSettings, convertSettings],
  );

  const setItemCustomCompressSettings = useCallback(
    (id: string, patch: Partial<CompressSettings>) => {
      setQueue((prev) =>
        prev.map((item) => {
          if (item.id !== id) return item;
          const base = item.customCompressSettings || { ...compressSettings };
          return {
            ...item,
            outputMode: "custom",
            customAction: item.customAction || "compress",
            customCompressSettings: {
              ...base,
              ...patch,
            },
          };
        }),
      );
    },
    [compressSettings],
  );

  const setItemOutputMode = useCallback(
    (id: string, mode: "global" | "custom") => {
      setQueue((prev) =>
        prev.map((item) => {
          if (item.id !== id) return item;
          if (mode === "global") {
            return {
              ...item,
              outputMode: "global",
              customAction: null,
              customConvertSettings: null,
              customCompressSettings: null,
              targetFormat:
                currentAction === "convert" || currentAction === "convert_compress"
                  ? convertSettings.format
                  : null,
            };
          }
          return {
            ...item,
            outputMode: "custom",
            customAction: currentAction,
            customConvertSettings: { ...convertSettings },
            customCompressSettings: { ...compressSettings },
            targetFormat:
              currentAction === "convert" || currentAction === "convert_compress"
                ? item.targetFormat || convertSettings.format
                : null,
          };
        }),
      );
    },
    [compressSettings, convertSettings, currentAction],
  );

  const applyGlobalFormatToAll = useCallback(() => {
    setQueue((prev) =>
      prev.map((item) => ({
        ...item,
        outputMode: "global",
        customAction: null,
        customConvertSettings: null,
        customCompressSettings: null,
        targetFormat:
          currentAction === "convert" || currentAction === "convert_compress"
            ? convertSettings.format
            : null,
      })),
    );
  }, [convertSettings.format, currentAction]);

  const requeueItem = useCallback((id: string) => {
    setQueue((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              status: "pending",
              jobId: null,
              downloadUrl: null,
              outputFilename: null,
              error: null,
            }
          : item,
      ),
    );
  }, []);

  // Auto-download one ZIP when all items are finished (done or error)
  useEffect(() => {
    if (!autoDownloadEnabled) return;
    if (queue.length === 0) return;

    const hasActiveOrPending = queue.some(
      (item) =>
        item.status === "pending" ||
        item.status === "uploading" ||
        item.status === "queued" ||
        item.status === "processing",
    );
    if (hasActiveOrPending) return;

    const doneItems = queue.filter(
      (item) => item.status === "done" && !!item.jobId && !!item.downloadUrl,
    );
    if (doneItems.length === 0) return;

    const signature = doneItems
      .map((item) => item.jobId as string)
      .sort()
      .join("|");
    if (!signature) return;
    if (downloadedBundleSignaturesRef.current.has(signature)) return;

    downloadedBundleSignaturesRef.current.add(signature);
    lsSaveSet(LS_DOWNLOADED_BUNDLES, downloadedBundleSignaturesRef.current);

    // Auto-export based on selected mode.
    if (doneItems.length === 1) {
      const only = doneItems[0];
      triggerBrowserDownload(only.downloadUrl as string, only.outputFilename || undefined);
      return;
    }

    if (exportMode === "files") {
      for (const item of doneItems) {
        triggerBrowserDownload(item.downloadUrl as string, item.outputFilename || undefined);
      }
      return;
    }

    triggerBrowserDownload("/download-all?mode=zip", "converted_files.zip");
  }, [autoDownloadEnabled, exportMode, queue, triggerBrowserDownload]);

  return {
    // State
    queue,
    currentAction,
    convertSettings,
    compressSettings,
    isProcessing,
    hasStarted,
    outputMode,
    exportMode,
    uiMode,
    backgroundEnabled,
    autoDownloadEnabled,
    // Computed
    pendingCount,
    completedCount,
    totalCount,
    hasCompletedFiles,
    canStart,
    detectedTypes,
    // Actions
    addFiles,
    removeFile,
    clearAll,
    startProcessing,
    setCurrentAction,
    setOutputMode,
    setExportMode,
    setUiMode,
    setBackgroundEnabled,
    setAutoDownloadEnabled,
    setCategory,
    setFormat,
    setSimpleFormat,
    setItemTargetFormat,
    setItemCustomAction,
    setItemCustomCompressSettings,
    setItemOutputMode,
    applyGlobalFormatToAll,
    requeueItem,
    exportCompletedFiles,
    setConvertSettings,
    setCompressSettings,
    applySuggestedConvert,
    applySuggestedCompress,
  };
}
