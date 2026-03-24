import * as Joi from 'joi';

export const configValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  CORS_ORIGIN: Joi.string().default('http://localhost:5173'),

  // Database
  DB_HOST: Joi.string().default('localhost'),
  DB_PORT: Joi.number().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),
  DB_SSL: Joi.boolean().default(false),
  DB_SYNCHRONIZE: Joi.boolean().default(false),
  DB_LOGGING: Joi.boolean().default(false),

  // JWT
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),

  // AWS
  AWS_ACCESS_KEY_ID: Joi.string().required(),
  AWS_SECRET_ACCESS_KEY: Joi.string().required(),
  AWS_REGION: Joi.string().default('us-east-1'),
  AWS_S3_BUCKET: Joi.string().required(),
  AWS_S3_SIGNED_URL_EXPIRY: Joi.number().default(3600),

  // Gemini (primary AI provider)
  GEMINI_API_KEY: Joi.string().optional(),
  GEMINI_MODEL: Joi.string().default('gemini-2.0-flash-lite'),
  GEMINI_EMBEDDING_MODEL: Joi.string().default('gemini-embedding-2-preview'),

  // OpenAI (fallback AI provider)
  OPENAI_API_KEY: Joi.string().optional(),
  OPENAI_EMBEDDING_MODEL: Joi.string().default('text-embedding-3-large'),
  OPENAI_CHAT_MODEL: Joi.string().default('gpt-4o'),
  OPENAI_MAX_TOKENS: Joi.number().default(4096),

  // Shared embedding config (3072 for gemini-embedding-2-preview)
  EMBEDDING_DIMENSIONS: Joi.number().default(3072),

  // Qdrant
  QDRANT_HOST: Joi.string().default('localhost'),
  QDRANT_PORT: Joi.number().default(6333),
  QDRANT_API_KEY: Joi.string().optional(),
  QDRANT_COLLECTION: Joi.string().default('candidates'),

  // RabbitMQ
  RABBITMQ_URL: Joi.string().default('amqp://guest:guest@localhost:5672'),
  RABBITMQ_EXCHANGE: Joi.string().default('smarthire'),
  RABBITMQ_QUEUE: Joi.string().default('smarthire.applications'),
  RABBITMQ_DLQ: Joi.string().default('smarthire.applications.dlq'),
  RABBITMQ_RETRY_ATTEMPTS: Joi.number().default(3),
  RABBITMQ_RETRY_DELAY: Joi.number().default(5000),
}).options({ allowUnknown: true });
