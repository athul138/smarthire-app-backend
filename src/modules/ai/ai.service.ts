import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { ParsedResumeDto } from './dto/parsed-resume.dto';

// Compact prompts — minimise input tokens while keeping output accurate
const RESUME_SYSTEM_PROMPT = `HR data extractor. Return ONLY valid JSON. No markdown, no explanation.`;

// Compact schema (single-line values) saves ~40% tokens vs verbose version
const RESUME_SCHEMA = `{"firstName":"string","lastName":"string","email":"string","phone":"string|null","currentTitle":"string|null","currentCompany":"string|null","summary":"string|null","totalExperienceYears":"number|null","skills":["strings"],"languages":["strings"],"certifications":["strings"],"experience":[{"company":"string","title":"string","startDate":"YYYY-MM","endDate":"YYYY-MM|null","isCurrent":false,"description":"string","skills":["strings"]}],"education":[{"institution":"string","degree":"string","field":"string","startDate":"YYYY-MM","endDate":"YYYY-MM|null","gpa":"number|null"}]}`;

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  // Gemini (primary)
  private readonly geminiApiKey: string | undefined;
  private readonly geminiModel: string;
  private readonly geminiEmbeddingModel: string;

  // OpenAI (fallback for chat, primary for embeddings)
  private readonly openai: OpenAI | null = null;
  private readonly openaiChatModel: string;
  private readonly openaiEmbeddingModel: string;
  private readonly embeddingDimensions: number;

  constructor(config: ConfigService) {
    this.geminiApiKey = config.get<string>('gemini.apiKey');
    this.geminiModel = config.get<string>('gemini.model', 'gemini-2.0-flash-lite');
    this.geminiEmbeddingModel = config.get<string>('gemini.embeddingModel', 'embedding-001');

    const openaiKey = config.get<string>('openai.apiKey');
    if (openaiKey) {
      this.openai = new OpenAI({ apiKey: openaiKey });
    }
    this.openaiChatModel = config.get<string>('openai.chatModel', 'gpt-4o');
    this.openaiEmbeddingModel = config.get<string>('openai.embeddingModel', 'text-embedding-3-large');
    this.embeddingDimensions = config.get<number>('gemini.embeddingDimensions', 768);
  }

  async parseResume(resumeText: string): Promise<ParsedResumeDto> {
    // 8000 chars covers a full multi-page resume (skills/experience/education
    // typically appear after the 3000-char mark — old limit caused empty arrays)
    const trimmed = resumeText.slice(0, 8000);

    if (this.geminiApiKey) {
      this.logger.debug(`Parsing resume with Gemini (${this.geminiModel})`);
      return this.parseResumeWithGemini(trimmed);
    }
    if (this.openai) {
      this.logger.debug(`Parsing resume with OpenAI (${this.openaiChatModel})`);
      return this.parseResumeWithOpenAI(trimmed);
    }
    throw new Error('No AI provider configured. Set GEMINI_API_KEY or OPENAI_API_KEY.');
  }

  private async parseResumeWithGemini(resumeText: string): Promise<ParsedResumeDto> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.geminiModel}:generateContent?key=${this.geminiApiKey}`;

    const body = {
      system_instruction: { parts: [{ text: RESUME_SYSTEM_PROMPT }] },
      contents: [
        {
          parts: [
            {
              text: `Extract resume data as JSON matching this schema:\n${RESUME_SCHEMA}\n\nRESUME:\n${resumeText}`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
      },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API error ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as any;
    // gemini-2.5-flash is a thinking model — parts[0] may be a thought token
    // (has `thought: true`). Skip thought parts and take the first actual content.
    const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
    const contentPart = parts.find((p: any) => !p.thought);
    const content = contentPart?.text;
    if (!content) throw new Error('Gemini returned empty response');

    const parsed = JSON.parse(content) as ParsedResumeDto;
    this.validateParsedResume(parsed);
    return parsed;
  }

  private async parseResumeWithOpenAI(resumeText: string): Promise<ParsedResumeDto> {
    const response = await this.openai!.chat.completions.create({
      model: this.openaiChatModel,
      messages: [
        { role: 'system', content: RESUME_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Extract resume as JSON matching:\n${RESUME_SCHEMA}\n\nRESUME:\n${resumeText}`,
        },
      ],
      max_tokens: 2048,
      temperature: 0.1,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('OpenAI returned empty response');

    const parsed = JSON.parse(content) as ParsedResumeDto;
    this.validateParsedResume(parsed);
    return parsed;
  }

  async generateEmbedding(
    text: string,
    taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY' = 'RETRIEVAL_DOCUMENT',
  ): Promise<number[]> {
    // gemini-embedding-2-preview supports 8192 tokens (~6000 chars)
    const trimmed = text.trim().slice(0, 6000);
    if (!trimmed) throw new Error('Cannot generate embedding: text is empty');

    // Prefer Gemini for embeddings (gemini-embedding-2-preview, 3072d)
    if (this.geminiApiKey) {
      this.logger.debug(
        `Generating embedding with Gemini (${this.geminiEmbeddingModel}, ${this.embeddingDimensions}d, taskType=${taskType})`,
      );
      return this.generateEmbeddingWithGemini(trimmed, taskType);
    }
    if (this.openai) {
      this.logger.debug(`Generating embedding with OpenAI (${this.openaiEmbeddingModel}, ${this.embeddingDimensions}d)`);
      return this.generateEmbeddingWithOpenAI(trimmed);
    }
    throw new Error('No AI provider configured.');
  }

  private async generateEmbeddingWithGemini(
    text: string,
    taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY',
  ): Promise<number[]> {
    // gemini-embedding-2-preview is in v1beta
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.geminiEmbeddingModel}:embedContent?key=${this.geminiApiKey}`;

    const body: Record<string, any> = {
      model: `models/${this.geminiEmbeddingModel}`,
      content: { parts: [{ text }] },
      taskType,
      outputDimensionality: this.embeddingDimensions,
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini Embedding API error ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as any;
    const values = data?.embedding?.values;
    if (!Array.isArray(values)) throw new Error('Gemini embedding returned no values');
    return values as number[];
  }

  private async generateEmbeddingWithOpenAI(text: string): Promise<number[]> {
    const response = await this.openai!.embeddings.create({
      model: this.openaiEmbeddingModel,
      input: text,
    });
    return response.data[0].embedding;
  }

  buildEmbeddingText(profile: ParsedResumeDto): string {
    const parts: string[] = [];

    if (profile.currentTitle) parts.push(`Role: ${profile.currentTitle}`);
    if (profile.currentCompany) parts.push(`Company: ${profile.currentCompany}`);

    if (profile.skills?.length) {
      parts.push(`Skills: ${profile.skills.join(', ')}`);
    }

    profile.experience?.forEach((exp) => {
      const line = `${exp.title} at ${exp.company}: ${exp.description}`;
      parts.push(line);
      if (exp.skills?.length) parts.push(`Used: ${exp.skills.join(', ')}`);
    });

    // Fallback: ensure we always return non-empty text so the embedding API never
    // receives an empty Part (causes a 400 INVALID_ARGUMENT from Gemini).
    if (!parts.length) {
      const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
      parts.push(name || profile.email || 'candidate profile');
    }

    return parts.join('\n');
  }

  private validateParsedResume(parsed: ParsedResumeDto): void {
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('AI returned invalid JSON structure');
    }
    if (!Array.isArray(parsed.skills)) parsed.skills = [];
    if (!Array.isArray(parsed.experience)) parsed.experience = [];
    if (!Array.isArray(parsed.education)) parsed.education = [];
  }
}
