export const QUEUE_EVENTS = {
  PROCESS_APPLICATION: 'process.application',
} as const;

export interface ProcessApplicationJob {
  applicationId: string;
  attempt: number;
}
