import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiService } from './ai.service';
import { ParsedResumeDto } from './dto/parsed-resume.dto';

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildConfig(overrides: Record<string, any> = {}) {
  return {
    get: jest.fn((key: string, defaultVal?: any) => {
      const config: Record<string, any> = {
        'gemini.apiKey': 'fake-gemini-key',
        'gemini.model': 'gemini-2.0-flash-lite',
        'gemini.embeddingModel': 'embedding-001',
        'gemini.embeddingDimensions': 768,
        'openai.apiKey': undefined,
        'openai.chatModel': 'gpt-4o',
        'openai.embeddingModel': 'text-embedding-3-large',
        ...overrides,
      };
      return config[key] ?? defaultVal;
    }),
  };
}

const PARSED_RESUME: ParsedResumeDto = {
  firstName: 'Alice',
  lastName: 'Wonder',
  email: 'alice@example.com',
  phone: null,
  currentTitle: 'Backend Developer',
  currentCompany: 'Acme Corp',
  summary: 'Experienced engineer.',
  totalExperienceYears: 5,
  skills: ['TypeScript', 'NestJS', 'PostgreSQL'],
  languages: ['English'],
  certifications: [],
  experience: [
    {
      company: 'Acme Corp',
      title: 'Senior Engineer',
      startDate: '2020-01',
      endDate: null,
      isCurrent: true,
      description: 'Built scalable APIs.',
      skills: ['NestJS', 'PostgreSQL'],
    },
  ],
  education: [
    {
      institution: 'MIT',
      degree: 'BSc',
      field: 'Computer Science',
      startDate: '2015-09',
      endDate: '2019-06',
      gpa: 3.8,
    },
  ],
};

describe('AiService', () => {
  let service: AiService;

  // ─── with Gemini configured ───────────────────────────────────────────────

  describe('with Gemini API key configured', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AiService,
          { provide: ConfigService, useValue: buildConfig() },
        ],
      }).compile();

      service = module.get(AiService);
    });

    afterEach(() => jest.restoreAllMocks());

    describe('parseResume', () => {
      it('calls Gemini generateContent endpoint', async () => {
        const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
          ok: true,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [{ text: JSON.stringify(PARSED_RESUME) }],
                },
              },
            ],
          }),
        } as any);

        const result = await service.parseResume('Alice Wonder resume text...');

        expect(fetchSpy).toHaveBeenCalledWith(
          expect.stringContaining('generateContent'),
          expect.objectContaining({ method: 'POST' }),
        );
        expect(result.firstName).toBe('Alice');
        expect(result.skills).toEqual(['TypeScript', 'NestJS', 'PostgreSQL']);
      });

      it('truncates resume text to 8000 chars before sending to AI', async () => {
        const longText = 'a'.repeat(10000);
        let capturedBody: any;

        jest.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
          capturedBody = JSON.parse((init as RequestInit).body as string);
          return {
            ok: true,
            json: async () => ({
              candidates: [
                { content: { parts: [{ text: JSON.stringify(PARSED_RESUME) }] } },
              ],
            }),
          } as any;
        });

        await service.parseResume(longText);

        const sentText: string = capturedBody.contents[0].parts[0].text;
        // The text should include truncated resume (8000 chars within the prompt)
        expect(sentText.length).toBeLessThan(longText.length);
      });

      it('throws when Gemini returns a non-ok response', async () => {
        jest.spyOn(global, 'fetch').mockResolvedValue({
          ok: false,
          status: 429,
          text: async () => 'Rate limit exceeded',
        } as any);

        await expect(service.parseResume('resume text')).rejects.toThrow('Gemini API error 429');
      });

      it('throws when Gemini returns empty content', async () => {
        jest.spyOn(global, 'fetch').mockResolvedValue({
          ok: true,
          json: async () => ({
            candidates: [{ content: { parts: [{ thought: true, text: 'thinking...' }] } }],
          }),
        } as any);

        await expect(service.parseResume('resume text')).rejects.toThrow(
          'Gemini returned empty response',
        );
      });

      it('ensures arrays are initialised even if AI omits them', async () => {
        const partialResume = { firstName: 'Bob', lastName: 'Lee', email: 'bob@x.com' };
        jest.spyOn(global, 'fetch').mockResolvedValue({
          ok: true,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: JSON.stringify(partialResume) }] } }],
          }),
        } as any);

        const result = await service.parseResume('resume text');

        expect(Array.isArray(result.skills)).toBe(true);
        expect(Array.isArray(result.experience)).toBe(true);
        expect(Array.isArray(result.education)).toBe(true);
      });
    });

    describe('generateEmbedding', () => {
      const EMBEDDING = Array.from({ length: 768 }, (_, i) => i * 0.001);

      it('calls Gemini embedContent endpoint', async () => {
        const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
          ok: true,
          json: async () => ({ embedding: { values: EMBEDDING } }),
        } as any);

        const result = await service.generateEmbedding('TypeScript developer', 'RETRIEVAL_QUERY');

        expect(fetchSpy).toHaveBeenCalledWith(
          expect.stringContaining('embedContent'),
          expect.objectContaining({ method: 'POST' }),
        );
        expect(result).toEqual(EMBEDDING);
      });

      it('throws for empty text input', async () => {
        await expect(service.generateEmbedding('   ')).rejects.toThrow(
          'Cannot generate embedding: text is empty',
        );
      });

      it('throws when Gemini embedding response is invalid', async () => {
        jest.spyOn(global, 'fetch').mockResolvedValue({
          ok: true,
          json: async () => ({ embedding: {} }),
        } as any);

        await expect(service.generateEmbedding('text')).rejects.toThrow(
          'Gemini embedding returned no values',
        );
      });

      it('throws when Gemini returns non-ok embedding response', async () => {
        jest.spyOn(global, 'fetch').mockResolvedValue({
          ok: false,
          status: 403,
          text: async () => 'Unauthorized',
        } as any);

        await expect(service.generateEmbedding('text')).rejects.toThrow(
          'Gemini Embedding API error 403',
        );
      });
    });
  });

  // ─── with no AI provider ──────────────────────────────────────────────────

  describe('with no AI provider configured', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AiService,
          {
            provide: ConfigService,
            useValue: buildConfig({
              'gemini.apiKey': undefined,
              'openai.apiKey': undefined,
            }),
          },
        ],
      }).compile();

      service = module.get(AiService);
    });

    it('parseResume throws descriptive error', async () => {
      await expect(service.parseResume('some resume')).rejects.toThrow(
        'No AI provider configured',
      );
    });

    it('generateEmbedding throws descriptive error', async () => {
      await expect(service.generateEmbedding('some text')).rejects.toThrow(
        'No AI provider configured',
      );
    });
  });

  // ─── buildEmbeddingText ──────────────────────────────────────────────────

  describe('buildEmbeddingText', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AiService,
          { provide: ConfigService, useValue: buildConfig() },
        ],
      }).compile();

      service = module.get(AiService);
    });

    it('includes role, company, and skills', () => {
      const text = service.buildEmbeddingText(PARSED_RESUME);

      expect(text).toContain('Role: Backend Developer');
      expect(text).toContain('Company: Acme Corp');
      expect(text).toContain('TypeScript');
      expect(text).toContain('NestJS');
    });

    it('includes experience descriptions', () => {
      const text = service.buildEmbeddingText(PARSED_RESUME);

      expect(text).toContain('Senior Engineer at Acme Corp');
      expect(text).toContain('Built scalable APIs.');
    });

    it('returns non-empty fallback for minimal profile (no title/company/skills)', () => {
      const minimal: ParsedResumeDto = {
        firstName: 'Bob',
        lastName: 'Lee',
        email: 'bob@x.com',
        phone: null,
        currentTitle: null,
        currentCompany: null,
        summary: null,
        totalExperienceYears: null,
        skills: [],
        languages: [],
        certifications: [],
        experience: [],
        education: [],
      };

      const text = service.buildEmbeddingText(minimal);

      expect(text.trim().length).toBeGreaterThan(0);
    });

    it('uses email as fallback when name is empty', () => {
      const profileNoName: ParsedResumeDto = {
        ...PARSED_RESUME,
        firstName: '',
        lastName: '',
        currentTitle: null,
        currentCompany: null,
        skills: [],
        experience: [],
      };

      const text = service.buildEmbeddingText(profileNoName);

      expect(text).toContain('alice@example.com');
    });
  });
});
