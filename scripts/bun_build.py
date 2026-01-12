import os
import subprocess
import sys

from bun_install import ensure_bun


def _repo_root() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def main(argv: list[str]) -> int:
    bun = ensure_bun()

    outdir = os.path.join(_repo_root(), "static", "dist")
    os.makedirs(outdir, exist_ok=True)

    src = os.path.join(_repo_root(), "static", "js", "script.js")
    cmd = [bun, "build", src, "--outdir", outdir]
    cmd.extend(argv)

    p = subprocess.run(cmd, check=False)
    return int(p.returncode)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

