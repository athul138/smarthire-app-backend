import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqplib from 'amqplib';
import { QUEUE_EVENTS, ProcessApplicationJob } from './queue.constants';

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private connection: amqplib.Connection | null = null;
  private channel: amqplib.Channel | null = null;

  private readonly url: string;
  private readonly exchange: string;
  private readonly queue: string;
  private readonly dlq: string;
  private readonly retryAttempts: number;
  private readonly retryDelay: number;

  constructor(private readonly config: ConfigService) {
    this.url = config.get<string>('rabbitmq.url') || '';
    this.exchange = config.get<string>('rabbitmq.exchange') || '';
    this.queue = config.get<string>('rabbitmq.queue') || '';
    this.dlq = config.get<string>('rabbitmq.deadLetterQueue') || '';
    this.retryAttempts = config.get<number>('rabbitmq.retryAttempts', 3);
    this.retryDelay = config.get<number>('rabbitmq.retryDelay', 5000);
  }

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.disconnect();
  }

  async connect(): Promise<void> {
    try {
      this.connection = (await amqplib.connect(this.url)) as any;
      this.channel = await (this.connection as any).createChannel();
      await this.setupTopology();
      this.logger.log('Connected to RabbitMQ');
    } catch (err) {
      this.logger.error('RabbitMQ connection failed', err);
      // Retry with backoff
      setTimeout(() => this.connect(), 5000);
    }
  }

  private async setupTopology(): Promise<void> {
    const ch = this.channel!;

    // DLQ first
    await ch.assertQueue(this.dlq, { durable: true });

    // Main exchange
    await ch.assertExchange(this.exchange, 'direct', { durable: true });

    // Main queue with DLQ routing
    await ch.assertQueue(this.queue, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': this.dlq,
      },
    });

    await ch.bindQueue(this.queue, this.exchange, QUEUE_EVENTS.PROCESS_APPLICATION);
  }

  async publishApplicationJob(applicationId: string, attempt = 1): Promise<void> {
    if (!this.channel) {
      throw new Error('RabbitMQ channel not available');
    }

    const job: ProcessApplicationJob = { applicationId, attempt };
    const content = Buffer.from(JSON.stringify(job));

    this.channel.publish(
      this.exchange,
      QUEUE_EVENTS.PROCESS_APPLICATION,
      content,
      {
        persistent: true,
        contentType: 'application/json',
        headers: { 'x-attempt': attempt },
      },
    );

    this.logger.log(`Published job for application ${applicationId} (attempt ${attempt})`);
  }

  async publishRetry(applicationId: string, attempt: number): Promise<void> {
    const delay = this.retryDelay * Math.pow(2, attempt - 1); // Exponential backoff
    this.logger.log(`Scheduling retry for ${applicationId} in ${delay}ms (attempt ${attempt})`);

    await new Promise((r) => setTimeout(r, delay));
    await this.publishApplicationJob(applicationId, attempt);
  }

  getChannel(): amqplib.Channel | null {
    return this.channel;
  }

  getQueueName(): string {
    return this.queue;
  }

  getMaxAttempts(): number {
    return this.retryAttempts;
  }

  private async disconnect(): Promise<void> {
    try {
      await this.channel?.close();
      await (this.connection as any)?.close();
    } catch (err) {
      this.logger.warn('Error during RabbitMQ disconnect', err);
    }
  }
}
