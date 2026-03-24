import { registerAs } from '@nestjs/config';

export const openaiConfig = registerAs('openai', () => ({
  apiKey: process.env.OPENAI_API_KEY,
  embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-large',
  embeddingDimensions: parseInt(process.env.OPENAI_EMBEDDING_DIMENSIONS || '3072', 10),
  chatModel: process.env.OPENAI_CHAT_MODEL || 'gpt-4o',
  maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS || '4096', 10),
}));
