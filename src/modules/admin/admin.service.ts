import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApplicationEntity, ApplicationStatus } from '../../database/entities/application.entity';
import { CandidateProfileEntity } from '../../database/entities/candidate-profile.entity';
import { UserEntity } from '../../database/entities/user.entity';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { QueueService } from '../queue/queue.service';

export interface DashboardStats {
  applications: {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  };
  users: {
    total: number;
    active: number;
  };
  qdrant: {
    indexedCandidates: number;
    vectorDimensions: number;
  };
}

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(ApplicationEntity)
    private readonly appRepo: Repository<ApplicationEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(CandidateProfileEntity)
    private readonly profileRepo: Repository<CandidateProfileEntity>,
    private readonly embeddings: EmbeddingsService,
    private readonly queue: QueueService,
  ) {}

  async getDashboardStats(): Promise<DashboardStats> {
    const [
      totalApps,
      pendingApps,
      processingApps,
      completedApps,
      failedApps,
      totalUsers,
      activeUsers,
    ] = await Promise.all([
      this.appRepo.count(),
      this.appRepo.count({ where: { status: ApplicationStatus.PENDING } }),
      this.appRepo.count({ where: { status: ApplicationStatus.PROCESSING } }),
      this.appRepo.count({ where: { status: ApplicationStatus.COMPLETED } }),
      this.appRepo.count({ where: { status: ApplicationStatus.FAILED } }),
      this.userRepo.count(),
      this.userRepo.count({ where: { status: 'active' as any } }),
    ]);

    let qdrantInfo = { indexedCandidates: 0, vectorDimensions: 0 };
    try {
      const info = await this.embeddings.getCollectionInfo();
      qdrantInfo = {
        indexedCandidates: info.points_count ?? 0,
        vectorDimensions: (info.config?.params?.vectors as any)?.size ?? 0,
      };
    } catch {
      // Qdrant might be unavailable
    }

    return {
      applications: {
        total: totalApps,
        pending: pendingApps,
        processing: processingApps,
        completed: completedApps,
        failed: failedApps,
      },
      users: { total: totalUsers, active: activeUsers },
      qdrant: qdrantInfo,
    };
  }

  async reprocessApplication(applicationId: string): Promise<{ queued: boolean }> {
    const app = await this.appRepo.findOne({ where: { id: applicationId } });
    if (!app) throw new NotFoundException(`Application ${applicationId} not found`);

    // Reset status so the pipeline accepts the job
    await this.appRepo.update(app.id, {
      status: ApplicationStatus.PENDING,
      failureReason: null,
      processingAttempts: 0,
    });

    // Re-publish to RabbitMQ (attempt=1 so retry counter resets)
    await this.queue.publishApplicationJob(applicationId, 1);

    return { queued: true };
  }
}
