import { Module } from '@nestjs/common';
import { QueueService } from './queue.service';
import { QueueConsumer } from './queue.consumer';

@Module({
  providers: [QueueService, QueueConsumer],
  exports: [QueueService],
})
export class QueueModule {}
