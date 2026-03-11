export const VIDEO_PROCESSING_QUEUE = 'video-processing';

export const TRANSCODE_JOB = 'transcode';

export const RESOLUTIONS = [
  { name: '4k',    width: 3840, height: 2160, bitrate: '18000k', audioBitrate: '192k' },
  { name: '1080p', width: 1920, height: 1080, bitrate: '8000k',  audioBitrate: '192k' },
  { name: '720p',  width: 1280, height: 720,  bitrate: '4000k',  audioBitrate: '128k' },
  { name: '480p',  width: 854,  height: 480,  bitrate: '1500k',  audioBitrate: '96k'  },
] as const;

export type ResolutionName = '4k' | '1080p' | '720p' | '480p';
