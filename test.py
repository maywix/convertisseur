import argparse
import io
import os
import shutil
import subprocess
import sys
import tempfile
import time


def _repo_root() -> str:
    return os.path.abspath(os.path.dirname(__file__))


def _ensure_import_paths() -> None:
    root = _repo_root()
    if root not in sys.path:
        sys.path.insert(0, root)

    libs = os.path.join(root, "libs")
    if os.path.isdir(libs) and libs not in sys.path:
        sys.path.insert(0, libs)


def _has_ffmpeg() -> bool:
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def _run(cmd: list[str]) -> None:
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        msg = (p.stderr or p.stdout or "").strip()
        raise RuntimeError(msg or "commande externe echouee")


def _make_images(out_dir: str, count: int) -> list[str]:
    from PIL import Image

    paths: list[str] = []
    for i in range(count):
        size = 2200 + (i % 3) * 800
        img = Image.new("RGB", (size, size), (255, 0, 0))
        p = os.path.join(out_dir, f"img_{i:03d}.png")
        img.save(p, format="PNG", optimize=True)
        paths.append(p)
    return paths


def _make_pdf_reportlab(out_dir: str, pages: int) -> tuple[str, bool]:
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.pdfgen import canvas
    except Exception:
        return "", False

    p = os.path.join(out_dir, "doc_reportlab.pdf")
    c = canvas.Canvas(p, pagesize=A4)
    for i in range(pages):
        c.setFont("Helvetica", 18)
        c.drawString(72, 800, f"hello page {i+1}")
        c.setFont("Helvetica", 12)
        c.drawString(72, 770, "convertisseur test pdf")
        c.showPage()
    c.save()
    return p, True


def _make_pdf_fallback(out_dir: str) -> str:
    from PIL import Image

    img = Image.new("RGB", (800, 1100), (255, 255, 255))
    p = os.path.join(out_dir, "doc_fallback.pdf")
    img.save(p, format="PDF")
    return p


def _make_pdf_files(out_dir: str, *, count: int, pages: int) -> tuple[list[str], bool]:
    paths: list[str] = []
    has_reportlab = False

    base, ok = _make_pdf_reportlab(out_dir, pages=pages)
    if ok:
        has_reportlab = True
        paths.append(base)
        for i in range(1, count):
            p = os.path.join(out_dir, f"doc_reportlab_{i:03d}.pdf")
            shutil.copyfile(base, p)
            paths.append(p)
        return paths, has_reportlab

    base = _make_pdf_fallback(out_dir)
    paths.append(base)
    for i in range(1, count):
        p = os.path.join(out_dir, f"doc_fallback_{i:03d}.pdf")
        shutil.copyfile(base, p)
        paths.append(p)
    return paths, has_reportlab


def _make_audio_files(out_dir: str, count: int) -> list[str]:
    paths: list[str] = []
    for i in range(count):
        wav = os.path.join(out_dir, f"audio_{i:03d}.wav")
        _run(
            [
                "ffmpeg",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=1000:duration=2",
                "-c:a",
                "pcm_s16le",
                wav,
            ]
        )
        paths.append(wav)
    return paths


def _make_video_file(out_dir: str) -> str:
    mp4 = os.path.join(out_dir, "video.mp4")
    _run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=1280x720:rate=30:duration=3",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=3",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            mp4,
        ]
    )
    return mp4


def _post_job(client, path: str, *, action: str, fmt: str | None = None, comp_mode: str | None = None, comp_value: str | None = None) -> str:
    with open(path, "rb") as f:
        data: dict = {"action": action, "file": (io.BytesIO(f.read()), os.path.basename(path))}
        if fmt is not None:
            data["format"] = fmt
        if comp_mode is not None:
            data["comp_mode"] = comp_mode
        if comp_value is not None:
            data["comp_value"] = comp_value

        r = client.post("/jobs", data=data, content_type="multipart/form-data")
        if r.status_code != 202:
            raise RuntimeError(f"create job failed {r.status_code} {r.data!r}")
        return r.get_json()["job_id"]


def _poll(client, job_id: str, timeout_s: int = 180) -> dict:
    deadline = time.time() + timeout_s
    last = None
    while time.time() < deadline:
        r = client.get(f"/jobs/{job_id}")
        if r.status_code != 200:
            raise RuntimeError(f"poll failed {r.status_code} {r.data!r}")
        data = r.get_json()
        last = data
        if data["status"] in {"done", "error"}:
            return data
        time.sleep(0.2)
    raise RuntimeError(f"timeout job {job_id} last={last}")


def _download(client, url: str) -> bytes:
    r = client.get(url)
    if r.status_code != 200:
        raise RuntimeError(f"download failed {r.status_code} {r.data!r}")
    return r.data


def _parse_args() -> argparse.Namespace:
    cpu = os.cpu_count() or 1
    p = argparse.ArgumentParser(
        description="generate media then convert via jobs api and verify outputs",
    )
    p.add_argument("--count-audio", type=int, default=cpu)
    p.add_argument("--count-image", type=int, default=max(1, cpu // 2))
    p.add_argument("--count-pdf-jobs", type=int, default=max(1, cpu // 2))
    p.add_argument("--count-pdf-pages", type=int, default=4)
    p.add_argument("--count-video", type=int, default=1)
    p.add_argument("--skip-ffmpeg", action="store_true")
    return p.parse_args()


def main() -> int:
    args = _parse_args()
    _ensure_import_paths()

    cpu = os.cpu_count() or 1
    count_audio = max(0, int(args.count_audio))
    count_image = max(1, int(args.count_image))
    count_pdf_pages = max(2, int(args.count_pdf_pages))
    count_pdf_jobs = max(1, int(args.count_pdf_jobs))
    count_video = max(0, int(args.count_video))

    os.environ.setdefault("TEST_SLEEP_IMAGE_SECONDS", "0.4")
    os.environ.setdefault("TEST_SLEEP_PDF_SECONDS", "0.4")
    os.environ.setdefault("TEST_SLEEP_AUDIO_SECONDS", "0.4")
    os.environ.setdefault("TEST_SLEEP_VIDEO_SECONDS", "0.4")

    import app as app_module

    app = app_module.app
    app.config["TESTING"] = True

    with tempfile.TemporaryDirectory() as tmp:
        img_paths = _make_images(tmp, count_image)

        pdf_paths, has_reportlab = _make_pdf_files(tmp, count=count_pdf_jobs, pages=count_pdf_pages)

        audio_paths: list[str] = []
        video_path = ""
        if not args.skip_ffmpeg:
            if not _has_ffmpeg():
                raise RuntimeError("ffmpeg et ffprobe manquants, installe ffmpeg ou utilise --skip-ffmpeg")

            audio_paths = _make_audio_files(tmp, count_audio)
            if count_video:
                video_path = _make_video_file(tmp)

        with app.test_client() as c:
            r = c.get("/health")
            if r.status_code != 200:
                raise RuntimeError(f"health failed {r.status_code} {r.data!r}")

            jobs: list[tuple[str, str]] = []

            for p in img_paths:
                jobs.append((_post_job(c, p, action="convert", fmt="pdf"), "image"))

            for p in pdf_paths:
                jobs.append((_post_job(c, p, action="convert", fmt="txt"), "pdf"))

            for p in audio_paths:
                jobs.append((_post_job(c, p, action="convert", fmt="m4a"), "audio"))

            if video_path:
                jobs.append((_post_job(c, video_path, action="convert", fmt="webm"), "video"))

            pending = {jid: mtype for jid, mtype in jobs}
            saw_parallel = {"audio": False, "image": False, "pdf": False, "video": False}

            while pending:
                r = c.get("/jobs?limit=200")
                data = r.get_json() if r.status_code == 200 else {"jobs": []}
                status_by_id = {j["id"]: j for j in (data.get("jobs") or [])}

                for mtype in ("audio", "image", "pdf", "video"):
                    processing = [j for j in status_by_id.values() if j.get("media_type") == mtype and j.get("status") == "processing"]
                    if mtype in {"audio", "image", "pdf"} and len(processing) >= 2:
                        saw_parallel[mtype] = True

                done_ids: list[str] = []
                for jid in list(pending.keys()):
                    job = _poll(c, jid, timeout_s=240)
                    if job["status"] == "error":
                        if job.get("media_type") in {"audio", "video"} and not _has_ffmpeg():
                            done_ids.append(jid)
                            continue
                        raise RuntimeError(f"job failed {jid} {job}")

                    body = _download(c, job["download_url"])
                    if pending[jid] == "image":
                        if body[:4] != b"%PDF":
                            raise RuntimeError("image convert output is not a pdf")
                    if pending[jid] == "pdf":
                        if has_reportlab:
                            if not body:
                                raise RuntimeError("pdf txt output empty")
                            if b"convertisseur" not in body.lower():
                                raise RuntimeError("pdf txt output missing expected text")
                    if pending[jid] == "audio":
                        if len(body) < 16:
                            raise RuntimeError("audio output too small")
                        if body[4:8] != b"ftyp":
                            raise RuntimeError("audio output is not an mp4 family container")
                    if pending[jid] == "video":
                        if len(body) < 8:
                            raise RuntimeError("video output too small")
                        if body[:4] != b"\x1a\x45\xdf\xa3":
                            raise RuntimeError("video output is not an ebml container")
                    done_ids.append(jid)

                for jid in done_ids:
                    pending.pop(jid, None)

            if count_image >= 2 and not saw_parallel["image"]:
                raise RuntimeError("no image parallelism observed")
            if count_pdf_jobs >= 2 and not saw_parallel["pdf"]:
                raise RuntimeError("no pdf parallelism observed")
            if audio_paths and count_audio >= 2 and not saw_parallel["audio"]:
                raise RuntimeError("no audio parallelism observed")

    print("test ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

