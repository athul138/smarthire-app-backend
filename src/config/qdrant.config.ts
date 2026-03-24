import { registerAs } from '@nestjs/config';

export const qdrantConfig = registerAs('qdrant', () => ({
  host: process.env.QDRANT_HOST || 'localhost',
  port: parseInt(process.env.QDRANT_PORT || '6333', 10),
  apiKey: process.env.QDRANT_API_KEY,
  collectionName: process.env.QDRANT_COLLECTION || 'candidates',
}));
