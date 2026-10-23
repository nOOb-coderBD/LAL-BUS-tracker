/** Synthetic development-only transport test. Never represents an observed vehicle. */
import { randomUUID } from 'node:crypto';
const base = process.env.BASE_URL ?? 'http://localhost:4000';
const origin = process.env.APP_ORIGIN ?? 'http://localhost:5173';
if (process.env.SIMULATION_ACK !== 'true')
  throw new Error(
    'Set SIMULATION_ACK=true. This sends labelled synthetic GPS for DEVELOPMENT ONLY; no physical vehicle is represented.',
  );
let cookie = '',
  csrf = '',
  tripId = '';
async function call(path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie, 'X-CSRF-Token': csrf } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(data)}`);
  if (res.headers.get('set-cookie')) cookie = res.headers.get('set-cookie')!.split(';')[0];
  if (data.csrfToken) csrf = data.csrfToken;
  return data;
}
let stopped = false;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    stopped = true;
  });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
try {
  const session = await call('/auth/dev-login', 'POST', { persona: 'driver' });
  if (!session.demoEnabled || !session.user?.isDemo)
    throw new Error('Server did not authorize development simulation');
  const buses = await call('/buses?assigned=true&limit=100');
  const bus = buses.items.find((b: any) => b.isDemo);
  if (!bus) throw new Error('Run npm run db:demo first. No labelled simulator bus is assigned.');
  const started = await call('/driver/trips/start', 'POST', {
    busId: bus._id,
    routeId: bus.routeIds[0],
    direction: 'UP',
  });
  tripId = started.item._id;
  console.log(
    `SYNTHETIC DEVELOPMENT TRIP ${tripId}. Open student Live map. Ctrl+C ends this trip.`,
  );
  // Explicit arbitrary synthetic test path in Dhaka area; NOT a surveyed campus route.
  const path = [
    [23.727, 90.402],
    [23.72705, 90.40205],
    [23.7271, 90.4021],
    [23.72715, 90.40215],
    [23.7271, 90.4021],
    [23.72705, 90.40205],
  ];
  const count = Number(process.env.SAMPLES ?? 12);
  for (let i = 0; i < count && !stopped; i++) {
    const [latitude, longitude] = path[i % path.length];
    await call(`/driver/trips/${tripId}/locations`, 'POST', {
      eventId: randomUUID(),
      latitude,
      longitude,
      accuracy: 10,
      observedAt: new Date().toISOString(),
      simulated: true,
    });
    console.log(`Synthetic sample ${i + 1}/${count} accepted; not real GPS.`);
    if (i < count - 1) await sleep(6000);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  if (tripId)
    try {
      await call(`/driver/trips/${tripId}/end`, 'POST', {});
      console.log('Synthetic trip ended; live visibility cleared.');
    } catch {
      console.error('Could not end trip. Use driver/admin dashboard to end it.');
      process.exitCode = 1;
    }
}
