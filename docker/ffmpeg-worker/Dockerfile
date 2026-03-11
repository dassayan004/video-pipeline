# ─────────────────────────────────────────────────────────────────────────────
# FFmpeg Worker — ephemeral per-job transcoder container
# Base: jrottenberg/ffmpeg (Alpine, minimal size)
# ─────────────────────────────────────────────────────────────────────────────
FROM jrottenberg/ffmpeg:4.4-alpine

# Install wget and curl for file downloads/uploads to Supabase
RUN apk add --no-cache wget curl bash

# Create working directory
WORKDIR /workspace

# Copy the transcoder shell script
COPY transcode.sh /usr/local/bin/transcode.sh
RUN chmod +x /usr/local/bin/transcode.sh

# Default entrypoint — NestJS overrides CMD at runtime via Dockerode
ENTRYPOINT ["/bin/bash"]
