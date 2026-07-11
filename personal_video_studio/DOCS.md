# Personal Video Studio configuration

## Options

- Media is intentionally fixed at `/share/personal_video_studio` so the runner and read-only Supervisor mount cannot drift. `/shared/personal_video_studio` is not an alias and is not read.
- `default_tab`: `feed`, `library`, `insights`, or `settings`.
- `autoplay`: attempt muted autoplay of the visible/newest video.
- `start_muted`: start muted to comply with browser policies.
- `show_daily_videos`, `show_weekly_videos`: library visibility controls.
- `enable_insights`: enable metadata-only counts.

Credentials do not belong in these options. LLM and TTS configuration belongs to the separate runner's private `/data` configuration.

## Troubleshooting

- **Video storage is not mounted:** confirm the add-on is version 0.2.0 or newer and its `share` map is mounted at `/share`. Do not use `/shared`.
- **Video index not found:** run the runner with `video_directory: /share/personal_video_studio`, then run `rebuild-index`.
- **Video index needs rebuilding:** confirm `indexes/all.json` is valid schema-version-1 JSON and rebuild it with the runner.
- **Completed video files are unavailable:** confirm every indexed entry has a non-empty MP4 or WebM, thumbnail, and VTT file in its indexed relative directory.
- **No completed videos yet:** generate a daily or weekly video, then use **Refresh library**.
- **Video will not autoplay:** use the visible Play button. Audible autoplay is browser-controlled.
- **Seeking fails:** check that the Ingress response returns `206`, `Accept-Ranges: bytes`, and a valid `Content-Range`.
- **Assets fail after install:** all routes are relative to the randomized Ingress prefix; hard-coded root URLs are unsupported.
- **403 outside Home Assistant:** expected. The application is Ingress-only.
- **Corrupt metadata:** the catalog fails closed and continues serving other valid indexed items after the runner rebuilds the index.

Logs deliberately omit access URLs, filenames, user identities, options payloads, request bodies, and credentials.
