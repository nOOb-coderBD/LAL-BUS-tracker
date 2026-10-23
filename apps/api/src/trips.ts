import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { Server } from 'socket.io';
import {
  freshness,
  locationInput,
  tripStartInput,
  objectId,
  type LocationInput,
} from '@lal/shared';
import {
  Bus,
  DriverProfile,
  Trip,
  Route,
  ScheduleEntry,
  LocationSample,
  AuditLog,
} from './models.js';
import { cfg, demoEnabled } from './config.js';
import { ApiError, assert } from './errors.js';
type UserContext = { _id: string; role: string; isDemo?: boolean };
export function liveDTO(trip: InstanceType<typeof Trip> | Record<string, unknown>) {
  const t = 'toObject' in trip && typeof trip.toObject === 'function' ? trip.toObject() : trip;
  const item = t as Record<string, unknown>;
  const position = item.latestPosition as {
    latitude?: number;
    longitude?: number;
    accuracy?: number | null;
    heading?: number | null;
    speed?: number | null;
    observedAt?: Date;
    receivedAt?: Date;
    simulated?: boolean;
  } | null;
  const latestPosition =
    item.status === 'ACTIVE' && position
      ? {
          latitude: position.latitude,
          longitude: position.longitude,
          accuracy: position.accuracy ?? null,
          heading: position.heading ?? null,
          speed: position.speed ?? null,
          observedAt: position.observedAt,
          receivedAt: position.receivedAt,
          simulated: Boolean(position.simulated),
        }
      : null;
  return {
    _id: item._id,
    busId: item.busId,
    routeId: item.routeId,
    direction: item.direction,
    status: item.status,
    startedAt: item.startedAt,
    endedAt: item.endedAt,
    scheduleEntryId: item.scheduleEntryId,
    isDemo: item.isDemo,
    version: item.version,
    latestPosition,
    freshness: freshness(
      String(item.status),
      position?.receivedAt,
      Date.now(),
      cfg.STALE_AFTER_SECONDS * 1000,
      cfg.OFFLINE_AFTER_SECONDS * 1000,
    ),
  };
}
/** Mongo trip lifecycle/version is authoritative; Redis supplies a matching latest-value projection. */
export async function liveSnapshot(trip: InstanceType<typeof Trip>, redis: Redis) {
  const cached = await redis.get(`lal:latest:${trip._id}`);
  if (cached && trip.status === 'ACTIVE') {
    try {
      const dto = JSON.parse(cached) as Record<string, unknown>;
      if (dto.version === trip.version && String(dto._id) === String(trip._id)) return liveDTO(dto);
    } catch {
      /* Invalid cache entry falls back to persisted current trip. */
    }
  }
  return liveDTO(trip);
}
async function withLock<T>(redis: Redis, id: string, fn: () => Promise<T>): Promise<T> {
  const key = `lal:trip-lock:${id}`,
    token = randomUUID();
  assert(
    await redis.set(key, token, 'EX', 15, 'NX'),
    409,
    'TRIP_BUSY',
    'Another trip update is processing. Retry shortly.',
  );
  try {
    return await fn();
  } finally {
    await redis.eval(
      "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
      1,
      key,
      token,
    );
  }
}
export async function assertAssignment(user: UserContext, busId: string) {
  const [profile, bus] = await Promise.all([
    DriverProfile.findOne({ userId: user._id }),
    Bus.findById(busId),
  ]);
  assert(profile?.approvedAt, 403, 'DRIVER_UNAPPROVED', 'Administrator approval required.');
  assert(
    bus?.active && bus.approved,
    403,
    'BUS_UNAPPROVED',
    'An active approved physical bus assignment is required.',
  );
  assert(
    profile.allowedBusIds.some((id) => String(id) === busId) &&
      bus.assignedDriverIds.some((id) => String(id) === user._id),
    403,
    'BUS_UNASSIGNED',
    'This bus is not assigned to you.',
  );
  assert(
    !bus.isDemo || demoEnabled,
    403,
    'SIMULATOR_DISABLED',
    'Development vehicles are unavailable.',
  );
  return { bus, profile };
}
export async function startTrip(user: UserContext, raw: unknown, redis: Redis, io: Server) {
  const input = tripStartInput.parse(raw);
  const { bus } = await assertAssignment(user, input.busId);
  assert(
    bus.routeIds.some((id) => String(id) === input.routeId),
    403,
    'ROUTE_UNASSIGNED',
    'This route is not assigned to the bus.',
  );
  const route = await Route.findById(input.routeId);
  assert(route, 404, 'ROUTE_NOT_FOUND', 'Route not found.');
  if (!demoEnabled)
    assert(
      route.status === 'VERIFIED',
      409,
      'ROUTE_UNVERIFIED',
      'Verify this route before starting a production trip.',
    );
  if (input.scheduleEntryId) {
    const s = await ScheduleEntry.findById(input.scheduleEntryId);
    assert(
      s && String(s.routeId) === input.routeId && s.direction === input.direction,
      400,
      'SCHEDULE_MISMATCH',
      'Schedule must match trip route and direction.',
    );
    assert(
      !s.busId || String(s.busId) === input.busId,
      400,
      'SCHEDULE_MISMATCH',
      'Schedule belongs to another bus.',
    );
    assert(
      !s.isStaffOnly,
      403,
      'STAFF_SERVICE',
      'Staff-only schedules cannot be shared with students.',
    );
  }
  const existing = await Trip.findOne({ driverId: user._id, status: 'ACTIVE' });
  if (existing) {
    assert(
      String(existing.busId) === input.busId &&
        String(existing.routeId) === input.routeId &&
        existing.direction === input.direction,
      409,
      'DRIVER_ALREADY_ACTIVE',
      'End your existing trip first.',
    );
    return liveDTO(existing);
  }
  let trip: InstanceType<typeof Trip>;
  try {
    trip = await Trip.create({
      ...input,
      driverId: user._id,
      isDemo: bus.isDemo,
      status: 'ACTIVE',
      startedAt: new Date(),
    });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      const own = await Trip.findOne({ driverId: user._id, status: 'ACTIVE' });
      if (
        own &&
        String(own.busId) === input.busId &&
        String(own.routeId) === input.routeId &&
        own.direction === input.direction
      )
        return liveDTO(own);
      throw new ApiError(409, 'TRIP_CONFLICT', 'This driver or bus already has an active trip.');
    }
    throw error;
  }
  await DriverProfile.updateOne({ userId: user._id }, { $set: { activeTripId: trip._id } });
  await AuditLog.create({
    actor: user._id,
    action: 'TRIP_STARTED',
    target: String(trip._id),
    metadata: { busId: input.busId, isDemo: bus.isDemo },
  });
  await redis.set(`lal:freshness:${trip._id}`, 'OFFLINE', 'EX', 86400);
  io.to(`trip:${trip._id}`).emit('trip:started', liveDTO(trip));
  return liveDTO(trip);
}
function distanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const rad = Math.PI / 180,
    dl = (b.latitude - a.latitude) * rad,
    dn = (b.longitude - a.longitude) * rad;
  const x =
    Math.sin(dl / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dn / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
export async function ingestLocation(
  user: UserContext,
  id: string,
  raw: unknown,
  redis: Redis,
  io: Server,
) {
  objectId.parse(id);
  const input = locationInput.parse(raw);
  return withLock(redis, id, async () => {
    const trip = await Trip.findById(id);
    assert(
      trip && trip.status === 'ACTIVE',
      409,
      'TRIP_INACTIVE',
      'No active trip accepts this location.',
    );
    assert(
      String(trip.driverId) === user._id,
      403,
      'TRIP_FORBIDDEN',
      'Only the assigned driver may report a location.',
    );
    const { bus } = await assertAssignment(user, String(trip.busId));
    assert(
      bus.routeIds.some((route) => String(route) === String(trip.routeId)),
      403,
      'ROUTE_UNASSIGNED',
      'This route is no longer assigned to the bus.',
    );
    assert(
      !input.simulated || (demoEnabled && trip.isDemo && user.isDemo),
      403,
      'SIMULATION_FORBIDDEN',
      'Synthetic points require a development demo driver and demo trip.',
    );
    const duplicate = await redis.get(`lal:event:${id}:${input.eventId}`);
    if (duplicate) return { ...liveDTO(trip), duplicate: true };
    const observedAt = new Date(input.observedAt),
      now = new Date();
    assert(
      now.getTime() - observedAt.getTime() <= 120000 &&
        observedAt.getTime() - now.getTime() <= 10000,
      422,
      'LOCATION_TIMESTAMP',
      'GPS observation is too old or ahead of server time.',
    );
    assert(
      input.accuracy == null || input.accuracy <= 500,
      422,
      'GPS_ACCURACY',
      'GPS accuracy is too poor; wait for a better fix (within 500m).',
    );
    if (trip.latestPosition?.observedAt) {
      const previous = trip.latestPosition;
      assert(
        observedAt.getTime() > previous.observedAt!.getTime(),
        409,
        'LOCATION_OUT_OF_ORDER',
        'A newer GPS observation is already accepted.',
      );
      const elapsed = (observedAt.getTime() - previous.observedAt!.getTime()) / 1000;
      const d = distanceMeters(
        { latitude: previous.latitude!, longitude: previous.longitude! },
        input,
      );
      assert(
        d <= 55 * elapsed + (previous.accuracy ?? 0) + (input.accuracy ?? 0) + 100,
        422,
        'GPS_JUMP',
        'GPS jump rejected; wait for a consistent location fix.',
      );
    }
    const rate = await redis.incr(`lal:ingest-rate:${user._id}:${Math.floor(Date.now() / 60000)}`);
    if (rate === 1)
      await redis.expire(`lal:ingest-rate:${user._id}:${Math.floor(Date.now() / 60000)}`, 120);
    assert(
      rate <= 30,
      429,
      'LOCATION_RATE_LIMIT',
      'Too many location reports. Use a 5–10 second reporting interval.',
    );
    const position = {
      ...input,
      accuracy: input.accuracy ?? null,
      heading: input.heading ?? null,
      speed: input.speed ?? null,
      simulated: Boolean(input.simulated),
      observedAt,
      receivedAt: now,
    };
    const needSnapshot =
      !trip.lastSnapshotAt ||
      now.getTime() - trip.lastSnapshotAt.getTime() >= cfg.LOCATION_SNAPSHOT_SECONDS * 1000;
    const updated = await Trip.findOneAndUpdate(
      { _id: id, status: 'ACTIVE', version: trip.version },
      {
        $set: {
          latestPosition: position,
          lastHeartbeatAt: now,
          ...(needSnapshot ? { lastSnapshotAt: now } : {}),
        },
        $inc: { version: 1 },
      },
      { new: true },
    );
    assert(
      updated,
      409,
      'TRIP_CONFLICT',
      'Trip changed; reload before sending another observation.',
    );
    if (needSnapshot)
      await LocationSample.create({
        tripId: trip._id,
        busId: trip.busId,
        point: { type: 'Point', coordinates: [input.longitude, input.latitude] },
        accuracy: position.accuracy,
        heading: position.heading,
        speed: position.speed,
        observedAt,
        receivedAt: now,
        expireAt: new Date(now.getTime() + cfg.LOCATION_RETENTION_HOURS * 3600000),
        simulated: position.simulated,
      });
    const dto = liveDTO(updated);
    await redis
      .multi()
      .set(`lal:latest:${id}`, JSON.stringify(dto), 'EX', cfg.OFFLINE_AFTER_SECONDS)
      .set(`lal:event:${id}:${input.eventId}`, '1', 'EX', 86400)
      .set(`lal:freshness:${id}`, 'LIVE', 'EX', 86400)
      .exec();
    io.to(`trip:${id}`).emit('trip:location', dto);
    io.to(`trip:${id}`).emit('bus:status', {
      tripId: id,
      busId: String(trip.busId),
      freshness: 'LIVE',
      version: updated.version,
    });
    return dto;
  });
}
export async function endTrip(
  user: UserContext,
  id: string,
  redis: Redis,
  io: Server,
  admin = false,
) {
  objectId.parse(id);
  return withLock(redis, id, async () => {
    const trip = await Trip.findById(id);
    assert(trip, 404, 'TRIP_NOT_FOUND', 'Trip not found.');
    assert(
      admin || String(trip.driverId) === user._id,
      403,
      'TRIP_FORBIDDEN',
      'Only the driver or administrator may end this trip.',
    );
    if (trip.status !== 'ACTIVE') return liveDTO(trip);
    const ended = await Trip.findOneAndUpdate(
      { _id: id, status: 'ACTIVE' },
      {
        $set: {
          status: 'ENDED',
          endedAt: new Date(),
          latestPosition: null,
          endedBy: user._id,
          endReason: admin ? 'ADMIN_ENDED' : 'DRIVER_ENDED',
        },
        $inc: { version: 1 },
      },
      { new: true },
    );
    assert(ended, 409, 'TRIP_CONFLICT', 'Trip changed.');
    await DriverProfile.updateOne(
      { userId: trip.driverId, activeTripId: trip._id },
      { $set: { activeTripId: null } },
    );
    await redis.del(`lal:latest:${id}`, `lal:freshness:${id}`);
    await AuditLog.create({
      actor: user._id,
      action: admin ? 'ADMIN_TRIP_ENDED' : 'TRIP_ENDED',
      target: id,
      metadata: { busId: String(trip.busId) },
    });
    const dto = liveDTO(ended);
    io.to(`trip:${id}`).emit('trip:ended', dto);
    io.to(`trip:${id}`).emit('bus:status', {
      tripId: id,
      busId: String(trip.busId),
      freshness: 'ENDED',
      version: ended.version,
    });
    await io.in(`trip:${id}`).socketsLeave(`trip:${id}`);
    return dto;
  });
}
export async function statusSweep(redis: Redis, io: Server) {
  const cursor = Trip.find({ status: 'ACTIVE' }).cursor();
  for await (const trip of cursor) {
    const dto = liveDTO(trip);
    const id = String(trip._id);
    const old = await redis.getset(`lal:freshness:${id}`, String(dto.freshness));
    await redis.expire(`lal:freshness:${id}`, 86400);
    if (old !== dto.freshness) {
      io.to(`trip:${id}`).emit('trip:stale', dto);
      io.to(`trip:${id}`).emit('bus:status', {
        tripId: id,
        busId: String(trip.busId),
        freshness: dto.freshness,
        version: trip.version,
      });
    }
  }
  await Trip.updateMany(
    {
      status: 'ACTIVE',
      'latestPosition.receivedAt': {
        $lt: new Date(Date.now() - cfg.LOCATION_RETENTION_HOURS * 3600000),
      },
    },
    { $set: { latestPosition: null } },
  );
}
export type { LocationInput };
