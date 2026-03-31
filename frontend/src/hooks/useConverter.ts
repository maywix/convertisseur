import type {
    CompressSettings,
    ConvertSettings,
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

const MAX_CONCURRENT_UPLOADS = 8;
const POLL_INTERVAL_MS = 1500;

type DetectedMediaType = "video" | "audio" | "image";

const DEFAULT_CONVERT_FORMAT: Record<DetectedMediaType, string> = {
  video: "mp4",
  audio: "mp3",
  image: "webp",
};

const DEFAULT_COMPRESS_TARGET_MB: Record<DetectedMediaType, string> = {
  video: "50",
  audio: "8",
  image: "2",
};

function generateId(): string {
  return Math.random().toString(36).substring(7);
}

export function useConverter() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [currentAction, setCurrentAction] = useState<"convert" | "compress">(
    "convert",
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [outputMode, setOutputMode] = useState<OutputMode>("global");
  const [backgroundEnabled, setBackgroundEnabled] = useState(true);
  const [autoDownloadEnabled, setAutoDownloadEnabled] = useState(true);
  const pollingRef = useRef<number | null>(null);
  const uploadingRef = useRef(false);
  const downloadedJobIdsRef = useRef<Set<string>>(new Set());

  // Convert settings
  const [convertSettings, setConvertSettings] = useState<ConvertSettings>({
    category: null,
    format: "",
    gifSpeed: "0.1",
    gifFps: "20",
    gifResolution: "480",
    audioBitrate: "192k",
    imageQuality: "90",
    imageMaxSize: "",
    imageResizeMode: "none",
    imageResizePercent: "75",
    icoSize: "256",
    videoTrimStart: "",
    videoTrimEnd: "",
    overlayText: "",
    overlayTextX: "(w-text_w)/2",
    overlayTextY: "h-(text_h*2)",
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
    if (t === "video" || t === "audio" || t === "image") {
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

  const canStart =
    currentAction === "convert"
      ? hasNewFiles &&
        ((outputMode === "global" &&
          !!convertSettings.category &&
          !!convertSettings.format) ||
          hasPerFileReadyItem)
      : hasNewFiles;

  // Add files to queue
  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const newItems: QueueItem[] = [];

      for (const file of Array.from(files)) {
        const baseName = file.name || "";
        const lowerName = baseName.toLowerCase();

        // Skip hidden/meta files
        if (
          baseName.startsWith("._") ||
          lowerName === ".ds_store" ||
          lowerName === "thumbs.db"
        ) {
          continue;
        }
        if (["cover.jpg", "cover.jpeg", "cover.png"].includes(lowerName)) {
          continue;
        }

        newItems.push({
          id: generateId(),
          file,
          relativePath:
            (file as File & { webkitRelativePath?: string })
              .webkitRelativePath || "",
          status: "pending",
          jobId: null,
          downloadUrl: null,
          outputFilename: null,
          error: null,
          action: currentAction,
          targetFormat:
            currentAction === "convert" ? convertSettings.format : null,
          outputMode: outputMode === "per-file" ? "custom" : "global",
          customAction: null,
          customConvertSettings: null,
          customCompressSettings: null,
        });
      }

      setQueue((prev) => [...prev, ...newItems]);
    },
    [currentAction, convertSettings.format, outputMode],
  );

  // Remove file from queue
  const removeFile = useCallback((id: string) => {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  }, []);

  // Clear all files
  const clearAll = useCallback(async () => {
    try {
      await fetch("/clear-all", { method: "DELETE" });
    } catch (e) {
      console.error("Failed to clear server files:", e);
    }
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

      const formData = new FormData();
      formData.append("file", item.file);
      if (item.relativePath) {
        formData.append("relative_path", item.relativePath);
      }
      formData.append("action", effectiveAction);

      if (effectiveAction === "convert") {
        const targetFormat = item.targetFormat || effectiveConvertSettings.format;
        formData.append("format", targetFormat);

        // GIF settings
        if (effectiveConvertSettings.category === "video" && targetFormat === "gif") {
          formData.append("gif_speed", effectiveConvertSettings.gifSpeed);
          formData.append("gif_fps", effectiveConvertSettings.gifFps);
          formData.append("gif_resolution", effectiveConvertSettings.gifResolution);
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
        if (effectiveConvertSettings.category === "audio") {
          formData.append("audio_bitrate", effectiveConvertSettings.audioBitrate);
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
        }
      } else {
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
      }

      setQueue((prev) =>
        prev.map((i) =>
          i.id === item.id ? { ...i, status: "uploading" as const } : i,
        ),
      );

      try {
        const response = await fetch("/jobs", {
          method: "POST",
          body: formData,
        });

        const data = await response.json();

        if (response.ok) {
          setQueue((prev) =>
            prev.map((i) =>
              i.id === item.id
                ? { ...i, status: "queued" as const, jobId: data.job_id }
                : i,
            ),
          );
        } else {
          throw new Error(data.error || `HTTP ${response.status}`);
        }
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

      setQueue((prev) =>
        {
          const existingIds = new Set(prev.map((item) => item.jobId).filter(Boolean));
          const hydrated = [...prev];

          for (const job of jobsMap.values()) {
            if (!existingIds.has(job.id) && (job.status === "queued" || job.status === "processing" || job.status === "done")) {
              const filename = job.original_filename || job.output_filename || `job-${job.id}`;
              hydrated.push({
                id: generateId(),
                file: new File([], filename),
                relativePath: "",
                status:
                  job.status === "queued"
                    ? "queued"
                    : job.status === "processing"
                      ? "processing"
                      : job.status === "done"
                        ? "done"
                        : "error",
                jobId: job.id,
                downloadUrl: job.download_url,
                outputFilename: job.output_filename,
                error: job.error,
                action: job.action || "convert",
                targetFormat: job.target_format || null,
                outputMode: "global",
                customAction: null,
                customConvertSettings: null,
                customCompressSettings: null,
              });
            }
          }

          return hydrated.map((item) => {
          if (
            !item.jobId ||
            (item.status !== "queued" && item.status !== "processing")
          ) {
            return item;
          }

          const job = jobsMap.get(item.jobId);
          if (!job) return item;

          if (job.status === "processing" && item.status !== "processing") {
            return { ...item, status: "processing" as const };
          }

          if (job.status === "done") {
            return {
              ...item,
              status: "done" as const,
              downloadUrl: job.download_url,
              outputFilename: job.output_filename,
            };
          }

          if (job.status === "error") {
            return { ...item, status: "error" as const, error: job.error };
          }

          return item;
        });
        },
      );
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

    // Update pending items with current settings and reuse the same snapshot for uploads
    const updatedQueue = queue.map((item) => {
      if (item.status !== "pending") return item;

      const itemType = getFileType(item.file.name);
      const fallbackFormat =
        itemType === "video" || itemType === "audio" || itemType === "image"
          ? DEFAULT_CONVERT_FORMAT[itemType]
          : "";

      return {
        ...item,
        action:
          item.outputMode === "custom" && item.customAction
            ? item.customAction
            : currentAction,
        targetFormat:
          (item.outputMode === "custom" && item.customAction
            ? item.customAction
            : currentAction) === "convert"
            ? item.targetFormat ||
              (item.outputMode === "custom" && item.customConvertSettings
                ? item.customConvertSettings.format
                : convertSettings.format) ||
              fallbackFormat
            : null,
      };
    });
    setQueue(updatedQueue);

    // Start polling
    if (!pollingRef.current) {
      pollingRef.current = window.setInterval(pollJobs, POLL_INTERVAL_MS);
    }

    // Get pending items
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

  useEffect(() => {
    if (!backgroundEnabled) return;
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

  const setItemTargetFormat = useCallback((id: string, format: string) => {
    setQueue((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              targetFormat: format,
              outputMode: "custom",
              customAction: "convert",
            }
          : item,
      ),
    );
  }, []);

  const setItemCustomAction = useCallback(
    (id: string, action: "convert" | "compress") => {
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
              action === "convert"
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
              targetFormat: currentAction === "convert" ? convertSettings.format : null,
            };
          }
          return {
            ...item,
            outputMode: "custom",
            customAction: currentAction,
            customConvertSettings: { ...convertSettings },
            customCompressSettings: { ...compressSettings },
            targetFormat:
              currentAction === "convert"
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
        targetFormat: currentAction === "convert" ? convertSettings.format : null,
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

  useEffect(() => {
    if (!autoDownloadEnabled) return;
    for (const item of queue) {
      if (item.status !== "done" || !item.downloadUrl || !item.jobId) continue;
      if (downloadedJobIdsRef.current.has(item.jobId)) continue;
      downloadedJobIdsRef.current.add(item.jobId);
      const link = document.createElement("a");
      link.href = item.downloadUrl;
      link.download = item.outputFilename || "";
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }, [autoDownloadEnabled, queue]);

  return {
    // State
    queue,
    currentAction,
    convertSettings,
    compressSettings,
    isProcessing,
    hasStarted,
    outputMode,
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
    setBackgroundEnabled,
    setAutoDownloadEnabled,
    setCategory,
    setFormat,
    setItemTargetFormat,
    setItemCustomAction,
    setItemCustomCompressSettings,
    setItemOutputMode,
    applyGlobalFormatToAll,
    requeueItem,
    setConvertSettings,
    setCompressSettings,
    applySuggestedConvert,
    applySuggestedCompress,
  };
}
