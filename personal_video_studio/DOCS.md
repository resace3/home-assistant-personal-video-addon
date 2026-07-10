# Personal Video Studio configuration

## Options

- Media is intentionally fixed at `/share/personal_video_studio` so the read-only mount and AppArmor policy cannot drift.
- `default_tab`: `feed`, `library`, `insights`, or `settings`.
- `autoplay`: attempt muted autoplay of the visible/newest video.
- `start_muted`: start muted to comply with browser policies.
- `show_daily_videos`, `show_weekly_videos`: library visibility controls.
- `enable_insights`: enable metadata-only counts.

Credentials do not belong in these options. LLM and TTS configuration belongs to the separate runner's private `/data` configuration.

## Troubleshooting

- **Empty library:** run the runner's `rebuild-index`; confirm `indexes/all.json` exists and all referenced MP4, thumbnail, and VTT files are complete.
- **Video will not autoplay:** use the visible Play button. Audible autoplay is browser-controlled.
- **Seeking fails:** check that the Ingress response returns `206`, `Accept-Ranges: bytes`, and a valid `Content-Range`.
- **Assets fail after install:** all routes are relative to the randomized Ingress prefix; hard-coded root URLs are unsupported.
- **403 outside Home Assistant:** expected. The application is Ingress-only.
- **Corrupt metadata:** the catalog fails closed and continues serving other valid indexed items after the runner rebuilds the index.

Logs deliberately omit access URLs, filenames, user identities, options payloads, request bodies, and credentials.
