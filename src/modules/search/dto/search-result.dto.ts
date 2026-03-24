export class SearchResultDto {
  applicationId: string;
  score: number;
  candidate: {
    firstName: string;
    lastName: string;
    email: string;
    currentTitle: string | null;
    currentCompany: string | null;
    totalExperienceYears: number | null;
    skills: string[];
    summary: string | null;
    appliedAt: Date;
  };
}
