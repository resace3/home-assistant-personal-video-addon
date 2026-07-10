from __future__ import annotations

import os
from pathlib import Path

import uvicorn


def main() -> None:
    root = Path.cwd()
    os.environ["VIDEO_ROOT"] = str((root / ".e2e-media").resolve())
    os.environ["STATE_PATH"] = str((root / "test-results" / "state.json").resolve())
    os.environ["ALLOW_DIRECT"] = "1"
    uvicorn.run(
        "personal_video_studio.app.server:app",
        host="127.0.0.1",
        port=8765,
        access_log=False,
    )


if __name__ == "__main__":
    main()
