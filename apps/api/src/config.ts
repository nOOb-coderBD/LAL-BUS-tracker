import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
export const rootDir = fileURLToPath(new URL('../../../', import.meta.url));
config({ path: `${rootDir}.env`, quiet: true } as Parameters<typeof config>[0]);
const env = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/lal_bus'),
    MONGODB_MAX_POOL_SIZE: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(process.env.VERCEL === '1' ? 5 : 30),
    REDIS_URL: z.string().default('redis://127.0.0.1:6379/0'),
    APP_ORIGIN: z.string().url().default('http://localhost:5173'),
    ALLOWED_ORIGINS: z.string().optional(),
    ALLOW_DEMO_AUTH: z.string().default('false'),
    COOKIE_SECURE: z.string().optional(),
    TRUST_PROXY: z
      .string()
      .trim()
      .regex(/^(?:false|true|[0-5])$/, 'TRUST_PROXY must be false, true, or an integer from 0 to 5')
      .default('false'),
    STALE_AFTER_SECONDS: z.coerce.number().positive().default(30),
    OFFLINE_AFTER_SECONDS: z.coerce.number().positive().default(120),
    LOCATION_RETENTION_HOURS: z.coerce.number().positive().default(24),
    LOCATION_SNAPSHOT_SECONDS: z.coerce.number().positive().default(30),
    SESSION_TTL_SECONDS: z.coerce.number().positive().default(43200),
    DU_EMAIL_DOMAINS: z.string().default('du.ac.bd,student.du.ac.bd'),
    SMTP_URL: z.string().optional(),
    PUBLIC_URL: z.string().url().optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().default(587),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    SMTP_FROM: z.string().default('Lal Bus Tracker <no-reply@example.invalid>'),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_WORKSPACE_DOMAINS: z.string().default(''),
    LOG_LEVEL: z.string().default('info'),
    AUTH_RATE_LIMIT: z.coerce.number().int().positive().default(12),
  })
  .parse(process.env);
if (env.OFFLINE_AFTER_SECONDS <= env.STALE_AFTER_SECONDS)
  throw new Error('OFFLINE_AFTER_SECONDS must exceed STALE_AFTER_SECONDS');
if (env.NODE_ENV === 'production' && env.ALLOW_DEMO_AUTH === 'true')
  throw new Error('Demo authentication cannot be enabled in production');
const origins = (env.ALLOWED_ORIGINS ?? env.APP_ORIGIN)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
for (const origin of [env.APP_ORIGIN, ...origins]) {
  const parsed = new URL(origin);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin)
    throw new Error('Origins must be exact HTTP(S) origins without paths or credentials');
}
if (!origins.length) throw new Error('At least one allowed origin is required');
const trustProxyHops =
  env.TRUST_PROXY === 'true' ? 1 : env.TRUST_PROXY === 'false' ? 0 : Number(env.TRUST_PROXY);
export const cfg = { ...env, origins, trustProxyHops };
export const demoEnabled = cfg.NODE_ENV === 'development' && cfg.ALLOW_DEMO_AUTH === 'true';
