from __future__ import annotations

import json
import subprocess
from pathlib import Path


def main() -> None:
    root = Path("test-results/e2e-media")
    entries = []
    for period, identifier, color in (
        ("daily", "daily-2026-07-10", "#183252"),
        ("weekly", "weekly-2026-w28", "#244d47"),
    ):
        folder = root / period / "2026" / "07"
        folder.mkdir(parents=True, exist_ok=True)
        video = folder / f"{identifier}.mp4"
        subprocess.run(
            [
                "ffmpeg", "-y", "-f", "lavfi", "-i", f"color=c={color}:s=240x426:r=12:d=60",
                "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=24000:duration=60",
                "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac",
                "-movflags", "+faststart", "-shortest", str(video),
            ],
            check=True,
            capture_output=True,
        )
        thumbnail = folder / f"{identifier}.webp"
        subprocess.run(["ffmpeg", "-y", "-i", str(video), "-frames:v", "1", str(thumbnail)], check=True, capture_output=True)
        captions = folder / f"{identifier}.vtt"
        captions.write_text("WEBVTT\n\n00:00.000 --> 00:10.000\nSynthetic private reflection\n", encoding="utf-8")
        entries.append(
            {
                "id": identifier,
                "type": period,
                "title": f"Synthetic {period.title()} Reflection",
                "description": "Deterministic synthetic fixture",
                "created_at": "2026-07-10T12:00:00Z",
                "duration_seconds": 60,
                "video_filename": video.name,
                "thumbnail_filename": thumbnail.name,
                "captions_filename": captions.name,
                "relative_directory": str(folder.relative_to(root)).replace("\\", "/"),
                "generation_status": "complete",
            }
        )
    (root / "indexes").mkdir(parents=True, exist_ok=True)
    (root / "indexes" / "all.json").write_text(json.dumps(entries), encoding="utf-8")


if __name__ == "__main__":
    main()

