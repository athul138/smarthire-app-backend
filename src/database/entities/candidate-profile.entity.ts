import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ApplicationEntity } from './application.entity';

@Entity('candidate_profiles')
@Index(['applicationId'], { unique: true })
@Index(['qdrantPointId'])
export class CandidateProfileEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  applicationId: string;

  @OneToOne(() => ApplicationEntity, (app) => app.candidateProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'applicationId' })
  application: ApplicationEntity;

  // Parsed structured data from AI
  @Column({ type: 'jsonb' })
  skills: string[];

  @Column({ type: 'jsonb' })
  experience: WorkExperience[];

  @Column({ type: 'jsonb' })
  education: Education[];

  @Column({ type: 'jsonb', nullable: true })
  certifications: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  languages: string[] | null;

  @Column({ type: 'int', nullable: true })
  totalExperienceYears: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  currentTitle: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  currentCompany: string | null;

  @Column({ type: 'text', nullable: true })
  summary: string | null;

  // Qdrant vector point ID for deletion/update
  @Column({ nullable: true, type: 'uuid' })
  qdrantPointId: string | null;

  @Column({ default: false })
  isIndexed: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

export interface WorkExperience {
  company: string;
  title: string;
  startDate: string;
  endDate: string | null;
  isCurrent: boolean;
  description: string;
  skills: string[];
}

export interface Education {
  institution: string;
  degree: string;
  field: string;
  startDate: string;
  endDate: string | null;
  gpa: number | null;
}
