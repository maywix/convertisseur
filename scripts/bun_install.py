import os
import platform
import stat
import sys
import urllib.request
import zipfile


def _repo_root() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def _bun_dir() -> str:
    return os.path.join(_repo_root(), ".bun")


def _bun_bin_path() -> str:
    return os.path.join(_bun_dir(), "bin", "bun")


def _detect_asset_url() -> str:
    system = platform.system().lower()
    machine = platform.machine().lower()

    if system != "linux":
        raise RuntimeError("bun auto install supporte seulement linux pour le moment")

    if machine in {"x86_64", "amd64"}:
        asset = "bun-linux-x64.zip"
    elif machine in {"aarch64", "arm64"}:
        asset = "bun-linux-aarch64.zip"
    else:
        raise RuntimeError(f"architecture non supportee: {machine}")

    return f"https://github.com/oven-sh/bun/releases/latest/download/{asset}"


def _download(url: str, path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with urllib.request.urlopen(url) as r:
        data = r.read()
    with open(path, "wb") as f:
        f.write(data)


def _extract_bun(zip_path: str, bun_path: str) -> None:
    os.makedirs(os.path.dirname(bun_path), exist_ok=True)
    with zipfile.ZipFile(zip_path, "r") as zf:
        bun_member = None
        for name in zf.namelist():
            if name.endswith("/bun") and not name.endswith("/"):
                bun_member = name
                break
            if name.endswith("bun") and not name.endswith("/"):
                bun_member = name
                break

        if not bun_member:
            raise RuntimeError("bun introuvable dans l archive")

        with zf.open(bun_member) as src, open(bun_path, "wb") as dst:
            dst.write(src.read())

    mode = os.stat(bun_path).st_mode
    os.chmod(bun_path, mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def ensure_bun() -> str:
    bun_path = _bun_bin_path()
    if os.path.exists(bun_path):
        return bun_path

    url = _detect_asset_url()
    cache_zip = os.path.join(_bun_dir(), "cache", "bun.zip")
    _download(url, cache_zip)
    _extract_bun(cache_zip, bun_path)
    return bun_path


def main() -> int:
    try:
        bun_path = ensure_bun()
        print(bun_path)
        return 0
    except Exception as e:
        print(str(e), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

