"""Backend smoke tests with real FFmpeg conversions.

Run from the repo root:  python -m pytest tests -q
FFmpeg-dependent tests are skipped when ffmpeg is not installed.
"""
import io
import json
import os
import shutil
import subprocess
import sys
import time
import zipfile

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import app as server  # noqa: E402

HAS_FFMPEG = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None
needs_ffmpeg = pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg not installed")


@pytest.fixture()
def client():
    server.app.config["TESTING"] = True
    with server.app.test_client() as c:
        yield c
        c.delete("/clear-all")


@pytest.fixture(scope="session")
def media(tmp_path_factory):
    d = tmp_path_factory.mktemp("media")
    out = {}
    if HAS_FFMPEG:
        video = d / "clip.mp4"
        subprocess.run(
            [
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=25",
                "-f", "lavfi", "-i", "sine=frequency=440",
                "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(video),
            ],
            check=True,
        )
        out["video"] = video

    # DaVinci Resolve style LUT: BOM + CRLF + LUT_3D_INPUT_RANGE (breaks raw FFmpeg).
    n = 9
    lines = ["﻿TITLE \"warm\"", "# Created by: DaVinci Resolve", f"LUT_3D_SIZE {n}", "LUT_3D_INPUT_RANGE 0.0 1.0"]
    for b in range(n):
        for g in range(n):
            for r in range(n):
                lines.append(f"{min(1, r / (n - 1) * 1.1):.6f} {g / (n - 1):.6f} {b / (n - 1) * 0.8:.6f}")
    lut = d / "resolve.cube"
    lut.write_bytes(("\r\n".join(lines) + "\r\n").encode("utf-8"))
    out["lut"] = lut

    from PIL import Image
    img = Image.new("RGB", (64, 32), (120, 130, 140))
    exif = img.getexif()
    exif[0x0112] = 6  # rotated 90° CW: must be baked in on export
    photo = d / "photo.jpg"
    img.save(photo, exif=exif)
    out["photo"] = photo
    return out


def chunked_upload(client, path, chunk=100_000, headers=None):
    data = open(path, "rb").read()
    r = client.post("/uploads", json={"filename": os.path.basename(path), "size": len(data)}, headers=headers or {})
    assert r.status_code == 201, r.json
    upload_id = r.json["upload_id"]
    offset = 0
    while offset < len(data):
        part = data[offset:offset + chunk]
        r = client.put(f"/uploads/{upload_id}", data=part, headers={"X-Upload-Offset": str(offset)})
        assert r.status_code == 200, r.json
        offset = r.json["size"]
    return upload_id


def wait_job(client, job_id, timeout=60):
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = client.get(f"/jobs/{job_id}").json
        if job["status"] in {"done", "error"}:
            return job
        time.sleep(0.2)
    raise AssertionError("job timeout")


def probe(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,codec_name,pix_fmt,profile,width,height",
         "-of", "json", path],
        capture_output=True, text=True, check=True,
    ).stdout
    return json.loads(out)["streams"]


def download_to(client, url, tmp_path, name):
    r = client.get(url)
    assert r.status_code == 200
    target = tmp_path / name
    target.write_bytes(r.data)
    return target


def test_config_detects_cloudflare(client):
    assert client.get("/api/config").json["tunnel"] is False
    cfg = client.get("/api/config", headers={"CF-Connecting-IP": "1.2.3.4"}).json
    assert cfg["tunnel"] is True
    assert cfg["chunk_size"] < 100 * 1024 * 1024


def test_upload_resume_and_offset_check(client, media):
    data = media["photo"].read_bytes()
    r = client.post("/uploads", json={"filename": "photo.jpg", "size": len(data)})
    upload_id = r.json["upload_id"]
    half = len(data) // 2
    assert client.put(f"/uploads/{upload_id}", data=data[:half], headers={"X-Upload-Offset": "0"}).status_code == 200
    # A retried chunk with a stale offset is refused and told where to resume.
    r = client.put(f"/uploads/{upload_id}", data=data[:half], headers={"X-Upload-Offset": "0"})
    assert r.status_code == 409 and r.json["size"] == half
    assert client.get(f"/uploads/{upload_id}").json == {"size": half, "expected": len(data)}
    # Incomplete uploads cannot become jobs.
    r = client.post("/jobs", data={"action": "convert", "format": "png", "upload_id": upload_id})
    assert r.status_code == 400
    client.put(f"/uploads/{upload_id}", data=data[half:], headers={"X-Upload-Offset": str(half)})
    r = client.post("/jobs", data={"action": "convert", "format": "png", "upload_id": upload_id})
    assert r.status_code == 202


def test_bad_lut_is_rejected_with_message(client, media):
    upload_id = chunked_upload(client, media["photo"])
    r = client.post(
        "/jobs",
        data={
            "action": "convert", "format": "png", "upload_id": upload_id,
            "lut_file": (io.BytesIO(b"LUT_1D_SIZE 4\n0 0 0\n"), "bad.cube"),
        },
        content_type="multipart/form-data",
    )
    assert r.status_code == 400
    assert "1D" in r.json["error"]


@needs_ffmpeg
def test_video_with_resolve_lut_is_playable_h264(client, media, tmp_path):
    upload_id = chunked_upload(client, media["video"])
    r = client.post(
        "/jobs",
        data={
            "action": "convert", "format": "mp4", "upload_id": upload_id,
            "video_temperature": "30", "video_lift_color": "#7080a0",
            "lut_file": (io.BytesIO(media["lut"].read_bytes()), "resolve.cube"),
        },
        content_type="multipart/form-data",
    )
    assert r.status_code == 202, r.json
    job = wait_job(client, r.json["job_id"])
    assert job["status"] == "done", job["error"]
    assert job["output_size"] > 0
    out = download_to(client, job["download_url"], tmp_path, "out.mp4")
    video = [s for s in probe(str(out)) if s["codec_type"] == "video"][0]
    assert video["codec_name"] == "h264"
    assert video["pix_fmt"] == "yuv420p"  # not High 4:4:4
    assert video["profile"] != "High 4:4:4 Predictive"


@needs_ffmpeg
def test_video_to_audio_extraction(client, media, tmp_path):
    upload_id = chunked_upload(client, media["video"])
    r = client.post("/jobs", data={"action": "convert", "format": "mp3", "upload_id": upload_id})
    job = wait_job(client, r.json["job_id"])
    assert job["status"] == "done", job["error"]
    streams = probe(str(download_to(client, job["download_url"], tmp_path, "a.mp3")))
    assert [s["codec_name"] for s in streams] == ["mp3"]


@needs_ffmpeg
@pytest.mark.parametrize("fmt,codec", [("webm", "vp9"), ("mkv", "h264"), ("mov", "h264"), ("avi", "h264")])
def test_video_containers(client, media, tmp_path, fmt, codec):
    upload_id = chunked_upload(client, media["video"])
    r = client.post(
        "/jobs",
        data={"action": "convert", "format": fmt, "upload_id": upload_id, "video_max_height": "120", "trim_end": "1"},
    )
    job = wait_job(client, r.json["job_id"])
    assert job["status"] == "done", job["error"]
    video = [s for s in probe(str(download_to(client, job["download_url"], tmp_path, f"o.{fmt}"))) if s["codec_type"] == "video"][0]
    assert video["codec_name"] == codec
    assert video["height"] == 120


@needs_ffmpeg
def test_gif(client, media, tmp_path):
    upload_id = chunked_upload(client, media["video"])
    r = client.post("/jobs", data={"action": "convert", "format": "gif", "upload_id": upload_id, "gif_width": "160"})
    job = wait_job(client, r.json["job_id"])
    assert job["status"] == "done", job["error"]
    assert probe(str(download_to(client, job["download_url"], tmp_path, "o.gif")))[0]["width"] == 160


def test_image_lut_and_orientation(client, media, tmp_path):
    from PIL import Image
    upload_id = chunked_upload(client, media["photo"])
    r = client.post(
        "/jobs",
        data={
            "action": "convert", "format": "png", "upload_id": upload_id,
            "lut_file": (io.BytesIO(media["lut"].read_bytes()), "resolve.cube"),
        },
        content_type="multipart/form-data",
    )
    job = wait_job(client, r.json["job_id"])
    assert job["status"] == "done", job["error"]
    img = Image.open(download_to(client, job["download_url"], tmp_path, "o.png"))
    assert img.size == (32, 64)  # EXIF rotation applied
    r_, g_, b_ = img.convert("RGB").getpixel((5, 5))
    assert r_ > 130 and b_ < 125  # warm LUT applied (source was 120,130,140)


def test_throttled_download_and_range(client, media):
    upload_id = chunked_upload(client, media["photo"])
    job = wait_job(client, client.post("/jobs", data={"action": "convert", "format": "bmp", "upload_id": upload_id}).json["job_id"])
    assert job["status"] == "done", job["error"]
    size = job["output_size"]
    rate = 128 * 1024
    t0 = time.time()
    r = client.get(f"{job['download_url']}?rate={rate}")
    body = r.data  # the response streams lazily: time the full read
    elapsed = time.time() - t0
    assert r.status_code == 200 and len(body) == size
    assert elapsed >= size / rate * 0.7
    r = client.get(f"{job['download_url']}?rate={rate}", headers={"Range": "bytes=10-19"})
    assert r.status_code == 206 and len(r.data) == 10
    assert r.headers["Content-Range"] == f"bytes 10-19/{size}"
    # Unthrottled downloads also honour Range (resumable through the tunnel).
    assert client.get(job["download_url"], headers={"Range": "bytes=0-9"}).status_code == 206


def test_download_all_streams_only_selected_jobs(client, media):
    ids = []
    for fmt in ("png", "webp", "bmp"):
        upload_id = chunked_upload(client, media["photo"])
        job = wait_job(client, client.post("/jobs", data={"action": "convert", "format": fmt, "upload_id": upload_id}).json["job_id"])
        assert job["status"] == "done", job["error"]
        ids.append(job["id"])
    r = client.get(f"/download-all?ids={ids[0]},{ids[1]}")
    assert r.status_code == 200
    names = sorted(zipfile.ZipFile(io.BytesIO(r.data)).namelist())
    assert names == ["photo.png", "photo.webp"]
    listed = client.get(f"/jobs?ids={ids[2]}").json["jobs"]
    assert [j["id"] for j in listed] == [ids[2]]
    assert "output_path" not in listed[0]


def test_delete_job_removes_it(client, media):
    upload_id = chunked_upload(client, media["photo"])
    job = wait_job(client, client.post("/jobs", data={"action": "convert", "format": "png", "upload_id": upload_id}).json["job_id"])
    assert client.delete(f"/jobs/{job['id']}").json["deleted"] is True
    assert client.get(f"/jobs/{job['id']}").status_code == 404


def test_unicode_names_survive(client, media):
    data = media["photo"].read_bytes()
    r = client.post("/uploads", json={"filename": "été 视频.jpg", "size": len(data)})
    upload_id = r.json["upload_id"]
    client.put(f"/uploads/{upload_id}", data=data, headers={"X-Upload-Offset": "0"})
    job = wait_job(client, client.post("/jobs", data={"action": "convert", "format": "png", "upload_id": upload_id}).json["job_id"])
    assert job["status"] == "done", job["error"]
    assert job["output_filename"] == "été 视频.png"
    r = client.get(job["download_url"])
    assert "filename*=UTF-8''" in r.headers["Content-Disposition"]


def run_job(client, path, fields, tmp_path, name):
    upload_id = chunked_upload(client, path)
    r = client.post("/jobs", data={**fields, "upload_id": upload_id})
    assert r.status_code == 202, r.json
    job = wait_job(client, r.json["job_id"], timeout=120)
    assert job["status"] == "done", job["error"]
    return job, download_to(client, job["download_url"], tmp_path, name)


def full_probe(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "stream=codec_type,codec_name,pix_fmt,profile,width,height,sample_rate,channels,avg_frame_rate",
         "-of", "json", path],
        capture_output=True, text=True, check=True,
    ).stdout
    return json.loads(out)["streams"]


@needs_ffmpeg
@pytest.mark.parametrize("label,fields,check", [
    ("crf", {"video_crf": "30", "video_preset": "ultrafast"},
     lambda v, a: v["codec_name"] == "h264"),
    ("bitrate_2pass", {"video_quality_mode": "bitrate", "video_bitrate_k": "300", "two_pass": "1"},
     lambda v, a: v["codec_name"] == "h264"),
    ("exact_size_crop_vflip", {"video_resize_width": "161", "crop_top": "11", "rotate": "vflip"},
     lambda v, a: v["width"] == 160 and v["height"] % 2 == 0),  # odd width rounded for 4:2:0
    ("fps_profile_tune", {"fps": "12", "video_profile": "baseline", "video_tune": "animation"},
     lambda v, a: v["avg_frame_rate"] == "12/1" and v["profile"].startswith("Constrained Baseline")),
    ("hevc_10bit", {"video_codec": "libx265", "video_pixel_format": "yuv420p10le"},
     lambda v, a: v["codec_name"] == "hevc" and v["pix_fmt"] == "yuv420p10le"),
    ("audio_mono_44k", {"audio_channels": "1", "audio_sample_rate": "44100", "audio_volume": "-3"},
     lambda v, a: a["channels"] == 1 and a["sample_rate"] == "44100"),
    ("audio_copy_overlay", {"audio_codec": "copy", "overlay_text": "Test", "overlay_text_x": "text_h", "overlay_text_y": "text_h",
                            "deinterlace": "1", "denoise": "light"},
     lambda v, a: a["codec_name"] == "aac"),
])
def test_advanced_video_options(client, media, tmp_path, label, fields, check):
    _, out = run_job(client, media["video"], {"action": "convert", "format": "mp4", **fields}, tmp_path, f"{label}.mp4")
    streams = full_probe(str(out))
    video = next(s for s in streams if s["codec_type"] == "video")
    audio = next((s for s in streams if s["codec_type"] == "audio"), {})
    assert check(video, audio), streams


@needs_ffmpeg
def test_gif_play_once_and_dither(client, media, tmp_path):
    _, out = run_job(client, media["video"], {
        "action": "convert", "format": "gif", "gif_loop": "-1", "gif_dither": "bayer", "gif_colors": "16", "gif_width": "120",
    }, tmp_path, "once.gif")
    data = out.read_bytes()
    assert data[:6] in (b"GIF89a", b"GIF87a")
    assert b"NETSCAPE2.0" not in data  # no loop extension = plays once


def test_advanced_image_options(client, media, tmp_path):
    from PIL import Image
    _, out = run_job(client, media["photo"], {
        "action": "convert", "format": "ico", "ico_size": "32",
    }, tmp_path, "icon.ico")
    assert Image.open(out).size == (32, 32)
    _, out = run_job(client, media["photo"], {
        "action": "convert", "format": "webp", "lossless": "1", "image_resize_mode": "percent", "image_resize_percent": "200",
    }, tmp_path, "big.webp")
    assert Image.open(out).size == (64, 128)
    big = tmp_path / "noise.png"
    import numpy as np
    Image.fromarray((np.random.rand(600, 800, 3) * 255).astype("uint8")).save(big)
    job, out = run_job(client, big, {
        "action": "convert_compress", "format": "jpg", "comp_mode": "size", "comp_value": "0.1",
    }, tmp_path, "small.jpg")
    assert job["output_size"] <= 0.1 * 1024 * 1024


@needs_ffmpeg
def test_compress_levels_keep_format_and_shrink(client, media, tmp_path):
    sizes = {}
    for level in ("low", "high"):
        job, out = run_job(client, media["video"], {
            "action": "compress", "comp_mode": "crf", "comp_value": level,
        }, tmp_path, f"{level}.mp4")
        assert job["output_filename"].endswith(".mp4")
        assert [s["codec_name"] for s in probe(str(out)) if s["codec_type"] == "video"] == ["h264"]
        sizes[level] = job["output_size"]
    assert sizes["high"] < sizes["low"]


@needs_ffmpeg
def test_stalled_ffmpeg_is_killed(tmp_path, monkeypatch):
    fifo = tmp_path / "never.fifo"
    os.mkfifo(fifo)  # nobody writes: ffmpeg waits forever without progress
    monkeypatch.setattr(server, "VIDEO_STALL_TIMEOUT", 1)
    t0 = time.time()
    with pytest.raises(RuntimeError, match="ne progressait plus"):
        server._run_ffmpeg_tracked(
            ["ffmpeg", "-y", "-f", "s16le", "-i", str(fifo), str(tmp_path / "out.wav")],
            job_id="0" * 32, total_us=10_000_000,
        )
    assert time.time() - t0 < 30


# ───────────────────────── PDF (Ghostscript) ─────────────────────────

HAS_GS = shutil.which("gs") is not None
needs_gs = pytest.mark.skipif(not HAS_GS, reason="ghostscript not installed")


def _photo_like(size=(1200, 900), alpha=False):
    """Smooth gradient + noise: compresses like a real photo."""
    import numpy as np
    from PIL import Image
    w, h = size
    yy, xx = np.mgrid[0:h, 0:w]
    base = np.stack([xx / w * 255, yy / h * 255, (xx + yy) / (w + h) * 255], axis=-1)
    noise = np.random.default_rng(1).normal(0, 18, (h, w, 3))
    rgb = np.clip(base + noise, 0, 255).astype("uint8")
    img = Image.fromarray(rgb)
    if alpha:
        img = img.convert("RGBA")
        a = img.getchannel("A").point(lambda _: 255)
        a.paste(0, (0, 0, w // 3, h // 3))  # transparent top-left corner
        img.putalpha(a)
    return img


def _image_pdf(path, pages=1, dpi=300):
    imgs = [_photo_like() for _ in range(pages)]
    imgs[0].save(path, "PDF", resolution=float(dpi), save_all=True, append_images=imgs[1:], quality=95)
    return path


@needs_gs
def test_pdf_compress_shrinks_images(client, tmp_path):
    src = _image_pdf(tmp_path / "scan.pdf")
    job, out = run_job(client, src, {"action": "compress", "comp_mode": "crf", "comp_value": "high"}, tmp_path, "small.pdf")
    assert job["output_filename"] == "scan.pdf"
    assert job["output_size"] < os.path.getsize(src) * 0.5
    assert out.read_bytes()[:5] == b"%PDF-"


@needs_gs
def test_pdf_size_target_tries_levels(client, tmp_path):
    src = _image_pdf(tmp_path / "big.pdf")
    target_mb = os.path.getsize(src) / 1024 / 1024 / 4
    job, _ = run_job(client, src, {"action": "compress", "comp_mode": "size", "comp_value": f"{target_mb:.3f}"}, tmp_path, "t.pdf")
    assert job["output_size"] <= target_mb * 1024 * 1024


def test_compress_never_returns_a_heavier_file(client, tmp_path):
    from pypdf import PdfWriter
    w = PdfWriter()
    w.add_blank_page(width=200, height=200)
    src = tmp_path / "blank.pdf"
    with open(src, "wb") as f:
        w.write(f)
    job, out = run_job(client, src, {"action": "compress", "comp_mode": "crf", "comp_value": "medium"}, tmp_path, "b.pdf")
    assert job["output_size"] <= os.path.getsize(src)
    if job["output_size"] == os.path.getsize(src):
        assert job["note"] == "kept"
        assert out.read_bytes() == src.read_bytes()


@needs_gs
def test_pdf_pages_to_images(client, tmp_path):
    from PIL import Image
    one = _image_pdf(tmp_path / "one.pdf", pages=1, dpi=150)
    job, out = run_job(client, one, {"action": "convert", "format": "jpg"}, tmp_path, "one.jpg")
    assert job["output_filename"] == "one.jpg"
    assert Image.open(out).format == "JPEG"
    two = _image_pdf(tmp_path / "two.pdf", pages=2, dpi=150)
    job, out = run_job(client, two, {"action": "convert", "format": "png"}, tmp_path, "two.zip")
    assert job["output_filename"] == "two.zip"
    assert zipfile.ZipFile(out).namelist() == ["two-page-001.png", "two-page-002.png"]


# ───────────────────────── Images ─────────────────────────

def test_png_compress_uses_a_palette(client, tmp_path):
    from PIL import Image
    src = tmp_path / "shot.png"
    _photo_like((600, 400), alpha=True).save(src, compress_level=1)
    job, out = run_job(client, src, {"action": "compress", "comp_mode": "crf", "comp_value": "medium", "image_quality": "70"}, tmp_path, "s.png")
    assert job["output_size"] < os.path.getsize(src) * 0.6
    img = Image.open(out)
    assert img.size == (600, 400)
    assert img.convert("RGBA").getpixel((5, 5))[3] == 0  # transparency kept


def test_raw_like_inputs_compress_to_jpg(client, tmp_path):
    from PIL import Image
    src = tmp_path / "layers.psd"
    _photo_like((64, 48)).save(tmp_path / "tmp.tif")
    os.rename(tmp_path / "tmp.tif", src)  # Pillow reads it by content; .psd cannot be written back
    job, out = run_job(client, src, {"action": "compress", "comp_mode": "crf", "comp_value": "medium", "image_quality": "70"}, tmp_path, "l.jpg")
    assert job["output_filename"] == "layers.jpg"
    assert Image.open(out).format == "JPEG"


def test_cmyk_and_transparency_conversions(client, tmp_path):
    from PIL import Image
    cmyk = tmp_path / "print.jpg"
    Image.new("CMYK", (40, 30), (0, 255, 255, 0)).save(cmyk)  # red ink
    _, out = run_job(client, cmyk, {"action": "convert", "format": "png"}, tmp_path, "p.png")
    r, g, b = Image.open(out).convert("RGB").getpixel((5, 5))
    assert r > 200 and g < 60 and b < 60

    logo = tmp_path / "logo.png"
    _photo_like((90, 90), alpha=True).save(logo)
    _, out = run_job(client, logo, {"action": "convert", "format": "jpg"}, tmp_path, "l.jpg")
    assert min(Image.open(out).convert("RGB").getpixel((3, 3))) > 235  # white, not black

    deep = tmp_path / "deep.png"
    Image.new("I;16", (20, 20), 40000).save(deep)
    _, out = run_job(client, deep, {"action": "convert", "format": "jpg"}, tmp_path, "d.jpg")
    assert 140 < Image.open(out).convert("L").getpixel((5, 5)) < 170  # 40000/65535 ≈ 61 %


def _exif_photo(path):
    from PIL import Image
    img = _photo_like((80, 60))
    exif = Image.Exif()
    exif[0x0132] = "2024:05:06 07:08:09"  # DateTime
    exif[0x010F] = "TestCam"  # Make
    gps = exif.get_ifd(0x8825)
    gps[1] = "N"
    gps[2] = (48.0, 51.0, 24.0)
    img.save(path, exif=exif, icc_profile=_srgb_icc())
    return path


def _srgb_icc():
    from PIL import ImageCms
    return ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()


@pytest.mark.parametrize("mode,has_date,has_gps", [("nogps", True, False), ("keep", True, True), ("strip", False, False)])
def test_photo_metadata_choices(client, tmp_path, mode, has_date, has_gps):
    from PIL import Image
    src = _exif_photo(tmp_path / f"exif_{mode}.jpg")
    _, out = run_job(client, src, {"action": "convert", "format": "jpg", "metadata": mode}, tmp_path, f"m_{mode}.jpg")
    img = Image.open(out)
    exif = img.getexif()
    assert (exif.get(0x0132) == "2024:05:06 07:08:09") is has_date
    assert bool(exif.get_ifd(0x8825)) is has_gps
    assert img.info.get("icc_profile")  # colour profile always kept


# ───────────────────────── Video / audio ─────────────────────────

@pytest.fixture(scope="session")
def silent_video(tmp_path_factory):
    if not HAS_FFMPEG:
        pytest.skip("ffmpeg not installed")
    path = tmp_path_factory.mktemp("silent") / "mute.mp4"
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=25",
         "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(path)],
        check=True,
    )
    return path


def probe_duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)],
                         capture_output=True, text=True, check=True).stdout
    return float(json.loads(out)["format"]["duration"])


@needs_ffmpeg
def test_sound_extraction_from_a_silent_video_says_why(client, silent_video):
    upload_id = chunked_upload(client, silent_video)
    job = wait_job(client, client.post("/jobs", data={"action": "convert", "format": "mp3", "upload_id": upload_id}).json["job_id"])
    assert job["status"] == "error"
    assert "piste son" in job["error"]


@needs_ffmpeg
def test_silent_video_converts(client, silent_video, tmp_path):
    _, out = run_job(client, silent_video, {"action": "convert", "format": "webm"}, tmp_path, "mute.webm")
    assert [s["codec_type"] for s in probe(str(out))] == ["video"]


@needs_ffmpeg
def test_speed_and_aspect_ratio(client, media, tmp_path):
    _, out = run_job(client, media["video"], {"action": "convert", "format": "mp4", "speed": "2", "aspect": "1:1"}, tmp_path, "fast.mp4")
    video = next(s for s in probe(str(out)) if s["codec_type"] == "video")
    assert video["width"] == video["height"] == 240
    assert 0.8 < probe_duration(out) < 1.3


@needs_ffmpeg
def test_slow_motion_audio(client, media, tmp_path):
    _, out = run_job(client, media["video"], {"action": "convert", "format": "m4a", "speed": "0.25"}, tmp_path, "slow.m4a")
    assert 7 < probe_duration(out) < 9


@needs_ffmpeg
def test_frame_capture(client, media, tmp_path):
    from PIL import Image
    job, out = run_job(client, media["video"], {"action": "convert", "format": "jpg", "capture_at": "1"}, tmp_path, "cap.jpg")
    assert job["output_filename"] == "clip.jpg"
    img = Image.open(out)
    assert img.format == "JPEG" and img.size == (320, 240)


@needs_ffmpeg
def test_frames_zip_respects_trim(client, media, tmp_path):
    _, out = run_job(client, media["video"], {"action": "convert", "format": "zip", "sequence_fps": "10", "trim_end": "1"}, tmp_path, "f.zip")
    assert 9 <= len(zipfile.ZipFile(out).namelist()) <= 11


@needs_ffmpeg
def test_size_target_is_respected(client, media, tmp_path):
    target_mb = 0.05
    job, out = run_job(client, media["video"], {"action": "compress", "comp_mode": "size", "comp_value": str(target_mb)}, tmp_path, "t.mp4")
    assert job["output_size"] <= target_mb * 1024 * 1024
    assert any(s["codec_type"] == "audio" for s in probe(str(out)))


@needs_ffmpeg
def test_slideshow_with_odd_sizes(client, tmp_path):
    from PIL import Image
    ids = []
    for i in range(3):
        p = tmp_path / f"img{i}.png"
        Image.new("RGB", (101, 75), (i * 80, 100, 150)).save(p)
        ids.append(chunked_upload(client, p))
    r = client.post("/jobs", data={"action": "convert", "format": "mp4", "upload_ids": ",".join(ids), "sequence_fps": "1"})
    assert r.status_code == 202, r.json
    job = wait_job(client, r.json["job_id"], timeout=120)
    assert job["status"] == "done", job["error"]
    out = download_to(client, job["download_url"], tmp_path, "show.mp4")
    video = next(s for s in probe(str(out)) if s["codec_type"] == "video")
    assert video["width"] % 2 == 0 and video["height"] % 2 == 0
    assert 2.5 < probe_duration(out) < 3.5


def test_single_image_to_gif_is_a_still_gif(client, media, tmp_path):
    from PIL import Image
    job, out = run_job(client, media["photo"], {"action": "convert", "format": "gif"}, tmp_path, "still.gif")
    img = Image.open(out)
    assert img.format == "GIF" and img.size == (32, 64)


@needs_ffmpeg
def test_video_location_metadata(client, tmp_path):
    src = tmp_path / "phone.mov"
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=160x120:rate=25",
         "-t", "1", "-metadata", "location=+48.8566+002.3522/", "-metadata", "title=Vacances",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", str(src)],
        check=True,
    )

    def tags(path):
        out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format_tags", "-of", "json", str(path)],
                             capture_output=True, text=True, check=True).stdout
        return {k.lower(): v for k, v in (json.loads(out).get("format", {}).get("tags") or {}).items()}

    assert "location" in tags(src)
    _, out = run_job(client, src, {"action": "convert", "format": "mov"}, tmp_path, "nogps.mov")
    assert "location" not in tags(out) and tags(out).get("title") == "Vacances"
    _, out = run_job(client, src, {"action": "convert", "format": "mov", "metadata": "strip"}, tmp_path, "strip.mov")
    assert "title" not in tags(out)


@pytest.mark.skipif(shutil.which("libreoffice") is None, reason="libreoffice not installed")
def test_office_documents_convert_side_by_side(client, tmp_path):
    ids = []
    for i in range(2):
        p = tmp_path / f"table{i}.csv"
        p.write_text("a,b\n1,2\n", encoding="utf-8")
        upload_id = chunked_upload(client, p)
        r = client.post("/jobs", data={"action": "convert", "format": "pdf", "upload_id": upload_id})
        ids.append(r.json["job_id"])
    for job_id in ids:
        job = wait_job(client, job_id, timeout=180)
        assert job["status"] == "done", job["error"]
        assert job["output_filename"].endswith(".pdf")


@needs_gs
def test_pdf_preview_pages(client, tmp_path):
    src = _image_pdf(tmp_path / "pv.pdf", pages=2, dpi=150)
    job, _ = run_job(client, src, {"action": "compress", "comp_mode": "crf", "comp_value": "medium"}, tmp_path, "pv_out.pdf")
    r = client.get(f"/jobs/{job['id']}/preview.png?page=2")
    assert r.status_code == 200
    assert r.headers["X-Page-Count"] == "2"
    assert r.data[:8] == b"\x89PNG\r\n\x1a\n"
