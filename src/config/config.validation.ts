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
});
