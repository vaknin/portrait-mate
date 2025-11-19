import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config({ debug: false, quiet: true } as any);

const configSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PHOTOS_DIR: z.string().default('./session'),
  AUTH_INFO_DIR: z.string().default('./auth_info'),
  GPHOTO2_PATH: z.string().default('gphoto2'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Config = z.infer<typeof configSchema>;

const parsedConfig = configSchema.safeParse(process.env);

if (!parsedConfig.success) {
  console.error('❌ Invalid configuration:', parsedConfig.error.format());
  process.exit(1);
}

export const config = parsedConfig.data;
