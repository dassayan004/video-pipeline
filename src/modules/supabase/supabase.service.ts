import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private readonly logger = new Logger(SupabaseService.name);
  private readonly client: SupabaseClient;
  private readonly tempBucket: string;
  private readonly prodBucket: string;

  constructor(private config: ConfigService) {
    this.client = createClient(
      config.getOrThrow('SUPABASE_URL'),
      config.getOrThrow('SUPABASE_SERVICE_ROLE_KEY'),
    );
    this.tempBucket = config.get('SUPABASE_TEMP_BUCKET', 'temp-videos');
    this.prodBucket = config.get('SUPABASE_PROD_BUCKET', 'prod-videos');
  }

  // ─── Upload raw video to temp bucket ────────────────────────────────────────
  async uploadToTemp(jobId: string, buffer: Buffer, mimeType: string): Promise<string> {
    const path = `${jobId}/raw.mp4`;
    const { error } = await this.client.storage
      .from(this.tempBucket)
      .upload(path, buffer, { contentType: mimeType, upsert: true });

    if (error) {
      this.logger.error(`Failed to upload to temp bucket: ${error.message}`);
      throw new InternalServerErrorException(`Storage upload failed: ${error.message}`);
    }

    this.logger.log(`Uploaded raw video to temp-videos/${path}`);
    return path;
  }

  // ─── Generate signed URL for temp file (FFmpeg container downloads this) ────
  async createSignedUrl(path: string, expiresIn = 3600): Promise<string> {
    const { data, error } = await this.client.storage
      .from(this.tempBucket)
      .createSignedUrl(path, expiresIn);

    if (error || !data?.signedUrl) {
      throw new InternalServerErrorException(`Failed to create signed URL: ${error?.message}`);
    }
    return data.signedUrl;
  }

  // ─── Upload a transcoded output to prod bucket ───────────────────────────────
  async uploadToProd(jobId: string, resolution: string, buffer: Buffer): Promise<string> {
    const path = `${jobId}/${resolution}.mp4`;
    const { error } = await this.client.storage
      .from(this.prodBucket)
      .upload(path, buffer, { contentType: 'video/mp4', upsert: true });

    if (error) {
      throw new InternalServerErrorException(`Prod upload failed [${resolution}]: ${error.message}`);
    }

    const { data } = this.client.storage.from(this.prodBucket).getPublicUrl(path);
    this.logger.log(`Uploaded ${resolution} to prod-videos/${path}`);
    return data.publicUrl;
  }

  // ─── Delete temp file after processing ──────────────────────────────────────
  async deleteTempFile(path: string): Promise<void> {
    const { error } = await this.client.storage.from(this.tempBucket).remove([path]);
    if (error) {
      // Log but don't throw — cleanup failure shouldn't fail the job
      this.logger.warn(`Failed to delete temp file ${path}: ${error.message}`);
    } else {
      this.logger.log(`Deleted temp file: temp-videos/${path}`);
    }
  }

  // ─── Get public URL for a prod file ─────────────────────────────────────────
  getPublicUrl(jobId: string, resolution: string): string {
    const path = `${jobId}/${resolution}.mp4`;
    const { data } = this.client.storage.from(this.prodBucket).getPublicUrl(path);
    return data.publicUrl;
  }
}
