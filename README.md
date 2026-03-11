# 🎬 Video Processing Pipeline

A production-ready video processing pipeline built with **NestJS**, **Supabase Storage**, **BullMQ**, **Docker**, and **FFmpeg**.

---

## Architecture

```
Client → POST /videos/upload
       → NestJS (FileInterceptor + validation)
       → Supabase temp-videos bucket  ←── raw file stored
       → BullMQ video-processing queue
       → VideoProcessor (poll + validate)
       → DockerService spawns ffmpeg-job-{jobId} container
           └─ Downloads from temp bucket via signed URL
           └─ FFmpeg transcodes → 4K, 1080p, 720p, 480p
           └─ Uploads each output to prod-videos bucket
           └─ Container killed + removed
       → Cleanup: delete temp file
       → DB updated to READY
       → WebSocket event emitted to client
```

---

## Quick Start

### 1. Prerequisites
- Node.js 20+
- Docker + Docker Compose
- A Supabase project

### 2. Environment Setup

```bash
cp .env.example .env
# Fill in your Supabase URL, service role key, and DATABASE_URL
```

### 3. Supabase Setup

Create two storage buckets in your Supabase dashboard:

| Bucket         | Access  | Purpose               |
|----------------|---------|----------------------|
| `temp-videos`  | Private | Raw uploads (short-lived) |
| `prod-videos`  | Public  | Transcoded outputs (CDN) |

### 4. Database Migration

```bash
npm install
npx prisma migrate dev --name init
npx prisma generate
```

### 5. Run Locally (Development)

```bash
# Start Redis
docker run -d -p 6379:6379 --name redis redis:7-alpine

# Start NestJS with hot-reload
npm run start:dev
```

### 6. Run with Docker Compose (Production)

```bash
# Start all services
docker compose up -d

# With Redis Commander dev UI
docker compose --profile dev up -d

# View logs
docker compose logs -f api
```

### 7. Build FFmpeg Worker Image

```bash
docker build -t ffmpeg-worker:latest ./docker/ffmpeg-worker/
```

---

## API Reference

### Upload a Video

```bash
curl -X POST http://localhost:3000/videos/upload \
  -H "x-user-id: user-123" \
  -F "file=@/path/to/video.mp4"
```

**Response:**
```json
{
  "videoId": "uuid",
  "jobId": "uuid",
  "message": "Video uploaded and queued for processing..."
}
```

### Poll Job Status

```bash
curl http://localhost:3000/videos/jobs/{jobId}/status
```

### Get Video + Output URLs

```bash
curl http://localhost:3000/videos/{videoId} \
  -H "x-user-id: user-123"
```

### Queue Stats

```bash
curl http://localhost:3000/videos/queue/stats
```

---

## WebSocket (Real-time Updates)

Connect to `ws://localhost:3000/events` and subscribe to your job:

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000/events');

// Subscribe to a specific job
socket.emit('subscribe:job', { jobId: 'your-job-id' });

// Listen for status updates
socket.on('job:status', (data) => {
  console.log(data);
  // { jobId, status: 'PROCESSING', progress: 45, message: 'Transcoding...' }
  // { jobId, status: 'READY', progress: 100, outputs: { '1080p': 'https://...', ... } }
  // { jobId, status: 'FAILED', error: '...' }
});
```

---

## Video Status Flow

```
PENDING → UPLOADING → QUEUED → VALIDATING → PROCESSING → UPLOADING_OUTPUTS → READY
                                                                            ↘ FAILED
```

---

## Output Resolutions

| Resolution | Dimensions  | Video Bitrate | Audio Bitrate |
|------------|-------------|---------------|---------------|
| 4K         | 3840×2160   | 18,000 kbps   | 192 kbps      |
| 1080p      | 1920×1080   | 8,000 kbps    | 192 kbps      |
| 720p       | 1280×720    | 4,000 kbps    | 128 kbps      |
| 480p       | 854×480     | 1,500 kbps    | 96 kbps       |

All outputs: **H.264 video + AAC audio**, optimized for web streaming with `-movflags +faststart`.

---

## Project Structure

```
src/
├── main.ts
├── app.module.ts
└── modules/
    ├── video/               # REST API layer
    │   ├── video.controller.ts
    │   ├── video.service.ts
    │   ├── video.module.ts
    │   └── dto/
    ├── queue/               # BullMQ
    │   ├── queue.module.ts
    │   ├── queue.constants.ts
    │   ├── queue.types.ts
    │   ├── producers/
    │   │   └── video.producer.ts
    │   └── processors/
    │       └── video.processor.ts
    ├── supabase/            # Storage service
    ├── docker/              # Container orchestration
    ├── events/              # WebSocket gateway
    └── prisma/              # Database client
docker/
└── ffmpeg-worker/
    ├── Dockerfile
    └── transcode.sh         # FFmpeg + upload script
prisma/
└── schema.prisma
docker-compose.yml           # Full stack
Dockerfile                   # NestJS app image
.env.example
```

---

## Notes

- The FFmpeg container is **ephemeral** — spun up per job, auto-removed when done
- The NestJS API mounts `/var/run/docker.sock` to spawn **sibling containers** (not nested Docker)
- Temp files are deleted after successful processing (also on failure via cleanup hook)
- BullMQ retries failed jobs **3×** with exponential backoff (5s, 25s, 125s)
- Swagger UI available at `http://localhost:3000/api/docs`
