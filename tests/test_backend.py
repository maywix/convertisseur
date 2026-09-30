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
