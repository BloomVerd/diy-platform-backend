export const TRANSCODING_QUEUE = 'video-transcoding';

export interface TranscodingJobPayload {
  videoId: string;
  objectKey: string;
  creatorId: string;
  variants: ('360p' | '720p' | '1080p')[];
}
