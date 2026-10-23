// Comparable Socket.IO broadcast/connection profile, using the real protocol.
// Run against a development trip created through an approved driver session.
import { io } from 'socket.io-client';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';

if (process.env.ACK_OWN_TARGET !== 'YES')
  throw new Error('Set ACK_OWN_TARGET=YES only for an authorized target.');
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const origin = process.env.ORIGIN || new URL(base).origin;
const viewers = Number(process.env.VUS || 5);
const duration = Number(process.env.DURATION_SECONDS || 20);
const tripId = process.env.TRIP_ID;
const cookie = process.env.SESSION_COOKIE;
const expected = Number(process.env.EXPECTED_MESSAGES || 0);
if (!tripId || !cookie)
  throw new Error(
    'TRIP_ID and SESSION_COOKIE are required; use a verified student session on the target.',
  );
if (!Number.isInteger(viewers) || viewers < 1 || viewers > 10000)
  throw new Error('VUS must be an integer in 1..10000.');
if (!Number.isFinite(duration) || duration <= 0)
  throw new Error('DURATION_SECONDS must be positive.');
if (viewers > 100 && process.env.ALLOW_LARGE_LOAD !== 'YES')
  throw new Error('Above 100 sockets requires ALLOW_LARGE_LOAD=YES.');
const sockets = [];
const connectMs = [];
const deliveryMs = [];
const messageCounts = new Map();
const lastVersion = new Map();
let connected = 0,
  subscribed = 0,
  connectionErrors = 0,
  subscriptionErrors = 0,
  regressions = 0,
  unexpectedDisconnects = 0;
const loop = monitorEventLoopDelay({ resolution: 20 });
loop.enable();
const started = Date.now();
for (let i = 0; i < viewers; i++) {
  const connectStart = Date.now();
  const socket = io(base, {
    transports: ['websocket'],
    reconnection: false,
    timeout: 10000,
    extraHeaders: { Cookie: cookie, Origin: origin },
  });
  sockets.push(socket);
  messageCounts.set(i, 0);
  socket.on('connect', () => {
    connected++;
    connectMs.push(Date.now() - connectStart);
    socket.timeout(10000).emit('subscribe:trip', { tripId }, (error, ack) => {
      if (error || !ack?.ok) subscriptionErrors++;
      else subscribed++;
    });
  });
  socket.on('connect_error', () => connectionErrors++);
  socket.on('disconnect', (reason) => {
    if (reason !== 'io client disconnect') unexpectedDisconnects++;
  });
  socket.on('trip:location', (payload) => {
    const trip = payload?.item || payload;
    if (!trip?.latestPosition) return; // Empty initial snapshots do not count as GPS delivery.
    if (lastVersion.get(i) === trip.version) return; // Reconnect snapshot / duplicate.
    if (lastVersion.has(i) && trip.version < lastVersion.get(i)) regressions++;
    lastVersion.set(i, trip.version);
    messageCounts.set(i, messageCounts.get(i) + 1);
    const receivedAt = Date.parse(trip.latestPosition.receivedAt);
    if (Number.isFinite(receivedAt)) deliveryMs.push(Math.max(0, Date.now() - receivedAt));
  });
  // Avoid one-tick connection storms; this is connection capacity, not SYN testing.
  if (i % 25 === 24)
    await new Promise((r) => setTimeout(r, Number(process.env.BATCH_DELAY_MS || 100)));
}
await new Promise((r) => setTimeout(r, duration * 1000));
sockets.forEach((socket) => socket.disconnect());
loop.disable();
function percentiles(values) {
  values.sort((a, b) => a - b);
  const p = (fraction) =>
    values.length
      ? values[Math.min(values.length - 1, Math.floor(values.length * fraction))]
      : null;
  return { count: values.length, p50: p(0.5), p95: p(0.95), p99: p(0.99) };
}
const counts = [...messageCounts.values()];
const missing = expected
  ? counts.reduce((sum, count) => sum + Math.max(0, expected - count), 0)
  : null;
const report = {
  startedAt: new Date(started).toISOString(),
  durationSeconds: (Date.now() - started) / 1000,
  viewersRequested: viewers,
  connected,
  subscribed,
  connectionErrors,
  subscriptionErrors,
  unexpectedDisconnects,
  regressions,
  connectionSuccessRate: connected / viewers,
  connectionMs: percentiles(connectMs),
  deliveryMs: percentiles(deliveryMs),
  deliveredPerViewer: { min: Math.min(...counts), max: Math.max(...counts) },
  expectedMessagesPerViewer: expected || null,
  missingMessages: missing,
  measurementScope: expected
    ? 'connections_and_expected_broadcasts'
    : 'connections_only_broadcast_loss_unmeasured',
  note: expected
    ? 'Publish exactly EXPECTED_MESSAGES distinct versions during this window.'
    : 'No expected message count supplied: missing/dropped messages are unmeasured.',
  generator: {
    rssBytes: process.memoryUsage().rss,
    cpuUsageMicroseconds: process.cpuUsage(),
    eventLoopP99Ms: loop.percentile(99) / 1e6,
  },
};
report.passed =
  subscribed === viewers &&
  connectionErrors === 0 &&
  subscriptionErrors === 0 &&
  unexpectedDisconnects === 0 &&
  regressions === 0 &&
  (missing === null || missing === 0);
await writeFile(
  process.env.REPORT_PATH || 'load-sockets-summary.json',
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
