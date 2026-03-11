import { Process, Processor, OnQueueActive, OnQueueCompleted, OnQueueFailed } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { ConfigService } from '@nestjs/config';
import { VIDEO_PROCESSING_QUEUE, TRANSCODE_JOB, RESOLUTIONS } from '../queue.constants';
import { TranscodeJobPayload } from '../queue.types';
import { SupabaseService } from '../../supabase/supabase.service';
import { DockerService } from '../../docker/docker.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsGateway } from '../../events/events.gateway';

@Processor(VIDEO_PROCESSING_QUEUE)
export class VideoProcessor {
  private readonly logger = new Logger(VideoProcessor.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly docker: DockerService,
    private readonly prisma: PrismaService,
    private readonly events: EventsGateway,
    private readonly config: ConfigService,
  ) {}

  // ─── Main processor ───────────────────────────────────────────────────────────
  @Process(TRANSCODE_JOB)
  async handleTranscode(job: Job<TranscodeJobPayload>) {
    const { videoId, jobId, tempStoragePath, userId, originalName } = job.data;
    this.logger.log(`Processing job ${jobId} for video ${videoId} (${originalName})`);

    try {
      // ── Step 1: Validate ──────────────────────────────────────────────────────
      await this.updateStatus(videoId, 'VALIDATING', job, 5);
      this.events.emitJobStatus(jobId, { status: 'VALIDATING', progress: 5, message: 'Validating file...' });

      await this.validateFile(tempStoragePath);

      // ── Step 2: Create signed URL for FFmpeg container to download ────────────
      await this.updateStatus(videoId, 'PROCESSING', job, 15);
      this.events.emitJobStatus(jobId, { status: 'PROCESSING', progress: 15, message: 'Spawning transcoder...' });

      const signedUrl = await this.supabase.createSignedUrl(
        tempStoragePath,
        Number(this.config.get('SIGNED_URL_EXPIRES_IN', 3600)),
      );

      // ── Step 3: Ensure FFmpeg image is available ──────────────────────────────
      await this.docker.ensureImage();
      await job.progress(20);

      // ── Step 4: Run ephemeral Docker container ────────────────────────────────
      this.events.emitJobStatus(jobId, { status: 'PROCESSING', progress: 20, message: 'Transcoding started...' });

      const containerResult = await this.docker.runTranscoder({
        jobId,
        signedInputUrl: signedUrl,
        supabaseUrl: this.config.getOrThrow('SUPABASE_URL'),
        supabaseServiceKey: this.config.getOrThrow('SUPABASE_SERVICE_ROLE_KEY'),
        prodBucket: this.config.get('SUPABASE_PROD_BUCKET', 'prod-videos'),
        resolutions: [...RESOLUTIONS],
      });

      if (containerResult.exitCode !== 0) {
        throw new Error(`FFmpeg container exited with code ${containerResult.exitCode}: ${containerResult.logs.slice(-500)}`);
      }

      await job.progress(85);
      this.events.emitJobStatus(jobId, { status: 'UPLOADING_OUTPUTS', progress: 85, message: 'Saving outputs...' });

      // ── Step 5: Record outputs in database ────────────────────────────────────
      const outputs: Record<string, string> = {};
      for (const res of RESOLUTIONS) {
        const publicUrl = this.supabase.getPublicUrl(jobId, res.name);
        await this.prisma.videoOutput.create({
          data: {
            videoId,
            resolution: res.name,
            width: res.width,
            height: res.height,
            bitrate: res.bitrate,
            storagePath: `${jobId}/${res.name}.mp4`,
            publicUrl,
          },
        });
        outputs[res.name] = publicUrl;
      }

      // ── Step 6: Cleanup temp file ─────────────────────────────────────────────
      await this.supabase.deleteTempFile(tempStoragePath);

      // ── Step 7: Mark as READY ─────────────────────────────────────────────────
      await this.prisma.video.update({
        where: { id: videoId },
        data: { status: 'READY', tempPath: null },
      });

      await job.progress(100);
      this.events.emitJobStatus(jobId, {
        status: 'READY',
        progress: 100,
        message: 'Video ready!',
        outputs,
      });

      this.logger.log(`Job ${jobId} completed successfully`);
      return { success: true, outputs };
    } catch (error) {
      // Attempt cleanup even on failure
      await this.handleFailureCleanup(videoId, tempStoragePath, jobId, error.message);
      throw error; // Re-throw so BullMQ marks job as failed
    }
  }

  // ─── Validation ───────────────────────────────────────────────────────────────
  private async validateFile(storagePath: string): Promise<void> {
    // Validate storage path format
    if (!storagePath || !storagePath.includes('/')) {
      throw new Error(`Invalid storage path: ${storagePath}`);
    }
    // Additional validation can probe the file via a short-lived container
    // e.g., run ffprobe to check codec, duration, dimensions
    this.logger.log(`Validation passed for ${storagePath}`);
  }

  // ─── Failure cleanup ──────────────────────────────────────────────────────────
  private async handleFailureCleanup(
    videoId: string,
    tempStoragePath: string,
    jobId: string,
    errorMessage: string,
  ): Promise<void> {
    this.logger.error(`Job ${jobId} failed: ${errorMessage}`);

    // Try to kill any lingering container
    try {
      await this.docker.killAndRemoveContainer(`ffmpeg-job-${jobId}`);
    } catch { /* ignore */ }

    // Delete temp file
    if (tempStoragePath) {
      await this.supabase.deleteTempFile(tempStoragePath);
    }

    // Mark DB as FAILED
    try {
      await this.prisma.video.update({
        where: { id: videoId },
        data: { status: 'FAILED', errorMessage: errorMessage.slice(0, 500) },
      });
    } catch { /* ignore DB error */ }

    this.events.emitJobStatus(jobId, {
      status: 'FAILED',
      error: errorMessage.slice(0, 200),
    });
  }

  private async updateStatus(videoId: string, status: string, job: Job, progress: number) {
    await this.prisma.video.update({ where: { id: videoId }, data: { status: status as any } });
    await job.progress(progress);
  }

  // ─── Queue event hooks ────────────────────────────────────────────────────────
  @OnQueueActive()
  onActive(job: Job) {
    this.logger.log(`Job ${job.id} started — attempt ${job.attemptsMade + 1}`);
  }

  @OnQueueCompleted()
  onCompleted(job: Job, result: any) {
    this.logger.log(`Job ${job.id} completed`);
  }

  @OnQueueFailed()
  onFailed(job: Job, error: Error) {
    this.logger.error(`Job ${job.id} failed permanently: ${error.message}`);
  }
}
