import { WorkExperience, Education } from '../../../database/entities/candidate-profile.entity';

export class ParsedResumeDto {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  currentTitle: string | null;
  currentCompany: string | null;
  summary: string | null;
  totalExperienceYears: number | null;
  skills: string[];
  languages: string[] | null;
  certifications: string[] | null;
  experience: WorkExperience[];
  education: Education[];
}
