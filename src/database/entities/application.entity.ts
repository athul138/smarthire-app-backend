import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToOne,
} from 'typeorm';
import { CandidateProfileEntity } from './candidate-profile.entity';

export enum ApplicationStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

@Entity('applications')
@Index(['email'])
@Index(['status'])
@Index(['createdAt'])
export class ApplicationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100 })
  firstName: string;

  @Column({ length: 100 })
  lastName: string;

  @Column({ length: 255 })
  email: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  linkedinUrl: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  portfolioUrl: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  positionAppliedFor: string | null;

  // S3 key (not public URL)
  @Column({ length: 512 })
  resumeKey: string;

  @Column({ length: 100 })
  resumeContentType: string;

  @Column({ type: 'bigint' })
  resumeSize: number;

  @Column({ type: 'enum', enum: ApplicationStatus, default: ApplicationStatus.PENDING })
  status: ApplicationStatus;

  @Column({ type: 'int', default: 0 })
  processingAttempts: number;

  @Column({ nullable: true, type: 'text' })
  failureReason: string | null;

  @Column({ nullable: true, type: 'text' })
  rawResumeText: string | null;

  @Column({ nullable: true, type: 'timestamp' })
  processedAt: Date | null;

  @OneToOne(() => CandidateProfileEntity, (profile) => profile.application, {
    cascade: true,
    nullable: true,
  })
  candidateProfile: CandidateProfileEntity | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
