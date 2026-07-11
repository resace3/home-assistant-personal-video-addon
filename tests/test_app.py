from __future__ import annotations

import json
import re
import tomllib
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from personal_video_studio.app import server


def test_release_versions_are_consistent() -> None:
    root = Path(__file__).parents[1]
    project = tomllib.loads((root / "pyproject.toml").read_text(encoding="utf-8"))
    addon_text = (root / "personal_video_studio" / "config.yaml").read_text(encoding="utf-8")
    addon_version = re.search(r'^version: "([^"]+)"$', addon_text, re.MULTILINE)
    assert addon_version is not None
    package = json.loads((root / "package.json").read_text(encoding="utf-8"))
    assert project["project"]["version"] == addon_version.group(1) == package["version"]


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
    assert response.json()["version"] == server.APP_VERSION
    assert response.json()["catalog_state"] == "ready"
    assert "default-src 'self'" in response.headers["content-security-policy"]
    assert response.headers["cache-control"] == "no-store"
    assert "SUPERVISOR_TOKEN" not in response.text


def test_paginated_daily_catalog(client: TestClient) -> None:
    payload = client.get("/api/videos", params={"period": "daily", "page": 1, "page_size": 10}).json()
    assert payload["total"] == 1
    assert payload["items"][0]["id"] == "daily-2026-07-10"
    assert payload["catalog"]["state"] == "ready"
    assert payload["catalog"]["expected_index"] == "/share/personal_video_studio/indexes/all.json"


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
    for header in ("bytes=9999-", "bytes=0-1,3-4", "widgets=0-1", "bytes= 1-2", "bytes=1 -2", "bytes=-0", "bytes=-"):
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


def test_corrupt_or_oversized_catalog_fails_closed(
    client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = Path(server._media_root())
    (root / "indexes" / "all.json").write_text("not-json", encoding="utf-8")
    payload = client.get("/api/videos").json()
    assert payload["items"] == []
    assert payload["catalog"]["state"] == "index_invalid"


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
    response = direct.get("/api/health")
    assert response.status_code == 403
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_canonical_home_assistant_share_path_is_not_shared(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("VIDEO_ROOT", raising=False)
    assert server._media_root() == Path("/share/personal_video_studio")
    assert server._media_root() != Path("/shared/personal_video_studio")


def test_catalog_reports_missing_mount_and_index(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    root = tmp_path / "missing"
    monkeypatch.setenv("VIDEO_ROOT", str(root))
    response = TestClient(server.app).get("/api/videos")
    assert response.json()["catalog"]["state"] == "media_root_missing"
    root.mkdir()
    response = TestClient(server.app).get("/api/videos")
    assert response.json()["catalog"]["state"] == "index_missing"


def test_runner_schema_v1_fields_are_compatible(client: TestClient) -> None:
    root = Path(server._media_root())
    path = root / "indexes" / "all.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload[0].update(
        {
            "period_start": "2026-07-09T12:00:00Z",
            "period_end": "2026-07-10T12:00:00Z",
            "schema_version": 1,
        }
    )
    path.write_text(json.dumps(payload), encoding="utf-8")
    item = client.get("/api/videos").json()["items"][0]
    assert item["schema_version"] == 1
    assert item["period_start"] == "2026-07-09T12:00:00Z"
    assert item["period_end"] == "2026-07-10T12:00:00Z"


def test_partial_catalog_keeps_valid_runner_entries(client: TestClient) -> None:
    root = Path(server._media_root())
    path = root / "indexes" / "all.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload.append({"id": "invalid-entry"})
    path.write_text(json.dumps(payload), encoding="utf-8")
    response = client.get("/api/videos").json()
    assert [item["id"] for item in response["items"]] == ["daily-2026-07-10"]
    assert response["catalog"]["state"] == "partial"
    assert response["catalog"]["invalid"] == 1


def test_missing_or_empty_assets_are_not_advertised(client: TestClient) -> None:
    root = Path(server._media_root())
    video = root / "daily" / "2026" / "07" / "daily-2026-07-10.mp4"
    video.write_bytes(b"")
    response = client.get("/api/videos").json()
    assert response["items"] == []
    assert response["catalog"]["state"] == "no_usable_entries"
    assert response["catalog"]["unavailable"] == 1
    assert client.get("/api/videos/daily-2026-07-10/stream").status_code == 404


def test_duplicate_catalog_ids_are_ignored(client: TestClient) -> None:
    root = Path(server._media_root())
    path = root / "indexes" / "all.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload.append(payload[0])
    path.write_text(json.dumps(payload), encoding="utf-8")
    response = client.get("/api/videos").json()
    assert len(response["items"]) == 1
    assert response["catalog"]["state"] == "partial"
    assert response["catalog"]["duplicates"] == 1


def test_catalog_rejects_period_directory_mismatch() -> None:
    payload = {
        "id": "daily-safe-test",
        "type": "daily",
        "title": "Synthetic",
        "created_at": "2026-07-10T12:00:00Z",
        "duration_seconds": 60,
        "video_filename": "safe.mp4",
        "thumbnail_filename": "safe.webp",
        "captions_filename": "safe.vtt",
        "relative_directory": "weekly/2026",
        "generation_status": "complete",
    }
    with pytest.raises(ValidationError):
        server.CatalogVideo.model_validate(payload)
