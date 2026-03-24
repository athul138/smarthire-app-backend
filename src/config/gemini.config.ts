import { registerAs } from '@nestjs/config';

export const geminiConfig = registerAs('gemini', () => ({
  apiKey: process.env.GEMINI_API_KEY,
  model: process.env.GEMINI_MODEL || 'gemini-2.0-flash-lite',
  embeddingModel: process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2-preview',
  // gemini-embedding-2-preview outputs up to 3072 dimensions (configurable)
  embeddingDimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || '3072', 10),
}));
