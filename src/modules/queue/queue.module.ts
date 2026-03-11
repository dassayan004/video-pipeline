import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { VIDEO_PROCESSING_QUEUE } from './queue.constants';
import { VideoProducer } from './producers/video.producer';
import { VideoProcessor } from './processors/video.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE }),
  ],
  providers: [VideoProducer, VideoProcessor],
  exports: [VideoProducer],
})
export class QueueModule {}
