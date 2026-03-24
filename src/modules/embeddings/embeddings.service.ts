import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QdrantClient } from '@qdrant/js-client-rest';
import { v4 as uuidv4 } from 'uuid';

export interface CandidatePayload {
  applicationId: string;
  email: string;
  firstName: string;
  lastName: string;
  skills: string[];
  currentTitle: string | null;
  totalExperienceYears: number | null;
  [key: string]: any;
}

export interface SearchResult {
  applicationId: string;
  score: number;
  payload: CandidatePayload;
}

@Injectable()
export class EmbeddingsService implements OnModuleInit {
  private readonly logger = new Logger(EmbeddingsService.name);
  private client: QdrantClient;
  private readonly collection: string;
  private readonly dimensions: number;

  constructor(private readonly config: ConfigService) {
    this.collection = config.get<string>('qdrant.collectionName', 'candidates');
    // Reads EMBEDDING_DIMENSIONS — 768 for Gemini text-embedding-004, 3072 for OpenAI
    this.dimensions = config.get<number>('gemini.embeddingDimensions', 768);

    this.client = new QdrantClient({
      host: config.get<string>('qdrant.host', 'localhost'),
      port: config.get<number>('qdrant.port', 6333),
      apiKey: config.get<string>('qdrant.apiKey'),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.ensureCollection();
  }

  private async ensureCollection(): Promise<void> {
    try {
      const collections = await this.client.getCollections();
      const exists = collections.collections.some((c) => c.name === this.collection);

      if (!exists) {
        await this.client.createCollection(this.collection, {
          vectors: {
            size: this.dimensions,
            distance: 'Cosine',
          },
          optimizers_config: {
            default_segment_number: 2,
          },
          replication_factor: 1,
        });

        // Create payload index for filtering
        await this.client.createPayloadIndex(this.collection, {
          field_name: 'applicationId',
          field_schema: 'keyword',
        });

        this.logger.log(`Qdrant collection '${this.collection}' created (${this.dimensions}d)`);
      } else {
        // Validate existing collection has matching vector dimensions
        const info = await this.client.getCollection(this.collection);
        const existingSize = (info.config?.params?.vectors as any)?.size;
        if (existingSize && existingSize !== this.dimensions) {
          this.logger.error(
            `Qdrant collection '${this.collection}' has dimension mismatch: ` +
              `collection=${existingSize}d, configured=${this.dimensions}d. ` +
              `Delete the collection and restart to recreate it with the correct dimensions.`,
          );
          throw new Error(
            `Qdrant dimension mismatch: collection has ${existingSize}d vectors but EMBEDDING_DIMENSIONS=${this.dimensions}. ` +
              `Run: curl -X DELETE http://localhost:6333/collections/${this.collection}`,
          );
        }
        this.logger.log(`Qdrant collection '${this.collection}' ready (${existingSize ?? this.dimensions}d)`);
      }
    } catch (err) {
      this.logger.error('Failed to initialize Qdrant collection', err);
    }
  }

  async upsert(
    applicationId: string,
    vector: number[],
    payload: CandidatePayload,
  ): Promise<string> {
    const pointId = uuidv4();

    await this.client.upsert(this.collection, {
      wait: true,
      points: [
        {
          id: pointId,
          vector,
          payload: { ...payload, applicationId },
        },
      ],
    });

    return pointId;
  }

  async search(
    queryVector: number[],
    limit: number = 20,
    filters?: { minExperienceYears?: number; skills?: string[] },
  ): Promise<SearchResult[]> {
    const qdrantFilter: any = { must: [] };

    if (filters?.minExperienceYears != null) {
      qdrantFilter.must.push({
        key: 'totalExperienceYears',
        range: { gte: filters.minExperienceYears },
      });
    }

    if (filters?.skills?.length) {
      qdrantFilter.must.push({
        key: 'skills',
        match: { any: filters.skills },
      });
    }

    const searchParams: any = {
      vector: queryVector,
      limit,
      with_payload: true,
      score_threshold: 0.3,
    };

    if (qdrantFilter.must.length > 0) {
      searchParams.filter = qdrantFilter;
    }

    const results = await this.client.search(this.collection, searchParams);

    return results.map((r) => ({
      applicationId: (r.payload as CandidatePayload).applicationId,
      score: r.score,
      payload: r.payload as CandidatePayload,
    }));
  }

  async delete(pointId: string): Promise<void> {
    await this.client.delete(this.collection, {
      wait: true,
      points: [pointId],
    });
  }

  async getCollectionInfo() {
    return this.client.getCollection(this.collection);
  }
}
