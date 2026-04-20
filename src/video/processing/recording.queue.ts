export const RECORDING_QUEUE = 'recording-processing';

export interface RecordingJobPayload {
  livestreamId: string;
  channelId: string;
  creatorId: string;
  /** S3 key where the RTMP server stored the raw recording. */
  recordingKey: string;
  title: string;
}
