# Home Assistant Personal Video Add-on

A secure Home Assistant Ingress add-on for viewing completed personalized videos produced by the separate runner. Phones open a full-height short-form feed; tablets and desktops receive a purpose-built dashboard, navigation rail, player, recent list, and daily/weekly libraries.

The public repository contains no personal data, real entity IDs, private URLs, credentials, generated personal videos, or private screenshots.

## Architecture and security

```mermaid
flowchart LR
  A[Runner] -->|atomic safe manifest last| B[/share/personal_video_studio]
  B -->|read-only mount| C[Viewer backend]
  C -->|ID-based API and HTTP ranges| D[Authenticated HA Ingress]
  D --> E[Responsive browser UI]
  E -->|likes and progress only| F[Viewer private /data]
```

The viewer does not receive `SUPERVISOR_TOKEN`, Home Assistant API access, LLM/TTS credentials, Docker access, host networking, or unrestricted filesystem access. It maps Home Assistant `share` read-only and accepts one validated relative subdirectory. Media routes resolve a stable catalog ID, walk Linux paths with no-follow descriptors, reject non-regular files and unsafe extensions, stream bounded single byte ranges, and never load complete MP4s into memory.

The Ingress panel is administrator-only by default because personal videos can reveal sensitive patterns. Direct non-Ingress peers are rejected. Preferences live in the add-on's private `/data`, not generation manifests. Sharing is disabled by default.

## Install

1. In Home Assistant, open **Settings → Add-ons → Add-on Store → ⋮ → Repositories**.
2. Add `https://github.com/resace3/home-assistant-personal-video-addon`.
3. Install **Personal Video Studio**.
4. The fixed media path is `/share/personal_video_studio`, matching the runner and AppArmor policy.
5. Start it and enable **Show in sidebar**.

The runner must publish to `/share/personal_video_studio`. The viewer is useful without external APIs and continues showing the last completed videos when generation is unavailable.

## Interface behavior

- Under 768 CSS pixels: 100dvh scroll-snap feed, muted autoplay attempt, explicit play fallback, right-side like/save/sound actions, safe-area-aware bottom navigation with only Feed, Library, Insights, and Settings.
- At or above 768 pixels: navigation rail, large player, recent panel, daily/weekly grids, metadata-only counts, and keyboard-friendly controls.
- Resizing switches layouts without user-agent sniffing.
- Only the visible video plays. Background, navigated-away, and off-screen videos pause.
- Browser rules can block autoplay and always control audible autoplay. The UI handles this honestly.
- Native video controls provide captions, seeking, keyboard playback, and mute controls.
- Reduced-motion preferences disable smooth/snap behavior and decorative motion.

## API

```text
GET  /api/health
GET  /api/diagnostics
GET  /api/settings
GET  /api/videos?period=daily|weekly&page=1&page_size=20
GET  /api/videos/{id}
GET|HEAD /api/videos/{id}/stream
GET|HEAD /api/videos/{id}/thumbnail
GET|HEAD /api/videos/{id}/captions
POST /api/videos/{id}/preferences
```

Media supports `Accept-Ranges: bytes`, correct `206`/`Content-Range` responses, suffix and open-ended ranges, and `416` for malformed, multiple, or unsatisfiable requests.

## Test locally

```bash
python -m venv .venv
.venv/bin/pip install -e '.[dev]'
.venv/bin/ruff check .
.venv/bin/mypy personal_video_studio/app
.venv/bin/pytest
```

Browser tests use deterministic synthetic metadata and media only. Visual baselines cover phone and desktop layouts plus loading, empty, and error states. Private installed-system captures must stay outside this repository and CI artifact paths.

## Update, rollback, and uninstall

- Update through the Home Assistant add-on page after repository refresh.
- Roll back by reinstalling a previous tagged version or restoring an add-on backup.
- Uninstall through Home Assistant. Uninstalling the viewer does not delete `/share/personal_video_studio`; the runner owns media retention.
- Remove the custom repository only after the add-on is uninstalled.

## Privacy and limitations

`/share` is shared across add-ons and is not a security boundary. Any trusted add-on granted share access may read these videos. Install third-party add-ons carefully. Ingress grants access according to Home Assistant authorization; this add-on is admin-only by default and does not implement per-person video ACLs.

Chrome emulation cannot prove iOS/Android Companion WebView behavior. Audible autoplay is not guaranteed. The viewer validates browser-safe metadata but cannot make compromised media decoders risk-free. Generated content is informational and is not medical advice.

See [security](SECURITY.md), [configuration and troubleshooting](personal_video_studio/DOCS.md), [contributing](CONTRIBUTING.md), and [changelog](CHANGELOG.md).
