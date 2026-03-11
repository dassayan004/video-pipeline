import {
  Controller,
  Post,
  Get,
  Param,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Headers,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiConsumes,
  ApiBody,
  ApiParam,
  ApiHeader,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { VideoService } from './video.service';

@ApiTags('Videos')
@Controller('videos')
export class VideoController {
  constructor(private readonly videoService: VideoService) {}

  // ─── POST /videos/upload ────────────────────────────────────────────────────
  @Post('upload')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 500 * 1024 * 1024 }, // 500MB hard limit at multer level
      fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith('video/')) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Only video files are accepted'), false);
        }
      },
    }),
  )
  @ApiOperation({ summary: 'Upload a raw video for processing' })
  @ApiConsumes('multipart/form-data')
  @ApiHeader({ name: 'x-user-id', description: 'User ID', required: true })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Headers('x-user-id') userId: string,
  ) {
    if (!file) throw new BadRequestException('No file provided');
    if (!userId) throw new BadRequestException('x-user-id header is required');

    return this.videoService.uploadAndEnqueue(file, userId);
  }

  // ─── GET /videos/:videoId ───────────────────────────────────────────────────
  @Get(':videoId')
  @ApiOperation({ summary: 'Get video details and output URLs' })
  @ApiParam({ name: 'videoId' })
  @ApiHeader({ name: 'x-user-id', required: true })
  async getVideo(
    @Param('videoId') videoId: string,
    @Headers('x-user-id') userId: string,
  ) {
    if (!userId) throw new BadRequestException('x-user-id header is required');
    return this.videoService.getVideo(videoId, userId);
  }

  // ─── GET /videos/user/all ───────────────────────────────────────────────────
  @Get('user/all')
  @ApiOperation({ summary: 'Get all videos for a user' })
  @ApiHeader({ name: 'x-user-id', required: true })
  async getUserVideos(@Headers('x-user-id') userId: string) {
    if (!userId) throw new BadRequestException('x-user-id header is required');
    return this.videoService.getUserVideos(userId);
  }

  // ─── GET /videos/jobs/:jobId/status ────────────────────────────────────────
  @Get('jobs/:jobId/status')
  @ApiOperation({ summary: 'Poll job status from BullMQ' })
  @ApiParam({ name: 'jobId' })
  async getJobStatus(@Param('jobId') jobId: string) {
    const status = await this.videoService.getJobStatus(jobId);
    if (!status) throw new BadRequestException(`Job ${jobId} not found`);
    return status;
  }

  // ─── GET /videos/queue/stats ────────────────────────────────────────────────
  @Get('queue/stats')
  @ApiOperation({ summary: 'Get BullMQ queue statistics' })
  async getQueueStats() {
    return this.videoService.getQueueStats();
  }
}
