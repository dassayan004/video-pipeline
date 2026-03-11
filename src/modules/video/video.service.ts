import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { SupabaseService } from '../supabase/supabase.service';
import { VideoProducer } from '../queue/producers/video.producer';
import { PrismaService } from '../prisma/prisma.service';

const ALLOWED_MIME_TYPES = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm', 'video/mpeg'];

@Injectable()
export class VideoService {
  private readonly logger = new Logger(VideoService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly producer: VideoProducer,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // ─── Upload raw video & enqueue ────────────────────────────────────────────
  async uploadAndEnqueue(
    file: Express.Multer.File,
    userId: string,
  ): Promise<{ videoId: string; jobId: string; message: string }> {
    // Validate MIME type
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        `Unsupported file type: ${file.mimetype}. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`,
      );
    }

    // Validate file size
    const maxMb = this.config.get<number>('MAX_FILE_SIZE_MB', 500);
    const maxBytes = maxMb * 1024 * 1024;
    if (file.size > maxBytes) {
      throw new BadRequestException(`File too large. Max size: ${maxMb}MB`);
    }

    const jobId = uuidv4();

    // Create DB record (UPLOADING state)
    const video = await this.prisma.video.create({
      data: {
        userId,
        originalName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        status: 'UPLOADING',
        jobId,
      },
    });

    this.logger.log(`Created video record ${video.id} for user ${userId}`);

    // Upload to Supabase temp bucket
    const tempPath = await this.supabase.uploadToTemp(jobId, file.buffer, file.mimetype);

    // Update DB with temp path
    await this.prisma.video.update({
      where: { id: video.id },
      data: { tempPath, status: 'QUEUED' },
    });

    // Enqueue BullMQ job
    await this.producer.enqueueTranscode({
      videoId: video.id,
      jobId,
      tempStoragePath: tempPath,
      userId,
      originalName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
    });

    this.logger.log(`Video ${video.id} enqueued with job ${jobId}`);

    return {
      videoId: video.id,
      jobId,
      message: 'Video uploaded and queued for processing. Connect via WebSocket to receive real-time updates.',
    };
  }

  // ─── Get video by ID ───────────────────────────────────────────────────────
  async getVideo(videoId: string, userId: string) {
    const video = await this.prisma.video.findFirst({
      where: { id: videoId, userId },
      include: { outputs: true },
    });

    if (!video) throw new NotFoundException(`Video ${videoId} not found`);
    return video;
  }

  // ─── Get all videos for user ───────────────────────────────────────────────
  async getUserVideos(userId: string) {
    return this.prisma.video.findMany({
      where: { userId },
      include: { outputs: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ─── Get job queue status ──────────────────────────────────────────────────
  async getJobStatus(jobId: string) {
    return this.producer.getJobStatus(jobId);
  }

  // ─── Get queue stats ───────────────────────────────────────────────────────
  async getQueueStats() {
    return this.producer.getQueueStats();
  }
}
