import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pino from 'pino';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Registry, Counter, Histogram, collectDefaultMetrics } from 'prom-client';
import { z, ZodError } from 'zod';
import { objectId } from '@lal/shared';
import { cfg, demoEnabled, rootDir } from './config.js';
import { connectDatabase, createRedis } from './db.js';
import {
  sessionMiddleware,
  csrfProtection,
  mountAuth,
  requireRole,
  socketUser,
  AuthError,
} from './auth.js';
import { Bus, Route, ScheduleEntry, Trip } from './models.js';
import { mountAdmin } from './admin.js';
import { liveSnapshot, startTrip, ingestLocation, endTrip, statusSweep } from './trips.js';
import { ApiError, assert } from './errors.js';
const log = pino({
  level: cfg.LOG_LEVEL,
  redact: ['req.headers.cookie', 'req.headers.authorization', 'token', 'tokenHash', 'smtpPass'],
});
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pagination = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  search: z.string().max(100).optional(),
});
const demoFilter = () => (demoEnabled ? {} : { isDemo: false });
export async function createRuntime() {
  await connectDatabase();
  const redis = createRedis();
  redis.on('error', (error) => log.error({ err: error.message }, 'Redis error'));
  const pub = redis.duplicate(),
    sub = redis.duplicate();
  pub.on('error', (error) => log.error({ err: error.message }, 'Redis adapter publisher error'));
  sub.on('error', (error) => log.error({ err: error.message }, 'Redis adapter subscriber error'));
  try {
    await redis.connect();
    await Promise.all([pub.connect(), sub.connect()]);
  } catch (error) {
    // A failed cold start must not leave reconnecting clients or a Mongo pool
    // alive behind the platform's unavailable response.
    for (const client of [redis, pub, sub]) client.disconnect();
    await mongoose.disconnect();
    throw error;
  }
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', cfg.trustProxyHops);
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    transports: ['websocket'],
    cors: { origin: cfg.origins, credentials: true },
    maxHttpBufferSize: 16384,
    allowRequest: (req, cb) =>
      cb(null, Boolean(req.headers.origin && cfg.origins.includes(req.headers.origin))),
  });
  io.adapter(createAdapter(pub, sub));
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });
  const requests = new Counter({
    name: 'lal_http_requests_total',
    help: 'HTTP requests by route and status',
    labelNames: ['method', 'route', 'status'],
    registers: [registry],
  });
  const latency = new Histogram({
    name: 'lal_http_duration_seconds',
    help: 'Request duration',
    labelNames: ['route'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          connectSrc: ["'self'", 'wss:'],
          fontSrc: ["'self'", 'data:'],
          workerSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );
  app.use(
    cors({
      origin(origin, cb) {
        cb(null, !origin || cfg.origins.includes(origin));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
    }),
  );
  app.use(express.json({ limit: '32kb' }));
  app.use((req, res, next) => {
    const started = performance.now();
    res.on('finish', () => {
      const route = String(req.route?.path ?? 'unmatched');
      requests.inc({ method: req.method, route, status: String(res.statusCode) });
      latency.observe({ route }, (performance.now() - started) / 1000);
      if (res.statusCode >= 500)
        log.error({ method: req.method, path: req.path, status: res.statusCode }, 'Request failed');
    });
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.get('/api/v1/health/live', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/v1/health/ready', async (_req, res) => {
    try {
      assert(
        mongoose.connection.readyState === 1,
        503,
        'DATABASE_UNAVAILABLE',
        'Database disconnected',
      );
      await Promise.all([mongoose.connection.db!.admin().ping(), redis.ping()]);
      res.json({ status: 'ready', mongo: 'ok', redis: 'ok' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });
  app.use('/api/v1', sessionMiddleware(redis));
  app.use(csrfProtection);
  mountAuth(app, redis, {
    onLogout: (id) => {
      io.in(`session:${id}`).disconnectSockets(true);
    },
  });
  app.get('/api/v1/stats', async (_req, res) =>
    res.json({
      routeCount: await Route.countDocuments(),
      scheduleCount: await ScheduleEntry.countDocuments(),
      activeTripCount: await Trip.countDocuments({ status: 'ACTIVE', isDemo: false }),
      demoActiveTripCount: demoEnabled
        ? await Trip.countDocuments({ status: 'ACTIVE', isDemo: true })
        : 0,
    }),
  );
  app.get('/api/v1/routes', async (req, res) => {
    const { search, page, limit } = pagination.parse(req.query);
    const query = search
      ? {
          $or: [
            { nameBn: { $regex: escapeRegex(search), $options: 'i' } },
            { slug: { $regex: escapeRegex(search), $options: 'i' } },
            { subtitle: { $regex: escapeRegex(search), $options: 'i' } },
          ],
        }
      : {};
    const [items, total] = await Promise.all([
      Route.find(query)
        .sort({ slug: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Route.countDocuments(query),
    ]);
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({
      items: items.map((item) => ({
        ...item,
        routeGeometry: item.coordinatesVerified ? item.routeGeometry : null,
      })),
      total,
      page,
      limit,
    });
  });
  app.get('/api/v1/routes/:id', async (req, res) => {
    const id = String(req.params.id);
    const item = await Route.findOne(
      /^[a-f\d]{24}$/i.test(id)
        ? { _id: id }
        : {
            slug: z
              .string()
              .regex(/^[a-z0-9-]+$/)
              .parse(id),
          },
    ).lean();
    assert(item, 404, 'ROUTE_NOT_FOUND', 'Route not found.');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({
      item: { ...item, routeGeometry: item.coordinatesVerified ? item.routeGeometry : null },
    });
  });
  app.get('/api/v1/routes/:id/schedule', async (req, res) => {
    const id = objectId.parse(req.params.id);
    const direction = z.enum(['UP', 'DOWN']).optional().parse(req.query.direction);
    const items = await ScheduleEntry.find({ routeId: id, ...(direction ? { direction } : {}) })
      .sort({ departureTime: 1, sourceKey: 1 })
      .lean();
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({
      items,
      total: items.length,
      page: 1,
      limit: items.length,
      timezone: 'Asia/Dhaka',
      operatingDaysUnknown: items.some((s) => s.daysOfWeek === null),
    });
  });
  app.get('/api/v1/buses', async (req, res) => {
    const { search, page, limit } = pagination.parse(req.query);
    const routeId = objectId.optional().parse(req.query.routeId);
    const assigned = z.enum(['true', 'false']).optional().parse(req.query.assigned);
    const status = z
      .enum(['active', 'retired', 'LIVE', 'STALE', 'OFFLINE'])
      .optional()
      .parse(req.query.status);
    if (assigned === 'true')
      assert(req.auth?.user.role === 'DRIVER', 403, 'DRIVER_REQUIRED', 'Driver access required.');
    const query = {
      ...demoFilter(),
      ...(routeId ? { routeIds: routeId } : {}),
      ...(assigned === 'true' ? { assignedDriverIds: req.auth!.user._id } : {}),
      ...(status === 'retired' ? { active: false } : { active: true }),
      ...(search
        ? {
            $or: [
              { displayNameBn: { $regex: escapeRegex(search), $options: 'i' } },
              { displayNameEn: { $regex: escapeRegex(search), $options: 'i' } },
              { fleetNumber: { $regex: escapeRegex(search), $options: 'i' } },
              { registrationNumber: { $regex: escapeRegex(search), $options: 'i' } },
            ],
          }
        : {}),
    };
    if (status && ['LIVE', 'STALE', 'OFFLINE'].includes(status)) {
      const now = Date.now();
      const min = new Date(now - cfg.OFFLINE_AFTER_SECONDS * 1000),
        recent = new Date(now - cfg.STALE_AFTER_SECONDS * 1000);
      const activeIds = await Trip.distinct('busId', {
        status: 'ACTIVE',
        ...demoFilter(),
        ...(status === 'LIVE'
          ? { 'latestPosition.receivedAt': { $gte: recent } }
          : status === 'STALE'
            ? { 'latestPosition.receivedAt': { $lt: recent, $gte: min } }
            : { 'latestPosition.receivedAt': { $gte: min } }),
      });
      Object.assign(query, {
        _id: status === 'OFFLINE' ? { $nin: activeIds } : { $in: activeIds },
      });
    }
    const privileged = req.auth && ['DRIVER', 'ADMIN'].includes(req.auth.user.role);
    const [items, total] = await Promise.all([
      Bus.find(query)
        .select(privileged ? '' : '-assignedDriverIds')
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Bus.countDocuments(query),
    ]);
    res.json({ items, total, page, limit });
  });
  app.get('/api/v1/buses/:id', async (req, res) => {
    const id = objectId.parse(req.params.id);
    const item = await Bus.findOne({ _id: id, ...demoFilter() })
      .select(
        req.auth && ['DRIVER', 'ADMIN'].includes(req.auth.user.role) ? '' : '-assignedDriverIds',
      )
      .lean();
    assert(item, 404, 'BUS_NOT_FOUND', 'Bus not found.');
    res.json({ item });
  });
  app.get('/api/v1/buses/:id/live', requireRole('STUDENT', 'ADMIN'), async (req, res) => {
    const id = objectId.parse(req.params.id);
    const trip = await Trip.findOne({ busId: id, status: 'ACTIVE', ...demoFilter() });
    res.json({ item: trip ? await liveSnapshot(trip, redis) : null });
  });
  app.get('/api/v1/trips/active', requireRole('STUDENT', 'ADMIN'), async (req, res) => {
    const { page, limit } = pagination.parse(req.query);
    const routeId = objectId.optional().parse(req.query.routeId);
    const query = { status: 'ACTIVE', ...demoFilter(), ...(routeId ? { routeId } : {}) };
    const trips = await Trip.find(query)
      .sort({ startedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);
    res.json({
      items: await Promise.all(trips.map((trip) => liveSnapshot(trip, redis))),
      total: await Trip.countDocuments(query),
      page,
      limit,
    });
  });
  app.get('/api/v1/driver/trips/active', requireRole('DRIVER'), async (req, res) => {
    const trip = await Trip.findOne({ driverId: req.auth!.user._id, status: 'ACTIVE' });
    res.json({ item: trip ? await liveSnapshot(trip, redis) : null });
  });
  app.post('/api/v1/driver/trips/start', requireRole('DRIVER'), async (req, res) =>
    res.json({ item: await startTrip(req.auth!.user, req.body, redis, io) }),
  );
  app.post('/api/v1/driver/trips/:id/locations', requireRole('DRIVER'), async (req, res) =>
    res.json({
      item: await ingestLocation(
        req.auth!.user,
        objectId.parse(req.params.id),
        req.body,
        redis,
        io,
      ),
    }),
  );
  app.post('/api/v1/driver/trips/:id/end', requireRole('DRIVER'), async (req, res) =>
    res.json({ item: await endTrip(req.auth!.user, objectId.parse(req.params.id), redis, io) }),
  );
  mountAdmin(app, redis, io);
  app.get('/api/v1/admin/metrics', requireRole('ADMIN'), async (_req, res) =>
    res.type(registry.contentType).send(await registry.metrics()),
  );
  app.get('/api/v1/openapi', async (_req, res) => {
    try {
      res.type('application/json').send(await readFile(`${rootDir}docs/openapi.json`, 'utf8'));
    } catch {
      res.status(503).json({
        error: { code: 'DOCUMENTATION_UNAVAILABLE', message: 'OpenAPI document not available.' },
      });
    }
  });
  io.use((socket, next) => {
    void socketUser(redis, socket.handshake.headers.cookie)
      .then((auth) => {
        if (!auth || !['STUDENT', 'ADMIN'].includes(auth.user.role))
          return next(new Error('AUTH_REQUIRED'));
        socket.data.auth = auth;
        next();
      })
      .catch(next);
  });
  io.on('connection', (socket) => {
    const cookie = socket.handshake.headers.cookie;
    void redis
      .pttl(`lal:session:${socket.data.auth.sessionId}`)
      .then((ttl) => {
        if (ttl <= 0) return socket.disconnect(true);
        const expiry = setTimeout(() => socket.disconnect(true), ttl);
        expiry.unref();
        socket.once('disconnect', () => clearTimeout(expiry));
      })
      .catch(() => socket.disconnect(true));
    void socket.join(`session:${socket.data.auth.sessionId}`);
    const check = setInterval(() => {
      void socketUser(redis, cookie)
        .then((auth) => {
          if (!auth || !['STUDENT', 'ADMIN'].includes(auth.user.role)) socket.disconnect(true);
        })
        .catch(() => socket.disconnect(true));
    }, 5000);
    check.unref();
    socket.on('disconnect', () => clearInterval(check));
    let subscribing = false;
    socket.on('subscribe:trip', (payload: unknown, ack?: unknown) => {
      const reply = typeof ack === 'function' ? (ack as (result: unknown) => void) : () => {};
      if (subscribing) {
        reply({
          ok: false,
          error: { code: 'SUBSCRIBE_BUSY', message: 'Wait for the pending subscription.' },
        });
        return;
      }
      subscribing = true;
      void (async () => {
        const auth = await socketUser(redis, cookie);
        assert(
          auth && ['STUDENT', 'ADMIN'].includes(auth.user.role),
          401,
          'AUTH_REQUIRED',
          'Verified viewer session required.',
        );
        const input = z.object({ tripId: objectId }).strict().parse(payload);
        assert(
          socket.rooms.size < 10 || socket.rooms.has(`trip:${input.tripId}`),
          429,
          'SUBSCRIPTION_LIMIT',
          'Subscribe to at most eight trips.',
        );
        await socket.join(`trip:${input.tripId}`);
        const trip = await Trip.findOne({ _id: input.tripId, ...demoFilter() });
        if (!trip || trip.status !== 'ACTIVE') {
          await socket.leave(`trip:${input.tripId}`);
          throw new ApiError(
            trip ? 409 : 404,
            trip ? 'TRIP_ENDED' : 'TRIP_NOT_FOUND',
            trip ? 'Trip has ended.' : 'Trip not found.',
          );
        }
        const item = await liveSnapshot(trip, redis);
        socket.emit('trip:location', item);
        reply({ ok: true, item });
      })()
        .catch((error) => {
          reply({
            ok: false,
            error: {
              code: error instanceof ApiError ? error.code : 'SUBSCRIBE_FAILED',
              message: error instanceof ApiError ? error.message : 'Could not subscribe.',
            },
          });
        })
        .finally(() => {
          subscribing = false;
        });
    });
    socket.on('unsubscribe:trip', (payload: unknown) => {
      const input = z.object({ tripId: objectId }).safeParse(payload);
      if (input.success) void socket.leave(`trip:${input.data.tripId}`);
    });
  });
  let sweeping = false;
  const sweep = setInterval(() => {
    if (sweeping) return;
    sweeping = true;
    void redis
      .set(`lal:sweep:${Math.floor(Date.now() / 1000)}`, '1', 'EX', 3, 'NX')
      .then((leader) => (leader ? statusSweep(redis, io) : undefined))
      .catch((error) => log.error({ err: error.message }, 'Freshness sweep failed'))
      .finally(() => {
        sweeping = false;
      });
  }, 1000);
  sweep.unref();
  app.use('/api', (_req, res) =>
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API endpoint not found.' } }),
  );
  if (cfg.NODE_ENV === 'production') {
    const dist = fileURLToPath(new URL('../../web/dist/', import.meta.url));
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('/{*path}', (_req, res) => res.sendFile(`${dist}index.html`));
  }
  app.use(
    (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (error instanceof ZodError) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data.',
            issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          },
        });
        return;
      }
      if (error instanceof ApiError || error instanceof AuthError) {
        res.status(error.status).json({ error: { code: error.code, message: error.message } });
        return;
      }
      if ((error as { code?: number }).code === 11000) {
        res.status(409).json({
          error: {
            code: 'DUPLICATE_RECORD',
            message: 'A record with this unique identity already exists.',
          },
        });
        return;
      }
      if (error instanceof SyntaxError) {
        res
          .status(400)
          .json({ error: { code: 'INVALID_JSON', message: 'Invalid JSON request body.' } });
        return;
      }
      log.error(
        { err: error instanceof Error ? error.message : 'Unknown error' },
        'Unhandled API error',
      );
      res
        .status(500)
        .json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } });
    },
  );
  return {
    app,
    httpServer,
    io,
    redis,
    async close() {
      clearInterval(sweep);
      io.close();
      await new Promise<void>((resolve) => {
        if (httpServer.listening) httpServer.close(() => resolve());
        else resolve();
      });
      await Promise.all([redis.quit(), pub.quit(), sub.quit()]);
      registry.clear();
      await mongoose.disconnect();
    },
  };
}
