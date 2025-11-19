import pino from 'pino';
import { config } from './config.js';

const isDev = config.NODE_ENV === 'development';

let stream;
if (isDev) {
  // In development, use pino-pretty with sync: true to ensure logs are flushed on exit
  const pretty = await import('pino-pretty');
  stream = pretty.default({
    colorize: true,
    translateTime: 'SYS:standard',
    ignore: 'pid,hostname',
    sync: true, // Crucial for seeing shutdown logs
  });
}

export const logger = pino(
  {
    level: config.LOG_LEVEL,
  },
  stream,
);
