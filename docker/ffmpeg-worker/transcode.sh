#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# transcode.sh — runs inside the ephemeral FFmpeg container
# Env vars injected by NestJS DockerService:
#   INPUT_URL       - Signed Supabase URL to download raw video
#   JOB_ID          - Unique job identifier
#   SUPABASE_URL    - Supabase project URL
#   SUPABASE_KEY    - Service role key for storage upload
#   PROD_BUCKET     - Production bucket name
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

INPUT_FILE="/tmp/input.mp4"

echo "[transcode] Job: $JOB_ID"
echo "[transcode] Downloading raw video..."
wget -q "$INPUT_URL" -O "$INPUT_FILE"
echo "[transcode] Download complete: $(du -sh $INPUT_FILE | cut -f1)"

# ─── Transcode all resolutions ────────────────────────────────────────────────
echo "[transcode] Starting FFmpeg transcoding..."

ffmpeg -i "$INPUT_FILE" \
  -vf "scale=3840:2160" -c:v libx264 -preset fast -b:v 18000k -c:a aac -b:a 192k -movflags +faststart /tmp/output_4k.mp4 \
  -vf "scale=1920:1080" -c:v libx264 -preset fast -b:v 8000k  -c:a aac -b:a 192k -movflags +faststart /tmp/output_1080p.mp4 \
  -vf "scale=1280:720"  -c:v libx264 -preset fast -b:v 4000k  -c:a aac -b:a 128k -movflags +faststart /tmp/output_720p.mp4 \
  -vf "scale=854:480"   -c:v libx264 -preset fast -b:v 1500k  -c:a aac -b:a 96k  -movflags +faststart /tmp/output_480p.mp4 \
  -y 2>&1

echo "[transcode] Transcoding complete. Uploading outputs..."

# ─── Upload each output to Supabase prod bucket ───────────────────────────────
for RESOLUTION in 4k 1080p 720p 480p; do
  OUTPUT_FILE="/tmp/output_${RESOLUTION}.mp4"
  STORAGE_PATH="${JOB_ID}/${RESOLUTION}.mp4"

  echo "[transcode] Uploading ${RESOLUTION}..."
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST \
    "${SUPABASE_URL}/storage/v1/object/${PROD_BUCKET}/${STORAGE_PATH}" \
    -H "Authorization: Bearer ${SUPABASE_KEY}" \
    -H "Content-Type: video/mp4" \
    --data-binary "@${OUTPUT_FILE}")

  if [ "$HTTP_STATUS" -ge 200 ] && [ "$HTTP_STATUS" -lt 300 ]; then
    echo "[transcode] Uploaded ${RESOLUTION} (HTTP ${HTTP_STATUS})"
  else
    echo "[transcode] ERROR: Failed to upload ${RESOLUTION} (HTTP ${HTTP_STATUS})"
    exit 1
  fi

  # Clean up local output to save space
  rm -f "$OUTPUT_FILE"
done

echo "[transcode] All outputs uploaded successfully for job $JOB_ID"
rm -f "$INPUT_FILE"
echo "[transcode] Done."
