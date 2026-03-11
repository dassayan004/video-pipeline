export interface TranscodeJobPayload {
  videoId: string;
  jobId: string;
  tempStoragePath: string;  // e.g. "abc-123/raw.mp4"
  userId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}
