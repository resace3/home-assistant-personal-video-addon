from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from personal_video_studio.app import server


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    root = tmp_path / "media"
    folder = root / "daily" / "2026" / "07"
    folder.mkdir(parents=True)
    video_bytes = bytes(range(256)) * 8
    (folder / "daily-2026-07-10.mp4").write_bytes(video_bytes)
    (folder / "daily-2026-07-10.webp").write_bytes(b"webp")
    (folder / "daily-2026-07-10.vtt").write_text("WEBVTT\n\n00:00.000 --> 00:01.000\nSynthetic", encoding="utf-8")
    index = [
        {
            "id": "daily-2026-07-10",
            "type": "daily",
            "title": "Synthetic Daily Reflection",
            "description": "Safe synthetic fixture",
            "created_at": "2026-07-10T12:00:00Z",
            "duration_seconds": 60,
            "video_filename": "daily-2026-07-10.mp4",
            "thumbnail_filename": "daily-2026-07-10.webp",
            "captions_filename": "daily-2026-07-10.vtt",
            "relative_directory": "daily/2026/07",
            "generation_status": "complete",
        }
    ]
    (root / "indexes").mkdir()
    (root / "indexes" / "all.json").write_text(json.dumps(index), encoding="utf-8")
    monkeypatch.setenv("VIDEO_ROOT", str(root))
    monkeypatch.setattr(server, "STATE_PATH", tmp_path / "state.json")
    return TestClient(server.app)


def test_health_and_security_headers(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["video_count"] == 1
    assert "default-src 'self'" in response.headers["content-security-policy"]
    assert "SUPERVISOR_TOKEN" not in response.text


def test_paginated_daily_catalog(client: TestClient) -> None:
    payload = client.get("/api/videos", params={"period": "daily", "page": 1, "page_size": 10}).json()
    assert payload["total"] == 1
    assert payload["items"][0]["id"] == "daily-2026-07-10"


@pytest.mark.parametrize(
    ("header", "status", "content", "content_range"),
    [
        ("bytes=0-0", 206, bytes([0]), "bytes 0-0/2048"),
        ("bytes=100-", 206, (bytes(range(256)) * 8)[100:], "bytes 100-2047/2048"),
        ("bytes=-5", 206, bytes([251, 252, 253, 254, 255]), "bytes 2043-2047/2048"),
    ],
)
def test_range_streaming(client: TestClient, header: str, status: int, content: bytes, content_range: str) -> None:
    response = client.get("/api/videos/daily-2026-07-10/stream", headers={"Range": header})
    assert response.status_code == status
    assert response.content == content
    assert response.headers["content-range"] == content_range
    assert response.headers["accept-ranges"] == "bytes"


def test_unsatisfiable_and_multiple_ranges_return_416(client: TestClient) -> None:
    for header in ("bytes=9999-", "bytes=0-1,3-4", "widgets=0-1"):
        response = client.get("/api/videos/daily-2026-07-10/stream", headers={"Range": header})
        assert response.status_code == 416
        assert response.headers["content-range"] == "bytes */2048"


def test_head_stream_has_no_body(client: TestClient) -> None:
    response = client.head("/api/videos/daily-2026-07-10/stream", headers={"Range": "bytes=10-19"})
    assert response.status_code == 206
    assert response.content == b""
    assert response.headers["content-length"] == "10"


def test_preferences_require_same_origin_header(client: TestClient) -> None:
    url = "/api/videos/daily-2026-07-10/preferences"
    assert client.post(url, json={"liked": True}).status_code == 403
    response = client.post(url, json={"liked": True}, headers={"X-Requested-With": "PersonalVideoStudio"})
    assert response.status_code == 200
    assert response.json()["liked"] is True
    assert client.get("/api/videos/daily-2026-07-10").json()["liked"] is True


def test_corrupt_or_oversized_catalog_fails_closed(client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    root = Path(server._media_root())
    (root / "indexes" / "all.json").write_text("not-json", encoding="utf-8")
    assert client.get("/api/videos").json()["items"] == []


def test_unknown_id_and_encoded_traversal_are_not_resolved(client: TestClient) -> None:
    assert client.get("/api/videos/not-found/stream").status_code == 404
    assert client.get("/api/videos/..%2F..%2Fetc%2Fpasswd/stream").status_code in {404, 422}


@pytest.mark.parametrize("path", ["/etc", "//etc", "daily/../etc", "daily\\2026", "./daily/2026"])
def test_catalog_rejects_absolute_and_noncanonical_paths(path: str) -> None:
    payload = {
        "id": "daily-safe-test",
        "type": "daily",
        "title": "Synthetic",
        "created_at": "2026-07-10T12:00:00Z",
        "duration_seconds": 60,
        "video_filename": "safe.mp4",
        "thumbnail_filename": "safe.webp",
        "captions_filename": "safe.vtt",
        "relative_directory": path,
        "generation_status": "complete",
    }
    with pytest.raises(ValidationError):
        server.CatalogVideo.model_validate(payload)


def test_direct_non_ingress_peer_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ALLOW_DIRECT", raising=False)
    direct = TestClient(server.app, client=("203.0.113.10", 50000))
    assert direct.get("/api/health").status_code == 403
