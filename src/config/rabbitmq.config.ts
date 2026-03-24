import { registerAs } from '@nestjs/config';

export const rabbitmqConfig = registerAs('rabbitmq', () => ({
  url: process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672',
  exchange: process.env.RABBITMQ_EXCHANGE || 'smarthire',
  queue: process.env.RABBITMQ_QUEUE || 'smarthire.applications',
  deadLetterQueue: process.env.RABBITMQ_DLQ || 'smarthire.applications.dlq',
  retryAttempts: parseInt(process.env.RABBITMQ_RETRY_ATTEMPTS || '3', 10),
  retryDelay: parseInt(process.env.RABBITMQ_RETRY_DELAY || '5000', 10),
}));
