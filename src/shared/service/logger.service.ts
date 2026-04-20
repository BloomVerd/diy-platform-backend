import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as winston from 'winston';

@Injectable()
export class AppLoggerService implements NestLoggerService {
  private logger: winston.Logger;
  private context?: string;

  constructor(private configService: ConfigService) {
    const isProduction = this.configService.get('STAGE') === 'production';

    this.logger = winston.createLogger({
      level: isProduction ? 'info' : 'debug',
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.json(),
      ),
      defaultMeta: {
        service: 'bloomverd-sms',
        environment: this.configService.get('STAGE'),
      },
      transports: [
        // Console transport with color in development
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(
              ({ timestamp, level, message, context, ...meta }) => {
                const contextStr = context ? `[${context}]` : '';
                const metaStr =
                  Object.keys(meta).length > 0
                    ? `\n${JSON.stringify(meta, null, 2)}`
                    : '';
                return `${timestamp} ${level} ${contextStr} ${message}${metaStr}`;
              },
            ),
          ),
        }),
        // File transport for errors
        new winston.transports.File({
          filename: 'logs/error.log',
          level: 'error',
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json(),
          ),
        }),
        // File transport for all logs
        new winston.transports.File({
          filename: 'logs/combined.log',
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json(),
          ),
        }),
      ],
    });
  }

  setContext(context: string) {
    this.context = context;
  }

  log(message: string, context?: string): void {
    this.logger.info(message, { context: context || this.context });
  }

  error(message: string, trace?: string, context?: string): void {
    this.logger.error(message, {
      context: context || this.context,
      trace,
    });
  }

  warn(message: string, context?: string): void {
    this.logger.warn(message, { context: context || this.context });
  }

  debug(message: string, context?: string): void {
    this.logger.debug(message, { context: context || this.context });
  }

  verbose(message: string, context?: string): void {
    this.logger.verbose(message, { context: context || this.context });
  }

  // Additional helper methods
  logWithMetadata(
    level: string,
    message: string,
    metadata: Record<string, any>,
    context?: string,
  ): void {
    this.logger.log(level, message, {
      context: context || this.context,
      ...metadata,
    });
  }

  // HTTP request logging
  logRequest(
    method: string,
    url: string,
    statusCode: number,
    duration: number,
    userId?: string,
  ): void {
    this.logger.info('HTTP Request', {
      context: 'HTTP',
      method,
      url,
      statusCode,
      duration: `${duration}ms`,
      userId,
    });
  }

  // GraphQL operation logging
  logGraphQL(
    operation: string,
    operationType: string,
    duration: number,
    userId?: string,
    variables?: any,
  ): void {
    this.logger.info('GraphQL Operation', {
      context: 'GraphQL',
      operation,
      operationType,
      duration: `${duration}ms`,
      userId,
      variables,
    });
  }

  // Database query logging
  logDatabaseQuery(query: string, duration: number, parameters?: any[]): void {
    this.logger.debug('Database Query', {
      context: 'Database',
      query,
      duration: `${duration}ms`,
      parameters,
    });
  }

  // Authentication logging
  logAuth(
    event: 'login' | 'logout' | 'login_failed' | 'token_refresh',
    userId?: string,
    email?: string,
    reason?: string,
  ): void {
    const level = event === 'login_failed' ? 'warn' : 'info';
    this.logger.log(level, `Authentication: ${event}`, {
      context: 'Auth',
      event,
      userId,
      email,
      reason,
    });
  }

  // Error logging with stack trace
  logError(
    error: Error,
    context?: string,
    metadata?: Record<string, any>,
  ): void {
    this.logger.error(error.message, {
      context: context || this.context,
      stack: error.stack,
      name: error.name,
      ...metadata,
    });
  }

  // Business event logging
  logBusinessEvent(
    event: string,
    data: Record<string, any>,
    context?: string,
  ): void {
    this.logger.info(`Business Event: ${event}`, {
      context: context || this.context || 'Business',
      event,
      ...data,
    });
  }
}
