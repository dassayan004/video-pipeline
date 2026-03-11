import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Dockerode from 'dockerode';

export interface TranscodeJobParams {
  jobId: string;
  signedInputUrl: string;
  supabaseUrl: string;
  supabaseServiceKey: string;
  prodBucket: string;
  resolutions: Array<{
    name: string;
    width: number;
    height: number;
    bitrate: string;
    audioBitrate: string;
  }>;
}

export interface ContainerResult {
  exitCode: number;
  containerId: string;
  logs: string;
}

@Injectable()
export class DockerService {
  private readonly logger = new Logger(DockerService.name);
  private readonly docker: Dockerode;
  private readonly ffmpegImage: string;

  constructor(private config: ConfigService) {
    this.docker = new Dockerode({
      socketPath: config.get('DOCKER_SOCKET', '/var/run/docker.sock'),
    });
    this.ffmpegImage = config.get('FFMPEG_IMAGE', 'jrottenberg/ffmpeg:4.4-alpine');
  }

  async ensureImage(): Promise<void> {
    try {
      await this.docker.getImage(this.ffmpegImage).inspect();
    } catch {
      this.logger.log(`Pulling image ${this.ffmpegImage}...`);
      await new Promise<void>((resolve, reject) => {
        this.docker.pull(this.ffmpegImage, (err: Error, stream: NodeJS.ReadableStream) => {
          if (err) return reject(err);
          this.docker.modem.followProgress(stream, (e: Error) => (e ? reject(e) : resolve()));
        });
      });
    }
  }

  async runTranscoder(params: TranscodeJobParams): Promise<ContainerResult> {
    const containerName = `ffmpeg-job-${params.jobId}`;

    // Build the complete ffmpeg command with all resolutions as multiple outputs
    const resolutionArgs = params.resolutions.flatMap((res) => [
      '-vf', `scale=${res.width}:${res.height}`,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-b:v', res.bitrate,
      '-c:a', 'aac',
      '-b:a', res.audioBitrate,
      '-movflags', '+faststart',
      `/tmp/output_${res.name}.mp4`,
    ]);

    const uploadCmds = params.resolutions
      .map(
        (res) =>
          `curl -sf -X POST "${params.supabaseUrl}/storage/v1/object/${params.prodBucket}/${params.jobId}/${res.name}.mp4" ` +
          `-H "Authorization: Bearer ${params.supabaseServiceKey}" ` +
          `-H "Content-Type: video/mp4" ` +
          `--data-binary @/tmp/output_${res.name}.mp4 && echo "Uploaded ${res.name}"`,
      )
      .join(' && ');

    const shellCmd = [
      `echo "Downloading input..."`,
      `wget -q "${params.signedInputUrl}" -O /tmp/input.mp4`,
      `echo "Starting FFmpeg..."`,
      `ffmpeg -i /tmp/input.mp4 ${resolutionArgs.join(' ')} -y`,
      `echo "Uploading outputs..."`,
      uploadCmds,
      `rm -f /tmp/input.mp4 /tmp/output_*.mp4`,
      `echo "Container job complete."`,
    ].join(' && ');

    let container: Dockerode.Container;
    try {
      container = await this.docker.createContainer({
        name: containerName,
        Image: this.ffmpegImage,
        // Override ffmpeg image entrypoint so we can run a shell script
        Entrypoint: ['sh', '-c'],
        Cmd: [shellCmd],
        Env: [`JOB_ID=${params.jobId}`],
        HostConfig: {
          AutoRemove: false,
          Memory: 2 * 1024 * 1024 * 1024, // 2 GB
          NanoCpus: 2 * 1e9,               // 2 vCPU
        },
      });

      await container.start();
      this.logger.log(`Container ${containerName} started`);

      const { StatusCode: exitCode } = await container.wait();

      const rawLogs = await container.logs({ stdout: true, stderr: true, tail: 200 });
      const logs = rawLogs.toString('utf-8');

      if (exitCode !== 0) {
        this.logger.error(`Container exited ${exitCode}:\n${logs.slice(-1000)}`);
      } else {
        this.logger.log(`Container ${containerName} finished successfully`);
      }

      return { exitCode, containerId: container.id, logs };
    } finally {
      await this.killAndRemoveContainer(containerName);
    }
  }

  async killAndRemoveContainer(nameOrId: string): Promise<void> {
    try {
      const c = this.docker.getContainer(nameOrId);
      try { await c.kill(); } catch { /* already stopped */ }
      await c.remove({ force: true });
      this.logger.log(`Removed container: ${nameOrId}`);
    } catch (err) {
      this.logger.warn(`Could not remove container ${nameOrId}: ${err.message}`);
    }
  }

  async listActiveJobContainers(): Promise<string[]> {
    const containers = await this.docker.listContainers({
      filters: JSON.stringify({ name: ['ffmpeg-job-'] }),
    });
    return containers.map((c) => c.Names[0]);
  }
}
