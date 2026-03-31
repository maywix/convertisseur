// Types for the converter application

export interface QueueItem {
  id: string;
  file: File;
  relativePath: string;
  status: "pending" | "uploading" | "queued" | "processing" | "done" | "error";
  jobId: string | null;
  downloadUrl: string | null;
  outputFilename: string | null;
  error: string | null;
  action: "convert" | "compress";
  targetFormat: string | null;
  outputMode: "global" | "custom";
  customAction: "convert" | "compress" | null;
  customConvertSettings: ConvertSettings | null;
  customCompressSettings: CompressSettings | null;
}

export type OutputMode = "global" | "per-file";

export interface JobResponse {
  id: string;
  status: "queued" | "processing" | "done" | "error";
  error: string | null;
  download_url: string | null;
  output_filename: string | null;
  media_type: string | null;
  original_filename?: string;
  action?: "convert" | "compress";
  target_format?: string | null;
}

export type MediaCategory = "video" | "audio" | "image" | null;

export interface ConvertSettings {
  category: MediaCategory;
  format: string;
  // GIF settings
  gifSpeed: string;
  gifFps: string;
  gifResolution: string;
  // Audio settings
  audioBitrate: string;
  // Image settings
  imageQuality: string;
  imageMaxSize: string;
  imageResizeMode: "none" | "dimension" | "percent";
  imageResizePercent: string;
  icoSize: string;
  // Mini video editor
  videoTrimStart: string;
  videoTrimEnd: string;
  overlayText: string;
  overlayTextX: string;
  overlayTextY: string;
}

export interface CompressSettings {
  mode: "crf" | "size" | "percent" | "res";
  crfLevel: "low" | "medium" | "high";
  targetSizeMb: string;
  percentReduction: string;
  resolution: string;
  // Advanced
  advancedEnabled: boolean;
  fps: string;
  preset: string;
  videoCodec: string;
  videoProfile: string;
  videoTune: string;
  qualityMode: "auto" | "crf" | "bitrate";
  videoCrf: string;
  videoBitrateK: string;
  videoPixelFormat: string;
  twoPass: boolean;
  faststart: boolean;
  deinterlace: boolean;
  audioBitrate: string;
  audioCodec: string;
  audioChannels: string;
  audioSampleRate: string;
  // Image
  imageMaxSize: string;
}

export const VIDEO_FORMATS = [
  "mp4",
  "webm",
  "mkv",
  "mov",
  "avi",
  "wmv",
  "flv",
  "m4v",
  "mpeg",
  "mpg",
  "ogv",
  "gif",
  "ts",
];
export const AUDIO_FORMATS = [
  "mp3",
  "aac",
  "m4a",
  "opus",
  "ogg",
  "flac",
  "wav",
  "wma",
  "ac3",
  "eac3",
  "aiff",
];
export const IMAGE_FORMATS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "bmp",
  "tiff",
  "ico",
  "pdf",
];

export const VIDEO_EXTENSIONS = [
  "mp4",
  "mov",
  "avi",
  "mkv",
  "webm",
  "wmv",
  "flv",
  "m4v",
  "mpeg",
  "mpg",
  "3gp",
  "3g2",
  "ts",
  "mts",
  "m2ts",
  "vob",
  "ogv",
  "divx",
  "xvid",
  "asf",
  "rm",
  "rmvb",
  "f4v",
  "mxf",
  "dv",
  "tod",
  "nsv",
  "amv",
];

export const AUDIO_EXTENSIONS = [
  "mp3",
  "wav",
  "m4a",
  "flac",
  "aac",
  "ogg",
  "wma",
  "aiff",
  "aif",
  "opus",
  "ac3",
  "dts",
  "amr",
  "ape",
  "mka",
  "mpa",
  "au",
  "ra",
  "mid",
  "midi",
  "eac3",
  "tta",
  "spx",
  "wv",
  "aifc",
];

export const IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "tiff",
  "tif",
  "bmp",
  "psd",
  "heic",
  "heif",
  "webp",
  "ico",
  "jp2",
  "j2k",
  "jpf",
  "jpm",
  "raw",
  "cr2",
  "nef",
  "arw",
  "dng",
  "orf",
  "rw2",
  "pef",
  "tga",
  "sgi",
  "qtif",
  "pict",
  "icns",
  "avif",
  "jxl",
  "ppm",
  "pgm",
  "pbm",
  "pnm",
  "svg",
];

export function getFileType(
  filename: string,
): "video" | "audio" | "image" | "unknown" {
  if (!filename) return "unknown";
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (IMAGE_EXTENSIONS.includes(ext)) return "image";
  if (VIDEO_EXTENSIONS.includes(ext)) return "video";
  if (AUDIO_EXTENSIONS.includes(ext)) return "audio";
  return "unknown";
}

export function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}
