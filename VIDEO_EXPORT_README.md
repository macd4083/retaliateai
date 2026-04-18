# Video Export Engine

## Architecture
```text
Admin UI (React)
     │
     ▼ POST /api/video-export/start
Express Server (server/index.js :3001)
     │
     ├── captureService.js  ──► Puppeteer (headless Chrome)
     │        │                  - Loads demoUrl at target resolution
     │        │                  - Screenshots each frame at target fps
     │        ▼
     │    /public/exports/frames/{jobId}/frame_XXXXXX.png
     │
     ├── ffmpegService.js   ──► FFmpeg
     │        │                  - Assembles frames → video
     │        │                  - Applies watermark (drawtext)
     │        │                  - Mixes background music
     │        │                  - Encodes: H.264 MP4 / VP9 WebM / Palette GIF
     │        ▼
     │    /public/exports/{jobId}.{mp4|webm|gif}
     │
     └── storageService.js
              ├── Local → served via Express static
              └── S3    → uploaded to AWS S3, returns CDN URL

Progress: SSE stream → EventSource in React → live progress bar
```

## Installation
```bash
# Install server dependencies
npm install puppeteer fluent-ffmpeg @ffmpeg-installer/ffmpeg \
  express cors multer @aws-sdk/client-s3

# Ensure FFmpeg is installed on your system
# macOS:  brew install ffmpeg
# Ubuntu: sudo apt-get install ffmpeg
# Windows: https://ffmpeg.org/download.html
```

## Running
```bash
# Terminal 1: Vite dev server
npm run dev

# Terminal 2: Export server
node server/index.js
```

## Environment Variables
Copy `server/.env.example` to `server/.env` and fill in your values.
- Required (all deployments): `SERVER_PORT`, `CLIENT_ORIGIN`
- Required for S3 storage: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET_NAME` (and usually `AWS_REGION`)
- Optional hardening/config: `VIDEO_EXPORT_ALLOWED_ORIGINS`, `VIDEO_EXPORT_ALLOWED_PATH_PREFIX`, `VIDEO_EXPORT_NAV_TIMEOUT_MS`, `PUBLIC_S3_EXPORTS`, `DELETE_LOCAL_AFTER_S3`
- `VIDEO_EXPORT_CAPTURE_ORIGIN` forces Puppeteer to load from a fixed trusted origin while preserving the validated demo path/query.
- `VIDEO_EXPORT_ALLOWED_ORIGINS` can be a comma-separated allowlist for demo URLs.
- `VIDEO_EXPORT_ALLOWED_PATH_PREFIX` limits demo capture to a safe path prefix (default `/demo/`).
- `VIDEO_EXPORT_NAV_TIMEOUT_MS` controls Puppeteer navigation timeout (default `30000`).
- `PUBLIC_S3_EXPORTS=true` enables public-read ACL on uploaded objects (default is private).

## Supported Configurations
| Setting | Options |
|---|---|
| Resolution | 1080p (1920×1080), 1440p (2560×1440), 4K (3840×2160) |
| FPS | 30, 60 |
| Format | MP4 (H.264), WebM (VP9), GIF (palette-optimized) |
| Storage | Local (`/public/exports`) or AWS S3 |
| Watermark | Text, position (5 options), opacity |
| Music | URL to audio file, volume (0–1) |

## Notes
- For 4K exports, ensure your machine has ≥8GB RAM
- GIF exports are larger; recommend max 15s duration
- S3 requires `public-read` ACL or a pre-signed URL approach
- If `PUBLIC_S3_EXPORTS=false`, direct S3 object URLs may not be publicly accessible
- The demo page should include `data-demo-ready` attribute when loaded
