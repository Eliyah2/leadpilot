# ShortForge / NightForge

Local-first YouTube Shorts studio: idea → script → scenes → voice-over → subtitles → MP4 → preview → download → (optional) YouTube upload.

## Requirements

- Node.js 22+ (uses the built-in `node:sqlite`)
- FFmpeg is bundled through `ffmpeg-static` / `ffprobe-static`
- Windows: voice-over uses the built-in SAPI voices; other OSes need another TTS provider (not yet implemented)

## Install and run

```bash
npm install
cp .env.example .env        # optional; the defaults work on one PC
npm run build               # builds the web UI
npm start                   # http://127.0.0.1:4400
```

Development: `npm run dev` (API + Vite dev server).

The first account you register becomes the owner. Register immediately after the first start.

## Phone access (same Wi-Fi)

1. In `.env` set `HOST=0.0.0.0`, then restart the server.
2. The console prints `On your phone (same Wi-Fi) → http://<ip>:4400`. Use the address of your Wi-Fi adapter.
3. Allow Node.js through the Windows firewall for private networks.

Traffic is plain HTTP on your local network. Do not expose the port to the internet. For remote access use a VPN such as Tailscale or an HTTPS reverse proxy.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Bind address. `0.0.0.0` enables LAN/phone access. |
| `SF_PORT` / `PORT` | `4400` | HTTP port. |
| `STORAGE_DIR` | `storage` | Databases, renders, covers, subtitles, secrets. |
| `SF_SECRET` | generated | Token encryption secret (≥16 chars). |
| `PUBLIC_URL` | empty | Public base URL, if you use a tunnel. |
| `JOB_CONCURRENCY` | `2` | Parallel background jobs. |

## YouTube (official YouTube Data API v3 + Google OAuth 2.0)

ShortForge cannot create Google or YouTube accounts for you. Create one at https://accounts.google.com/signup, then open https://www.youtube.com to create a channel.

Google Cloud setup (verify each step in the console; Google changes these pages):

1. Create a project at https://console.cloud.google.com.
2. Enable **YouTube Data API v3** and **YouTube Analytics API**.
3. Configure the OAuth consent screen. While the app is in "Testing", only the test users you list can connect, and refresh tokens may expire sooner than in production. Check Google's current policy before relying on long-lived connections.
4. Create an OAuth client ID of type **Web application**.
5. Add this authorized redirect URI (adjust the port if you changed it):
   `http://127.0.0.1:4400/api/youtube/callback`
6. Paste the client ID and secret in ShortForge → YouTube → OAuth credentials, save, then press **Connect channel**.

Scopes requested:

- `https://www.googleapis.com/auth/youtube.upload` (uploads)
- `https://www.googleapis.com/auth/youtube.readonly` (channel and video stats)
- `https://www.googleapis.com/auth/yt-analytics-monetary.readonly` (estimated revenue; only Partner Program channels return data). Users who connected before this scope was added must reconnect.

Upload behaviour:

- Default privacy is **private**. Public publishing needs you to change the privacy setting deliberately.
- Auto-publish schedules uploads automatically; turn it off in YouTube settings if you want every upload to be manual.
- Upload status and the YouTube link appear on the video after the job completes.

Quota: uploads use the daily YouTube API quota. The current value per upload is listed in the Google quota documentation; ShortForge's UI text about units may be out of date.

## Tests and checks

```bash
npm run typecheck     # TypeScript
npm run build         # web UI build
npm test              # full suite (API, DB, engine, media)
npm test -- api       # only the API suite
```

Tests use an isolated storage directory and do not call external services.

## Status of each feature

| Feature | Status |
| --- | --- |
| Idea → script → scenes (local engine) | Works. Quality depends on the built-in fact corpus. |
| Create Video wizard (idea, genre, duration, language, aspect, script editing) | Works; tested through the API. |
| Voice-over (Windows SAPI) | Works on Windows. |
| Subtitles, FFmpeg render, MP4 download | Works; 9:16 and 16:9 render tested. |
| Background jobs with retry/backoff and dedupe keys | Works. |
| AI image or video generation | **Not implemented.** Scene visuals are procedural (FFmpeg), not AI-generated. |
| Paid AI providers (LLM, TTS, image, video) | Optional LLM adapter (Ollama or OpenAI-compatible) exists. No paid provider is wired in. |
| YouTube OAuth, upload, status, revenue | Implemented; **not tested end-to-end** without your Google credentials. |
| Cost estimate and duplicate-spend guard | **Not implemented.** No paid generation step exists yet. |

## Security notes

- `/api` and `/media` require a session cookie. Mutations need the CSRF header.
- Downloads are limited to the owner of the video.
- Some list endpoints (for example `/api/videos`) are not yet filtered per user. Treat ShortForge as single-owner until that is fixed.
