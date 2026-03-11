import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { BullModule } from "@nestjs/bull";
import { VideoModule } from "./modules/video/video.module";
import { QueueModule } from "./modules/queue/queue.module";
import { SupabaseModule } from "./modules/supabase/supabase.module";
import { DockerModule } from "./modules/docker/docker.module";
import { PrismaModule } from "./modules/prisma/prisma.module";
import { EventsModule } from "./modules/events/events.module";

@Module({
  imports: [
    // Config - load .env globally
    ConfigModule.forRoot({ isGlobal: true }),

    // BullMQ backed by Redis
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get("REDIS_HOST", "localhost"),
          port: config.get<number>("REDIS_PORT", 6379),
          password: config.get("REDIS_PASSWORD") || undefined,
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
          removeOnComplete: 50,
          removeOnFail: 100,
        },
      }),
    }),

    PrismaModule,
    SupabaseModule,
    DockerModule,
    EventsModule,
    QueueModule,
    VideoModule,
  ],
})
export class AppModule {}
