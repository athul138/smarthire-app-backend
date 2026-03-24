import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { QueueService } from './queue.service';
import { ProcessApplicationJob } from './queue.constants';

@Injectable()
export class QueueConsumer implements OnModuleInit {
  private readonly logger = new Logger(QueueConsumer.name);

  constructor(
    private readonly queueService: QueueService,
    private readonly moduleRef: ModuleRef,
  ) {}

  async onModuleInit(): Promise<void> {
    // Defer to allow circular deps to resolve
    setTimeout(() => this.startConsuming(), 2000);
  }

  private async startConsuming(): Promise<void> {
    const channel = this.queueService.getChannel();
    if (!channel) {
      this.logger.warn('Channel not ready, retrying consumer start in 5s');
      setTimeout(() => this.startConsuming(), 5000);
      return;
    }

    const queue = this.queueService.getQueueName();
    await channel.prefetch(5);

    channel.consume(queue, async (msg) => {
      if (!msg) return;

      let job: ProcessApplicationJob;
      try {
        job = JSON.parse(msg.content.toString()) as ProcessApplicationJob;
      } catch {
        this.logger.error('Failed to parse queue message, sending to DLQ');
        channel.nack(msg, false, false);
        return;
      }

      this.logger.log(
        `Processing application ${job.applicationId} (attempt ${job.attempt})`,
      );

      try {
        // Lazy import to avoid circular deps
        const { AiPipelineService } = await import('../ai/ai-pipeline.service');
        const pipeline = this.moduleRef.get(AiPipelineService, { strict: false });
        await pipeline.processApplication(job.applicationId);
        channel.ack(msg);
        this.logger.log(`Successfully processed application ${job.applicationId}`);
      } catch (err) {
        this.logger.error(
          `Failed to process application ${job.applicationId}: ${err.message}`,
        );

        const maxAttempts = this.queueService.getMaxAttempts();
        if (job.attempt < maxAttempts) {
          channel.ack(msg); // ACK original, publish retry
          await this.queueService.publishRetry(job.applicationId, job.attempt + 1);
        } else {
          this.logger.error(
            `Max attempts reached for application ${job.applicationId}, sending to DLQ`,
          );
          channel.nack(msg, false, false); // → DLQ
        }
      }
    });

    this.logger.log(`Consumer started on queue: ${queue}`);
  }
}
