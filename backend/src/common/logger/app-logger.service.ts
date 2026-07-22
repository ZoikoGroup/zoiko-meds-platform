import { ConsoleLogger, Injectable, LoggerService, LogLevel } from '@nestjs/common';

/**
 * Structured logger. In production it emits one JSON object per line (easy for
 * Cloud Logging / Loki / Datadog to parse); elsewhere it falls back to Nest's
 * readable console formatting. Never logs request bodies or secrets.
 */
@Injectable()
export class AppLogger extends ConsoleLogger implements LoggerService {
  private readonly json = process.env.NODE_ENV === 'production';

  private emit(level: LogLevel, message: unknown, context?: string, extra?: Record<string, unknown>) {
    if (!this.json) {
      // Delegate to Nest's pretty console formatting in dev/test.
      switch (level) {
        case 'error':
          return super.error(message as string, context);
        case 'warn':
          return super.warn(message as string, context);
        case 'debug':
          return super.debug?.(message as string, context);
        case 'verbose':
          return super.verbose?.(message as string, context);
        default:
          return super.log(message as string, context);
      }
    }
    const line = {
      level,
      time: new Date().toISOString(),
      context: context ?? this.context,
      message,
      ...extra,
    };
    // eslint-disable-next-line no-console
    (level === 'error' || level === 'warn' ? console.error : console.log)(
      JSON.stringify(line),
    );
  }

  log(message: unknown, context?: string) {
    this.emit('log', message, context);
  }
  error(message: unknown, stackOrContext?: string, context?: string) {
    this.emit('error', message, context ?? stackOrContext, { stack: context ? stackOrContext : undefined });
  }
  warn(message: unknown, context?: string) {
    this.emit('warn', message, context);
  }
  debug(message: unknown, context?: string) {
    this.emit('debug', message, context);
  }
  verbose(message: unknown, context?: string) {
    this.emit('verbose', message, context);
  }

  /** Structured request-scoped log used by the logging interceptor. */
  request(entry: Record<string, unknown>) {
    if (this.json) {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ level: 'log', time: new Date().toISOString(), context: 'HTTP', ...entry }));
    } else {
      super.log(
        `${entry.method} ${entry.url} ${entry.statusCode} ${entry.durationMs}ms`,
        'HTTP',
      );
    }
  }
}
