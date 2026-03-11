import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { VIDEO_PROCESSING_QUEUE, TRANSCODE_JOB } from '../queue.constants';
import { TranscodeJobPayload } from '../queue.types';

@Injectable()
export class VideoProducer {
  private readonly logger = new Logger(VideoProducer.name);

  constructor(
    @InjectQueue(VIDEO_PROCESSING_QUEUE)
    private readonly videoQueue: Queue<TranscodeJobPayload>,
  ) {}

  async enqueueTranscode(payload: TranscodeJobPayload): Promise<string> {
    const job = await this.videoQueue.add(TRANSCODE_JOB, payload, {
      jobId: payload.jobId,
      priority: 1,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 50,
      removeOnFail: 100,
    });

    this.logger.log(`Enqueued transcode job ${job.id} for video ${payload.videoId}`);
    return job.id as string;
  }

  async getJobStatus(jobId: string) {
    const job = await this.videoQueue.getJob(jobId);
    if (!job) return null;

    const state = await job.getState();
    const progress = job.progress();
    return { jobId, state, progress, data: job.data, failedReason: job.failedReason };
  }

  async getQueueStats() {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.videoQueue.getWaitingCount(),
      this.videoQueue.getActiveCount(),
      this.videoQueue.getCompletedCount(),
      this.videoQueue.getFailedCount(),
      this.videoQueue.getDelayedCount(),
    ]);
    return { waiting, active, completed, failed, delayed };
  }
}
