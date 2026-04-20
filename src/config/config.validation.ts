import * as Joi from 'joi';

export const configValidationSchema = Joi.object({
  // Application
  STAGE: Joi.string().valid('development', 'production', 'test').default('development'),
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),

  // Database
  DATABASE_URL: Joi.string().uri().required(),

  // Redis
  REDIS_URL: Joi.string().uri().required(),

  // JWT
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_EXPIRY: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_EXPIRY: Joi.string().default('7d'),

  // AWS
  AWS_REGION: Joi.string().required(),
  AWS_ACCESS_KEY_ID: Joi.string().required(),
  AWS_SECRET_ACCESS_KEY: Joi.string().required(),
  AWS_S3_BUCKET: Joi.string().required(),

  // CDN
  CDN_BASE_URL: Joi.string().uri().required(),

  // Livestream — RTMP ingest base URL (e.g. rtmp://ingest.example.com/live)
  STREAM_INGEST_BASE_URL: Joi.string().required(),

  // OAuth
  GOOGLE_OAUTH_CLIENT_ID: Joi.string().required(),
  APPLE_CLIENT_ID: Joi.string().required(),

  // SMTP (nodemailer)
  SMTP_HOST: Joi.string().required(),
  SMTP_PORT: Joi.number().default(587),
  SMTP_SECURE: Joi.boolean().default(false),
  SMTP_USER: Joi.string().required(),
  SMTP_PASSWORD: Joi.string().required(),
  SMTP_FROM: Joi.string().required(),

  // OTP
  OTP_EXPIRY_MINUTES: Joi.number().default(10),
  OTP_MAX_ATTEMPTS: Joi.number().default(5),
});
