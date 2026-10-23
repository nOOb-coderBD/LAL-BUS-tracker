import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';

// Real isolated services; never point these tests at a deployment or production database.
Object.assign(process.env, {
  NODE_ENV: 'development',
  ALLOW_DEMO_AUTH: 'true',
  MONGODB_URI: process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/lal_bus_test',
  REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/15',
  APP_ORIGIN: 'http://localhost:5173',
  ALLOWED_ORIGINS: 'http://localhost:5173',
  STALE_AFTER_SECONDS: '1',
  OFFLINE_AFTER_SECONDS: '2',
  AUTH_RATE_LIMIT: '500',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '1025',
  SMTP_FROM: 'test@example.invalid',
  LOG_LEVEL: 'silent',
});
const { createRuntime } = await import('../../apps/api/src/app.js');
const { migrate, connectDatabase } = await import('../../apps/api/src/db.js');
const { importSeed, seedDemo } = await import('../../apps/api/src/seed.js');
const {
  User,
  Bus,
  Route,
  Trip,
  ScheduleEntry,
  DriverProfile,
  EmailVerificationToken,
  LocationSample,
} = await import('../../apps/api/src/models.js');
const mongoose = (await import('mongoose')).default;
let runtime: Awaited<ReturnType<typeof createRuntime>>;
let base: string;
let fixtures: Awaited<ReturnType<typeof seedDemo>>;
const origin = 'http://localhost:5173';
const sockets: Socket[] = [];
type Session = { cookie: string; csrf: string; user: any };
async function request(
  path: string,
  method = 'GET',
  body?: unknown,
  session?: Session,
  headers: Record<string, string> = {},
) {
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  return { res, data };
}
async function login(persona: string): Promise<Session> {
  const { res, data } = await request('/auth/dev-login', 'POST', { persona });
  assert.equal(res.status, 200, JSON.stringify(data));
  return {
    cookie: res.headers.get('set-cookie')!.split(';')[0],
    csrf: data.csrfToken,
    user: data.user,
  };
}
async function subscribe(session: Session, id: string) {
  const socket = io(base, {
    transports: ['websocket'],
    extraHeaders: { Cookie: session.cookie, Origin: origin },
    reconnection: false,
    timeout: 3000,
  });
  sockets.push(socket);
  await Promise.race([
    once(socket, 'connect'),
    once(socket, 'connect_error').then(([e]) => {
      throw e;
    }),
  ]);
  const ack = await new Promise<any>((resolve, reject) =>
    socket
      .timeout(3000)
      .emit('subscribe:trip', { tripId: id }, (err: any, result: any) =>
        err ? reject(err) : resolve(result),
      ),
  );
  return { socket, ack };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const point = () => ({
  eventId: randomUUID(),
  latitude: 23.727,
  longitude: 90.402,
  accuracy: 8,
  observedAt: new Date().toISOString(),
  simulated: true,
});
before(async () => {
  await connectDatabase();
  await mongoose.connection.dropDatabase();
  await migrate();
  runtime = await createRuntime();
  await new Promise<void>((r) => runtime.httpServer.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(runtime.httpServer.address() as any).port}`;
  await importSeed({ writeReport: false });
  fixtures = await seedDemo();
});
after(async () => {
  for (const socket of sockets) socket.disconnect();
  if (runtime) await runtime.close();
});

test('readiness depends on real MongoDB/Redis; exact idempotent source import preserves duplicates and reviews', async () => {
  assert.equal((await request('/health/ready')).res.status, 200);
  const report = await importSeed({ writeReport: false });
  assert.equal(report.routeCount, 17);
  assert.equal(report.scheduleCount, 205);
  assert.equal(await Route.countDocuments(), 17);
  assert.equal(await ScheduleEntry.countDocuments(), 205);
  const route = await Route.findOne({ slug: 'choitali' });
  assert.equal(
    await ScheduleEntry.countDocuments({
      routeId: route!._id,
      direction: 'UP',
      departureTime: '07:10',
    }),
    2,
  );
  assert.equal(await Route.countDocuments({ routeGeometry: { $ne: null } }), 0);
  assert.equal(await ScheduleEntry.countDocuments({ daysOfWeek: { $ne: null } }), 0);
  assert.equal(fixtures.bus.fleetNumber, null);
  await Route.updateOne({ _id: route!._id }, { $set: { status: 'VERIFIED', slug: 'choitali-admin-edited' } });
  await importSeed({ writeReport: false });
  assert.equal((await Route.findById(route!._id))!.status, 'VERIFIED');
  assert.equal((await Route.findById(route!._id))!.slug, 'choitali-admin-edited');
  assert.equal(await Route.countDocuments(), 17);
  const list = await request('/routes?limit=100');
  assert.equal(list.data.total, 17);
});

test('academic login requires actual single-use mailbox proof; invalid/expired links and lookalikes rejected', async () => {
  for (const email of ['a@gmail.com', 'a@student.du.ac.bd.evil.com', 'a@unknown.du.ac.bd']) {
    assert.equal((await request('/auth/email/start', 'POST', { email })).res.status, 400);
  }
  const email = 'integration.student@student.du.ac.bd';
  const start = await request('/auth/email/start', 'POST', { email });
  assert.equal(start.res.status, 202, JSON.stringify(start.data));
  assert.equal(start.data.token, undefined);
  assert.equal(await User.exists({ email }), null);
  const inbox = await (await fetch('http://127.0.0.1:8025/api/v1/messages')).json();
  const item = inbox.messages.find((m: any) => m.To?.some((a: any) => a.Address === email));
  assert.ok(item, 'Mailpit must receive actual SMTP message');
  const mail = await (await fetch(`http://127.0.0.1:8025/api/v1/message/${item.ID}`)).json();
  const token = mail.Text.match(/token=([A-Za-z0-9_-]{43})/)?.[1];
  assert.ok(token);
  const verified = await request('/auth/email/verify', 'POST', { token });
  assert.equal(verified.res.status, 200, JSON.stringify(verified.data));
  assert.equal(verified.data.user.role, 'STUDENT');
  assert.ok(verified.data.user.emailVerifiedAt);
  assert.equal((await request('/auth/email/verify', 'POST', { token })).res.status, 400);
  const expired = 'X'.repeat(43);
  await EmailVerificationToken.create({
    email,
    tokenHash: createHash('sha256').update(expired).digest('hex'),
    expiresAt: new Date(Date.now() - 1000),
  });
  assert.equal((await request('/auth/email/verify', 'POST', { token: expired })).res.status, 400);
  for (let i = 0; i < 5; i++)
    await request('/auth/email/start', 'POST', { email: 'rate@student.du.ac.bd' });
  assert.equal(
    (await request('/auth/email/start', 'POST', { email: 'rate@student.du.ac.bd' })).res.status,
    429,
  );
});

test('authorization, origin/CSRF defenses and unapproved driver login are enforced server-side', async () => {
  assert.equal((await request('/trips/active')).res.status, 401);
  assert.equal(
    (
      await request('/auth/dev-login', 'POST', { persona: 'student' }, undefined, {
        Origin: 'https://evil.invalid',
      })
    ).res.status,
    403,
  );
  assert.equal(
    (await request('/auth/dev-login', 'POST', { persona: 'unapproved' })).res.status,
    403,
  );
  const student = await login('student');
  assert.equal((await request('/admin/drivers', 'GET', undefined, student)).res.status, 403);
  assert.equal(
    (
      await request(
        '/driver/trips/start',
        'POST',
        {
          busId: String(fixtures.bus._id),
          routeId: String(fixtures.bus.routeIds[0]),
          direction: 'UP',
        },
        student,
      )
    ).res.status,
    403,
  );
  assert.equal(
    (await request('/auth/logout', 'POST', {}, student, { 'X-CSRF-Token': 'invalid' })).res.status,
    403,
  );
});

test('approved driver -> actual database GPS -> student Socket.IO -> stale/offline -> reconnect -> end privacy', async () => {
  const driver = await login('driver'),
    student = await login('student'),
    admin = await login('admin');
  const startBody = {
    busId: String(fixtures.bus._id),
    routeId: String(fixtures.bus.routeIds[0]),
    direction: 'UP',
  };
  const starts = await Promise.all([
    request('/driver/trips/start', 'POST', startBody, driver),
    request('/driver/trips/start', 'POST', startBody, driver),
  ]);
  assert.ok(
    starts.every((s) => [200, 201].includes(s.res.status)),
    JSON.stringify(starts.map((s) => s.data)),
  );
  assert.equal(starts[0].data.item._id, starts[1].data.item._id);
  const trip = starts[0].data.item;
  assert.equal(await Trip.countDocuments({ status: 'ACTIVE', busId: fixtures.bus._id }), 1);
  const secondBus = await Bus.create({
    displayNameBn: 'TEST ONLY',
    active: true,
    approved: true,
    isDemo: true,
    routeIds: fixtures.bus.routeIds,
    assignedDriverIds: [fixtures.driver._id],
  });
  await DriverProfile.updateOne(
    { userId: fixtures.driver._id },
    { $addToSet: { allowedBusIds: secondBus._id } },
  );
  assert.equal(
    (
      await request(
        '/driver/trips/start',
        'POST',
        { ...startBody, busId: String(secondBus._id) },
        driver,
      )
    ).res.status,
    409,
  );
  const { socket, ack } = await subscribe(student, trip._id);
  assert.equal(ack.ok, true, JSON.stringify(ack));
  const update = point();
  assert.equal(
    (await request(`/driver/trips/${trip._id}/locations`, 'POST', update, student)).res.status,
    403,
  );
  const incoming = once(socket, 'trip:location');
  const ingest = await request(`/driver/trips/${trip._id}/locations`, 'POST', update, driver);
  assert.equal(ingest.res.status, 200, JSON.stringify(ingest.data));
  const [broadcast] = await incoming;
  assert.equal(broadcast.latestPosition.latitude, update.latitude);
  assert.equal(broadcast.latestPosition.longitude, update.longitude);
  assert.equal(broadcast.latestPosition.simulated, true);
  const live = await request(`/buses/${startBody.busId}/live`, 'GET', undefined, student);
  assert.equal(live.data.item.latestPosition.latitude, update.latitude);
  assert.ok(await LocationSample.exists({ tripId: trip._id }));
  const duplicate = await request(`/driver/trips/${trip._id}/locations`, 'POST', update, driver);
  assert.equal(duplicate.res.status, 200);
  await sleep(1100);
  const older = { ...point(), observedAt: new Date(Date.now() - 10000).toISOString() };
  const outOfOrder = await request(`/driver/trips/${trip._id}/locations`, 'POST', older, driver);
  assert.ok([400, 409, 422].includes(outOfOrder.res.status), JSON.stringify(outOfOrder.data));
  assert.equal(
    (await request(`/buses/${startBody.busId}/live`, 'GET', undefined, student)).data.item
      .freshness,
    'STALE',
  );
  await sleep(1100);
  assert.equal(
    (await request(`/buses/${startBody.busId}/live`, 'GET', undefined, student)).data.item
      .freshness,
    'OFFLINE',
  );
  const reconnected = await subscribe(student, trip._id);
  assert.equal(reconnected.ack.ok, true);
  assert.equal(reconnected.ack.item.latestPosition.observedAt, update.observedAt);
  const second = point();
  const secondIngest = await request(`/driver/trips/${trip._id}/locations`, 'POST', second, driver);
  assert.equal(secondIngest.res.status, 200, JSON.stringify(secondIngest.data));
  assert.equal(
    (await request(`/buses/${startBody.busId}/live`, 'GET', undefined, student)).data.item
      .freshness,
    'LIVE',
  );
  // Existing session loses write access after approval is revoked.
  await DriverProfile.updateOne({ userId: fixtures.driver._id }, { $set: { approvedAt: null } });
  assert.ok(
    [401, 403].includes(
      (await request(`/driver/trips/${trip._id}/end`, 'POST', {}, driver)).res.status,
    ),
  );
  await DriverProfile.updateOne(
    { userId: fixtures.driver._id },
    { $set: { approvedAt: new Date() } },
  );
  const newDriver = await login('driver');
  const endedEvent = once(socket, 'trip:ended');
  const end = await request(`/driver/trips/${trip._id}/end`, 'POST', {}, newDriver);
  assert.equal(end.res.status, 200, JSON.stringify(end.data));
  const [ended] = await endedEvent;
  assert.equal(ended.latestPosition, null);
  assert.equal(
    (await request(`/driver/trips/${trip._id}/end`, 'POST', {}, newDriver)).res.status,
    200,
  );
  assert.equal(await Trip.countDocuments({ status: 'ACTIVE', busId: fixtures.bus._id }), 0);
  assert.equal(
    (await request('/trips/active', 'GET', undefined, student)).data.items.some(
      (t: any) => t._id === trip._id,
    ),
    false,
  );
  const endedLive = await request(`/buses/${startBody.busId}/live`, 'GET', undefined, student);
  assert.equal(endedLive.data.item, null);
  assert.ok(
    [400, 409].includes(
      (await request(`/driver/trips/${trip._id}/locations`, 'POST', point(), newDriver)).res.status,
    ),
  );
  const logoutEvent = once(socket, 'disconnect');
  assert.equal((await request('/auth/logout', 'POST', {}, student)).res.status, 200);
  await logoutEvent;
  assert.equal((await request('/trips/active', 'GET', undefined, student)).res.status, 401);
  const audit = await request('/admin/audit', 'GET', undefined, admin);
  assert.equal(audit.res.status, 200);
  assert.ok(audit.data.items.length > 0);
});

test('unassigned bus and different-driver end requests cannot control another trip', async () => {
  const driver = await login('driver');
  const bus = await Bus.create({
    displayNameBn: 'TEST unassigned ONLY',
    isDemo: true,
    active: true,
    approved: true,
    routeIds: fixtures.bus.routeIds,
  });
  assert.equal(
    (
      await request(
        '/driver/trips/start',
        'POST',
        { busId: String(bus._id), routeId: String(fixtures.bus.routeIds[0]), direction: 'UP' },
        driver,
      )
    ).res.status,
    403,
  );
  const other = await User.create({
    name: 'Other test driver',
    email: 'other.test@demo.invalid',
    role: 'DRIVER',
    emailVerifiedAt: new Date(),
    isDemo: true,
  });
  await DriverProfile.create({
    userId: other._id,
    driverIdentifier: 'test-other-driver',
    approvedAt: new Date(),
    allowedBusIds: [fixtures.bus._id],
  });
  const trip = await Trip.create({
    busId: fixtures.bus._id,
    routeId: fixtures.bus.routeIds[0],
    driverId: other._id,
    direction: 'UP',
    isDemo: true,
  });
  assert.equal(
    (await request(`/driver/trips/${trip._id}/end`, 'POST', {}, driver)).res.status,
    403,
  );
  await Trip.updateOne({ _id: trip._id }, { $set: { status: 'ENDED', endedAt: new Date() } });
});

// These sessions are explicit test fixtures in the isolated Redis DB. Production
// authentication cannot create them without the real mailbox-proof flow.
async function fixtureSession(user: any, ttlSeconds = 60): Promise<Session> {
  const token = createHash('sha256').update(randomUUID()).digest('base64url');
  const csrf = createHash('sha256').update(randomUUID()).digest('base64url');
  const sessionId = createHash('sha256').update(token).digest('hex');
  await runtime.redis.set(
    `lal:session:${sessionId}`,
    JSON.stringify({ userId: String(user._id), csrfToken: csrf, devOnly: true }),
    'EX',
    ttlSeconds,
  );
  return { cookie: `lal_session=${token}`, csrf, user };
}

test(
  'malformed Socket.IO acknowledgement arguments cannot crash the API',
  { timeout: 10000 },
  async () => {
    const driver = await login('driver'),
      student = await login('student');
    const started = await request(
      '/driver/trips/start',
      'POST',
      {
        busId: String(fixtures.bus._id),
        routeId: String(fixtures.bus.routeIds[0]),
        direction: 'UP',
      },
      driver,
    );
    assert.equal(started.res.status, 200, JSON.stringify(started.data));
    const tripId = started.data.item._id;
    try {
      const { socket, ack } = await subscribe(student, tripId);
      assert.equal(ack.ok, true);
      socket.emit('subscribe:trip', { tripId }, 'not-an-acknowledgement-function');
      await sleep(100);
      socket.emit(
        'subscribe:trip',
        { tripId: 'invalid' },
        { unexpected: 'object instead of function' },
      );
      await sleep(100);
      assert.equal((await request('/health/ready')).res.status, 200);
      assert.equal(socket.connected, true);
      const normalAck = await new Promise<any>((resolve, reject) =>
        socket
          .timeout(3000)
          .emit('subscribe:trip', { tripId }, (error: any, result: any) =>
            error ? reject(error) : resolve(result),
          ),
      );
      assert.equal(normalAck.ok, true);
    } finally {
      await request(`/driver/trips/${tripId}/end`, 'POST', {}, driver);
    }
  },
);

test(
  'two approved assigned drivers cannot start simultaneous trips on the same bus',
  { timeout: 10000 },
  async () => {
    const driver = await login('driver');
    const other = await User.create({
      name: 'Second approved fixture driver',
      email: 'same-bus.test@demo.invalid',
      role: 'DRIVER',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      isDemo: true,
    });
    await DriverProfile.create({
      userId: other._id,
      driverIdentifier: 'same-bus-driver',
      approvedAt: new Date(),
      allowedBusIds: [fixtures.bus._id],
    });
    await Bus.updateOne({ _id: fixtures.bus._id }, { $addToSet: { assignedDriverIds: other._id } });
    const second = await fixtureSession(other);
    const input = {
      busId: String(fixtures.bus._id),
      routeId: String(fixtures.bus.routeIds[0]),
      direction: 'UP',
    };
    const results = await Promise.all([
      request('/driver/trips/start', 'POST', input, driver),
      request('/driver/trips/start', 'POST', input, second),
    ]);
    assert.deepEqual(
      results.map((result) => result.res.status).sort((a, b) => a - b),
      [200, 409],
      JSON.stringify(results.map((result) => result.data)),
    );
    const winner = results[0].res.status === 200 ? 0 : 1;
    assert.equal(await Trip.countDocuments({ busId: fixtures.bus._id, status: 'ACTIVE' }), 1);
    assert.equal(
      (
        await request(
          `/driver/trips/${results[winner].data.item._id}/end`,
          'POST',
          {},
          winner === 0 ? driver : second,
        )
      ).res.status,
      200,
    );
    await Bus.updateOne({ _id: fixtures.bus._id }, { $pull: { assignedDriverIds: other._id } });
  },
);

test(
  'expired Redis sessions deny subscriptions on existing sockets and disconnect them',
  { timeout: 10000 },
  async () => {
    const driver = await login('driver');
    const started = await request(
      '/driver/trips/start',
      'POST',
      {
        busId: String(fixtures.bus._id),
        routeId: String(fixtures.bus.routeIds[0]),
        direction: 'UP',
      },
      driver,
    );
    assert.equal(started.res.status, 200, JSON.stringify(started.data));
    const tripId = started.data.item._id;
    try {
      const student = await fixtureSession(fixtures.student, 60);
      const { socket, ack } = await subscribe(student, tripId);
      assert.equal(ack.ok, true);
      const token = student.cookie.slice('lal_session='.length);
      const sessionId = createHash('sha256').update(token).digest('hex');
      await runtime.redis.pexpire(`lal:session:${sessionId}`, 1);
      await sleep(25);
      const denied = await new Promise<any>((resolve, reject) =>
        socket
          .timeout(3000)
          .emit('subscribe:trip', { tripId }, (error: any, result: any) =>
            error ? reject(error) : resolve(result),
          ),
      );
      assert.equal(denied.ok, false);
      assert.equal((await request('/trips/active', 'GET', undefined, student)).res.status, 401);
      if (socket.connected)
        await Promise.race([
          once(socket, 'disconnect'),
          sleep(6000).then(() => {
            throw new Error('Expired viewer socket was not disconnected');
          }),
        ]);
      assert.equal(socket.connected, false);
    } finally {
      await request(`/driver/trips/${tripId}/end`, 'POST', {}, driver);
    }
  },
);

test('admin CRUD uses validated Mongo records, preserves unknown fields, and rejects orphan deletion', async () => {
  const admin = await login('admin');
  const routeResponse = await request(
    '/admin/routes',
    'POST',
    { slug: 'integration-admin-only', nameBn: 'Integration fixture only' },
    admin,
  );
  assert.equal(routeResponse.res.status, 201, JSON.stringify(routeResponse.data));
  const route = routeResponse.data.item;
  assert.equal(route.routeGeometry, null);
  assert.equal(route.status, 'NEEDS_ADMIN_VERIFICATION');
  const busResponse = await request(
    '/admin/buses',
    'POST',
    {
      displayNameBn: 'Isolated integration fixture',
      routeIds: [route._id],
      assignedDriverIds: [],
      approved: false,
    },
    admin,
  );
  assert.equal(busResponse.res.status, 201, JSON.stringify(busResponse.data));
  const bus = busResponse.data.item;
  assert.equal(bus.fleetNumber, null);
  assert.equal(bus.registrationNumber, null);
  const scheduleResponse = await request(
    '/admin/schedules',
    'POST',
    {
      routeId: route._id,
      direction: 'DOWN',
      departureTime: '13:35',
      busId: bus._id,
      isStaffOnly: true,
    },
    admin,
  );
  assert.equal(scheduleResponse.res.status, 201, JSON.stringify(scheduleResponse.data));
  const schedule = scheduleResponse.data.item;
  assert.equal(schedule.daysOfWeek, null);
  assert.equal(
    (await request(`/admin/routes/${route._id}`, 'DELETE', undefined, admin)).res.status,
    409,
  );
  assert.equal(
    (await request(`/admin/buses/${bus._id}`, 'DELETE', undefined, admin)).res.status,
    409,
  );
  const edit = await request(
    `/admin/schedules/${schedule._id}`,
    'PATCH',
    { departureTime: '14:00', daysOfWeek: [1, 3], status: 'VERIFIED' },
    admin,
  );
  assert.equal(edit.res.status, 200);
  assert.equal(edit.data.item.departureTime, '14:00');
  assert.deepEqual(edit.data.item.daysOfWeek, [1, 3]);
  assert.equal(
    (await request(`/admin/buses/${bus._id}`, 'PATCH', { role: 'ADMIN' }, admin)).res.status,
    400,
  );
  assert.equal(
    (await request(`/admin/schedules/${schedule._id}`, 'DELETE', undefined, admin)).res.status,
    200,
  );
  assert.equal(
    (await request(`/admin/buses/${bus._id}`, 'DELETE', undefined, admin)).res.status,
    200,
  );
  assert.equal(
    (await request(`/admin/routes/${route._id}`, 'DELETE', undefined, admin)).res.status,
    200,
  );
});
