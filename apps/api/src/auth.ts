import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Express, Request, RequestHandler, Response } from 'express';
import type { Redis } from 'ioredis';
import nodemailer from 'nodemailer';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { cfg, demoEnabled, rootDir } from './config.js';
import { AuditLog, DriverProfile, EmailVerificationToken, User } from './models.js';
import { seedDemo } from './seed.js';

export type Role = 'STUDENT' | 'DRIVER' | 'ADMIN';
export interface AuthUser {
  _id: string;
  name: string;
  email: string;
  role: Role;
  status: string;
  isDemo: boolean;
  emailVerifiedAt: string | null;
}
export interface AuthContext {
  user: AuthUser;
  csrfToken: string;
  sessionId: string;
}
declare module 'express-serve-static-core' {
  interface Request {
    auth: AuthContext | null;
  }
}

const COOKIE = 'lal_session';
const TTL = cfg.SESSION_TTL_SECONDS;
const tokenTtlMs = 15 * 60 * 1000;
const normalize = (value: string) => value.trim().toLowerCase();
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const allowedDomains = () =>
  cfg.DU_EMAIL_DOMAINS.split(',')
    .map(normalize)
    .filter((domain) => domain === 'du.ac.bd' || domain.endsWith('.du.ac.bd'));

export class AuthError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
const wrap =
  (handler: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    void handler(req, res).catch(next);
  };

/** Domain matching is exact; mailbox ownership is proved separately, never by this check. */
export function isAcademicEmail(email: string): boolean {
  const valid = z.string().email().safeParse(normalize(email));
  if (!valid.success) return false;
  return allowedDomains().includes(valid.data.split('@')[1]!);
}

function cookieValue(header: string | undefined): string | null {
  const value = header
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

function safeUser(user: {
  _id: unknown;
  name: string;
  email: string;
  role: string;
  status: string;
  isDemo: boolean;
  emailVerifiedAt?: Date | null;
}): AuthUser {
  return {
    _id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role as Role,
    status: user.status,
    isDemo: user.isDemo,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
  };
}

export async function socketUser(
  redis: Redis,
  cookie: string | undefined,
): Promise<AuthContext | null> {
  const token = cookieValue(cookie);
  if (!token) return null;
  const sessionId = digest(token);
  const serialized = await redis.get(`lal:session:${sessionId}`);
  if (!serialized) return null;
  let record: { userId: string; csrfToken: string; devOnly?: boolean };
  try {
    record = JSON.parse(serialized) as typeof record;
  } catch {
    return null;
  }
  if (cfg.NODE_ENV === 'production' && record.devOnly !== false) {
    await redis.del(`lal:session:${sessionId}`);
    return null;
  }
  const user = await User.findById(record.userId).lean();
  if (!user || user.status !== 'ACTIVE' || !user.emailVerifiedAt || (user.isDemo && !demoEnabled)) {
    await redis.del(`lal:session:${sessionId}`);
    return null;
  }
  if (
    user.role === 'DRIVER' &&
    !(await DriverProfile.exists({ userId: user._id, approvedAt: { $ne: null } }))
  ) {
    await redis.del(`lal:session:${sessionId}`);
    return null;
  }
  return { user: safeUser(user), csrfToken: record.csrfToken, sessionId };
}

export function sessionMiddleware(redis: Redis): RequestHandler {
  return (req, _res, next) => {
    void socketUser(redis, req.headers.cookie)
      .then((auth) => {
        req.auth = auth;
        next();
      })
      .catch(next);
  };
}

/** Same-origin checks also cover login CSRF, including unauthenticated login endpoints. */
export const csrfProtection: RequestHandler = (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!req.path.startsWith('/api/v1/')) return next();
  if (!req.headers.origin || !cfg.origins.includes(req.headers.origin)) {
    return next(new AuthError(403, 'ORIGIN_REJECTED', 'Request origin is not permitted.'));
  }
  if (/^\/api\/v1\/auth\/(email\/(start|verify)|google|dev-login)$/.test(req.path)) return next();
  const supplied = req.headers['x-csrf-token'];
  const expected = req.auth?.csrfToken;
  if (
    typeof supplied !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(supplied) ||
    !expected ||
    supplied.length !== expected.length ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  ) {
    return next(new AuthError(403, 'CSRF_REJECTED', 'Refresh your session and try again.'));
  }
  next();
};

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) return next(new AuthError(401, 'AUTH_REQUIRED', 'Sign in to continue.'));
    if (!req.auth.user.emailVerifiedAt || req.auth.user.status !== 'ACTIVE') {
      return next(new AuthError(403, 'VERIFICATION_REQUIRED', 'Email verification is required.'));
    }
    if (!roles.includes(req.auth.user.role))
      return next(new AuthError(403, 'FORBIDDEN', 'This action is not available for your role.'));
    next();
  };
}

async function rateLimit(redis: Redis, key: string, maximum: number, seconds = 900) {
  // Atomic counter+expiry prevents immortal rate-limit keys after interrupted requests.
  const count = Number(
    await redis.eval(
      "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return n",
      1,
      `lal:auth:rate:${key}`,
      String(seconds),
    ),
  );
  if (count > maximum)
    throw new AuthError(429, 'RATE_LIMITED', 'Too many attempts. Please try again later.');
}

async function eligibleUser(user: InstanceType<typeof User> | null) {
  if (!user || user.status !== 'ACTIVE' || (user.isDemo && !demoEnabled)) {
    throw new AuthError(403, 'ACCOUNT_UNAVAILABLE', 'This account is not enabled.');
  }
  if (
    user.role === 'DRIVER' &&
    !(await DriverProfile.exists({ userId: user._id, approvedAt: { $ne: null } }))
  ) {
    throw new AuthError(
      403,
      'DRIVER_NOT_APPROVED',
      'An administrator must approve your driver account.',
    );
  }
  return user;
}

export interface AuthHooks {
  onLogout?: (sessionId: string) => void | Promise<void>;
}

export function mountAuth(app: Express, redis: Redis, hooks: AuthHooks = {}) {
  app.use('/api/v1/auth', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  async function revoke(sessionId: string) {
    await redis.del(`lal:session:${sessionId}`);
    await hooks.onLogout?.(sessionId);
  }
  async function login(req: Request, res: Response, candidate: InstanceType<typeof User> | null) {
    const user = await eligibleUser(candidate);
    if (!user.emailVerifiedAt)
      throw new AuthError(403, 'VERIFICATION_REQUIRED', 'Prove ownership of your email first.');
    // Rotate the opaque bearer credential on every successful authentication.
    if (req.auth) await revoke(req.auth.sessionId);
    const token = randomBytes(32).toString('base64url');
    const sessionId = digest(token);
    const csrfToken = randomBytes(32).toString('base64url');
    await redis.set(
      `lal:session:${sessionId}`,
      JSON.stringify({
        userId: String(user._id),
        csrfToken,
        devOnly: cfg.NODE_ENV !== 'production',
      }),
      'EX',
      TTL,
    );
    res.cookie(COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: cfg.NODE_ENV === 'production' || cfg.COOKIE_SECURE === 'true',
      path: '/',
      maxAge: TTL * 1000,
    });
    await AuditLog.create({
      actor: user._id,
      action: 'AUTH_LOGIN',
      target: String(user._id),
      metadata: { isDemo: user.isDemo },
    });
    return res.json({ user: safeUser(user), csrfToken, demoEnabled });
  }

  app.get('/api/v1/auth/me', (req, res) =>
    res.json({ user: req.auth?.user ?? null, csrfToken: req.auth?.csrfToken ?? null, demoEnabled }),
  );

  app.post(
    '/api/v1/auth/dev-login',
    wrap(async (req, res) => {
      if (!demoEnabled) throw new AuthError(404, 'NOT_FOUND', 'Not found.');
      await rateLimit(redis, `demo:${req.ip}`, Math.max(cfg.AUTH_RATE_LIMIT, 30));
      const { persona } = z
        .object({ persona: z.enum(['student', 'driver', 'admin', 'unapproved']) })
        .strict()
        .parse(req.body);
      const personas = await seedDemo();
      return login(req, res, personas[persona]);
    }),
  );

  app.post(
    '/api/v1/auth/email/start',
    wrap(async (req, res) => {
      if (cfg.NODE_ENV !== 'production' && !demoEnabled)
        throw new AuthError(
          503,
          'DEVELOPMENT_AUTH_DISABLED',
          'Enable development authentication for local email testing.',
        );
      await rateLimit(redis, `email-ip:${req.ip}`, cfg.AUTH_RATE_LIMIT);
      const { email: raw } = z
        .object({ email: z.string().trim().email().max(254) })
        .strict()
        .parse(req.body);
      const email = normalize(raw);
      await rateLimit(redis, `email:${digest(email)}`, 5);
      const existing = await User.findOne({ email });
      if (!isAcademicEmail(email) && (!existing || existing.role === 'STUDENT')) {
        throw new AuthError(
          400,
          'ACADEMIC_EMAIL_REQUIRED',
          'Use an approved Dhaka University academic email address.',
        );
      }
      if (existing) await eligibleUser(existing);
      const token = randomBytes(32).toString('base64url');
      const tokenHash = digest(token);
      const expiresAt = new Date(Date.now() + tokenTtlMs);
      // Invalidate older unused links before issuing a new one for this mailbox.
      await EmailVerificationToken.updateMany(
        { email, usedAt: null },
        { $set: { usedAt: new Date() } },
      );
      await EmailVerificationToken.create({
        email,
        tokenHash,
        expiresAt,
        developmentOnly: cfg.NODE_ENV !== 'production',
      });
      const base = process.env.PUBLIC_URL || cfg.APP_ORIGIN;
      const link = `${base.replace(/\/$/, '')}/login?token=${encodeURIComponent(token)}`;
      try {
        await deliverEmail(email, link);
      } catch (error) {
        await EmailVerificationToken.deleteOne({ tokenHash });
        if (error instanceof AuthError) throw error;
        throw new AuthError(
          503,
          'EMAIL_DELIVERY_FAILED',
          'Verification mail could not be sent. Contact the administrator.',
        );
      }
      return res
        .status(202)
        .json({ message: 'Check your mailbox for a verification link. It expires in 15 minutes.' });
    }),
  );

  app.post(
    '/api/v1/auth/email/verify',
    wrap(async (req, res) => {
      await rateLimit(redis, `verify:${req.ip}`, cfg.AUTH_RATE_LIMIT);
      const { token } = z
        .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
        .strict()
        .parse(req.body);
      const proof = await EmailVerificationToken.findOneAndUpdate(
        {
          tokenHash: digest(token),
          usedAt: null,
          expiresAt: { $gt: new Date() },
          ...(cfg.NODE_ENV === 'production' ? { developmentOnly: false } : {}),
        },
        { $set: { usedAt: new Date() } },
        { new: true },
      );
      if (!proof)
        throw new AuthError(
          400,
          'TOKEN_INVALID',
          'This verification link has expired or has already been used.',
        );
      let user = await User.findOne({ email: proof.email });
      if (!user) {
        if (!isAcademicEmail(proof.email))
          throw new AuthError(403, 'ACADEMIC_EMAIL_REQUIRED', 'Academic email is required.');
        user = await User.findOneAndUpdate(
          { email: proof.email },
          {
            $setOnInsert: {
              name: proof.email.split('@')[0],
              role: 'STUDENT',
              status: 'ACTIVE',
              isDemo: proof.developmentOnly,
            },
          },
          { upsert: true, new: true },
        );
      }
      await eligibleUser(user);
      user!.emailVerifiedAt = new Date();
      await user!.save();
      return login(req, res, user);
    }),
  );

  app.post(
    '/api/v1/auth/google',
    wrap(async (req, res) => {
      if (!cfg.GOOGLE_CLIENT_ID)
        throw new AuthError(
          503,
          'GOOGLE_NOT_CONFIGURED',
          'Google sign-in is not configured. Use email verification.',
        );
      await rateLimit(redis, `google:${req.ip}`, cfg.AUTH_RATE_LIMIT);
      const { idToken } = z
        .object({ idToken: z.string().min(20).max(10000) })
        .strict()
        .parse(req.body);
      let payload;
      try {
        const ticket = await new OAuth2Client(cfg.GOOGLE_CLIENT_ID).verifyIdToken({
          idToken,
          audience: cfg.GOOGLE_CLIENT_ID,
        });
        payload = ticket.getPayload();
      } catch {
        throw new AuthError(401, 'GOOGLE_TOKEN_INVALID', 'Google identity could not be verified.');
      }
      const workspaces = cfg.GOOGLE_WORKSPACE_DOMAINS.split(',').map(normalize).filter(Boolean);
      if (
        !payload?.email ||
        !payload.email_verified ||
        !payload.hd ||
        !isAcademicEmail(payload.email) ||
        !workspaces.includes(normalize(payload.hd))
      ) {
        throw new AuthError(
          403,
          'ACADEMIC_PROOF_REQUIRED',
          'Use email verification to prove access to your academic mailbox.',
        );
      }
      const email = normalize(payload.email);
      let user = await User.findOne({ email });
      if (user?.oauthSubject && user.oauthSubject !== payload.sub)
        throw new AuthError(403, 'IDENTITY_MISMATCH', 'The identity does not match this account.');
      if (user) await eligibleUser(user);
      user = await User.findOneAndUpdate(
        { email },
        {
          $set: { emailVerifiedAt: new Date(), oauthSubject: payload.sub },
          $setOnInsert: {
            name: payload.name ?? email.split('@')[0],
            role: 'STUDENT',
            status: 'ACTIVE',
            isDemo: false,
          },
        },
        { upsert: true, new: true },
      );
      return login(req, res, user);
    }),
  );

  app.post(
    '/api/v1/auth/logout',
    wrap(async (req, res) => {
      if (req.auth) await revoke(req.auth.sessionId);
      res.clearCookie(COOKIE, {
        httpOnly: true,
        sameSite: 'lax',
        secure: cfg.NODE_ENV === 'production' || cfg.COOKIE_SECURE === 'true',
        path: '/',
      });
      return res.json({ user: null, csrfToken: null, demoEnabled });
    }),
  );
}

async function deliverEmail(email: string, link: string) {
  const text = `Sign in to Lal Bus Tracker using this single-use link (15 minutes):\n${link}\n\nIf you did not request this email, ignore it. University mailbox ownership does not independently establish current enrollment.\n`;
  const smtpUrl = process.env.SMTP_URL;
  if (!smtpUrl && !cfg.SMTP_HOST) {
    if (cfg.NODE_ENV !== 'development')
      throw new AuthError(
        503,
        'SMTP_NOT_CONFIGURED',
        'Email delivery must be configured by the administrator.',
      );
    const directory = path.join(rootDir, '.local', 'mail');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(
      path.join(directory, `${Date.now()}-${randomBytes(4).toString('hex')}.eml`),
      `To: ${email}\nSubject: Lal Bus Tracker verification\n\n${text}`,
      { mode: 0o600 },
    );
    return;
  }
  // Parse only the documented connection fields. Passing a Nodemailer URL directly
  // permits query parameters to override security options after they are merged.
  const connection = smtpUrl ? new URL(smtpUrl) : null;
  if (
    connection &&
    (!['smtp:', 'smtps:'].includes(connection.protocol) || connection.search || connection.hash)
  ) {
    throw new AuthError(
      503,
      'SMTP_CONFIGURATION_INVALID',
      'SMTP_URL must be an smtp/smtps connection URL without query parameters.',
    );
  }
  const secure = connection ? connection.protocol === 'smtps:' : cfg.SMTP_PORT === 465;
  const smtp = nodemailer.createTransport({
    host: connection?.hostname || cfg.SMTP_HOST,
    port: connection
      ? connection.port
        ? Number(connection.port)
        : secure
          ? 465
          : 587
      : cfg.SMTP_PORT,
    secure,
    requireTLS: cfg.NODE_ENV === 'production',
    tls: { rejectUnauthorized: true },
    auth: connection?.username
      ? {
          user: decodeURIComponent(connection.username),
          pass: decodeURIComponent(connection.password),
        }
      : cfg.SMTP_USER
        ? { user: cfg.SMTP_USER, pass: cfg.SMTP_PASS }
        : undefined,
  });
  await smtp.sendMail({
    from: cfg.SMTP_FROM,
    to: email,
    subject: 'Your Lal Bus Tracker sign-in link',
    text,
  });
}
