import io
import os
import sys
import time


def _make_png_bytes() -> bytes:
    from PIL import Image

    img = Image.new("RGB", (32, 32), (255, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _poll(client, job_id: str, timeout_s: int = 30) -> dict:
    deadline = time.time() + timeout_s
    last = None
    while time.time() < deadline:
        r = client.get(f"/jobs/{job_id}")
        assert r.status_code == 200, r.data
        data = r.get_json()
        last = data
        if data["status"] in {"done", "error"}:
            return data
        time.sleep(0.2)
    raise RuntimeError(f"timeout job {job_id} last={last}")


def main() -> None:
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    if repo_root not in sys.path:
        sys.path.insert(0, repo_root)

    import app as app_module

    app = app_module.app
    app.config["TESTING"] = True

    with app.test_client() as c:
        r = c.get("/health")
        assert r.status_code == 200
        assert r.get_json()["ok"] is True

        png = _make_png_bytes()
        data = {
            "action": "convert",
            "format": "pdf",
            "file": (io.BytesIO(png), "test.png"),
        }
        r = c.post("/jobs", data=data, content_type="multipart/form-data")
        assert r.status_code == 202, r.data
        job_id = r.get_json()["job_id"]

        job = _poll(c, job_id, timeout_s=60)
        assert job["status"] == "done", job
        assert job["download_url"], job

        r = c.get(job["download_url"])
        assert r.status_code == 200, r.data
        body = r.data
        assert body[:4] == b"%PDF", body[:32]

        r = c.get("/jobs?limit=10")
        assert r.status_code == 200
        jobs = r.get_json()["jobs"]
        assert any(j["id"] == job_id for j in jobs), jobs

    with app.test_client() as c2:
        r = c2.get(f"/jobs/{job_id}")
        assert r.status_code == 404
        r = c2.get(f"/download/{job_id}")
        assert r.status_code == 404

    print("smoke ok")


if __name__ == "__main__":
    main()

