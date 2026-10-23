import type { Express, Request } from 'express';
import type { Model } from 'mongoose';
import type { Redis } from 'ioredis';
import type { Server } from 'socket.io';
import { z } from 'zod';
import { objectId, busTypes, verificationStates } from '@lal/shared';
import { Bus, Route, ScheduleEntry, User, DriverProfile, Trip, AuditLog } from './models.js';
import { requireRole } from './auth.js';
import { assert } from './errors.js';
import { endTrip } from './trips.js';
const nullableString = z.string().trim().min(1).max(300).nullable().optional();
const geometry = z
  .object({
    type: z.literal('LineString'),
    coordinates: z
      .array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]))
      .min(2),
  })
  .nullable();
const bus = z
  .object({
    displayNameBn: z.string().trim().min(1).max(160),
    displayNameEn: nullableString,
    fleetNumber: nullableString,
    registrationNumber: nullableString,
    busType: z.enum(busTypes).default('UNKNOWN'),
    routeIds: z.array(objectId).max(30).default([]),
    assignedDriverIds: z.array(objectId).max(30).default([]),
    active: z.boolean().default(true),
    approved: z.boolean().default(false),
  })
  .strict();
const route = z
  .object({
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(100),
    nameBn: z.string().min(1).max(200),
    subtitle: nullableString,
    routeUpText: z.string().max(10000).nullable().optional(),
    routeDownText: z.string().max(10000).nullable().optional(),
    status: z.enum(verificationStates).default('NEEDS_ADMIN_VERIFICATION'),
    routeGeometry: geometry.optional(),
    coordinatesVerified: z.boolean().optional(),
  })
  .strict();
const schedule = z
  .object({
    routeId: objectId,
    direction: z.enum(['UP', 'DOWN']),
    departureTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    departurePlace: nullableString,
    busId: objectId.nullable().optional(),
    busType: nullableString,
    vehicleNumber: nullableString,
    daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).nullable().optional(),
    isStaffOnly: z.boolean().default(false),
    notes: z.string().max(2000).nullable().optional(),
    destination: nullableString,
    status: z.enum(verificationStates).default('NEEDS_ADMIN_VERIFICATION'),
  })
  .strict();
const paging = (req: Request) =>
  z
    .object({
      page: z.coerce.number().int().min(1).max(10000).default(1),
      limit: z.coerce.number().int().min(1).max(500).default(100),
    })
    .parse(req.query);
async function audit(req: Request, action: string, target: string) {
  await AuditLog.create({ actor: req.auth!.user._id, action, target, metadata: {} });
}
async function validateBus(input: Partial<z.infer<typeof bus>>) {
  if (input.routeIds)
    assert(
      (await Route.countDocuments({ _id: { $in: input.routeIds } })) ===
        new Set(input.routeIds).size,
      422,
      'ROUTE_NOT_FOUND',
      'One or more assigned routes do not exist.',
    );
  if (input.assignedDriverIds)
    assert(
      (await User.countDocuments({ _id: { $in: input.assignedDriverIds }, role: 'DRIVER' })) ===
        new Set(input.assignedDriverIds).size,
      422,
      'DRIVER_NOT_FOUND',
      'One or more driver accounts do not exist.',
    );
}
async function validateSchedule(input: Partial<z.infer<typeof schedule>>) {
  if (input.routeId)
    assert(
      await Route.exists({ _id: input.routeId }),
      422,
      'ROUTE_NOT_FOUND',
      'Route does not exist.',
    );
  if (input.busId)
    assert(await Bus.exists({ _id: input.busId }), 422, 'BUS_NOT_FOUND', 'Bus does not exist.');
}
export function mountAdmin(app: Express, redis: Redis, io: Server) {
  const base = '/api/v1/admin';
  app.use(base, requireRole('ADMIN'));
  app.get(`${base}/drivers`, async (req, res) => {
    const { page, limit } = paging(req);
    const users = await User.find({ role: 'DRIVER' })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();
    const profiles = await DriverProfile.find({ userId: { $in: users.map((u) => u._id) } }).lean();
    res.json({
      items: users.map((u) => {
        const p = profiles.find((p) => String(p.userId) === String(u._id));
        return {
          _id: u._id,
          name: u.name,
          email: u.email,
          status: u.status,
          isDemo: u.isDemo,
          approvedAt: p?.approvedAt ?? null,
          allowedBusIds: p?.allowedBusIds ?? [],
          driverIdentifier: p?.driverIdentifier ?? null,
        };
      }),
      total: await User.countDocuments({ role: 'DRIVER' }),
      page,
      limit,
    });
  });
  app.patch(`${base}/drivers/:id/approval`, async (req, res) => {
    const id = objectId.parse(req.params.id);
    const input = z
      .object({ approved: z.boolean(), allowedBusIds: z.array(objectId).max(30).optional() })
      .strict()
      .parse(req.body);
    const profile = await DriverProfile.findOne({ userId: id });
    assert(profile, 404, 'DRIVER_NOT_FOUND', 'Driver profile not found.');
    if (input.allowedBusIds)
      assert(
        (await Bus.countDocuments({
          _id: { $in: input.allowedBusIds },
          active: true,
          approved: true,
        })) === new Set(input.allowedBusIds).size,
        422,
        'BUS_UNAPPROVED',
        'Select existing active approved buses.',
      );
    const busIds = input.allowedBusIds ?? profile.allowedBusIds.map(String);
    await DriverProfile.updateOne(
      { userId: id },
      {
        $set: {
          approvedAt: input.approved ? new Date() : null,
          approvedBy: req.auth!.user._id,
          allowedBusIds: input.approved ? busIds : [],
        },
      },
    );
    await Bus.updateMany({ assignedDriverIds: id }, { $pull: { assignedDriverIds: id } });
    if (input.approved)
      await Bus.updateMany({ _id: { $in: busIds } }, { $addToSet: { assignedDriverIds: id } });
    if (!input.approved) {
      const active = await Trip.findOne({ driverId: id, status: 'ACTIVE' });
      if (active) await endTrip(req.auth!.user, String(active._id), redis, io, true);
    }
    await audit(req, input.approved ? 'DRIVER_APPROVED' : 'DRIVER_REVOKED', id);
    res.json({ item: await DriverProfile.findOne({ userId: id }) });
  });
  for (const entity of ['buses', 'routes', 'schedules'] as const) {
    const model = (entity === 'buses'
      ? Bus
      : entity === 'routes'
        ? Route
        : ScheduleEntry) as unknown as Model<Record<string, unknown>>;
    const schema = entity === 'buses' ? bus : entity === 'routes' ? route : schedule;
    app.get(`${base}/${entity}`, async (req, res) => {
      const { page, limit } = paging(req);
      const [items, total] = await Promise.all([
        model
          .find()
          .sort({ _id: 1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        model.countDocuments(),
      ]);
      res.json({ items, total, page, limit });
    });
    app.get(`${base}/${entity}/:id`, async (req, res) => {
      const item = await model.findById(objectId.parse(req.params.id)).lean();
      assert(item, 404, 'NOT_FOUND', 'Record not found.');
      res.json({ item });
    });
    app.post(`${base}/${entity}`, async (req, res) => {
      const input = schema.parse(req.body);
      if (entity === 'buses') await validateBus(input as z.infer<typeof bus>);
      if (entity === 'schedules') await validateSchedule(input as z.infer<typeof schedule>);
      if (entity === 'routes' && 'routeGeometry' in input && input.routeGeometry)
        assert(
          'coordinatesVerified' in input && input.coordinatesVerified,
          422,
          'GEOMETRY_UNVERIFIED',
          'Only manually verified geometry may be published.',
        );
      const item = await model.create(input);
      if (entity === 'buses') {
        const ids = (input as z.infer<typeof bus>).assignedDriverIds;
        await DriverProfile.updateMany(
          { userId: { $in: ids } },
          { $addToSet: { allowedBusIds: item._id } },
        );
      }
      await audit(req, `${entity.toUpperCase()}_CREATED`, String(item._id));
      res.status(201).json({ item });
    });
    app.patch(`${base}/${entity}/:id`, async (req, res) => {
      const id = objectId.parse(req.params.id);
      const input = schema.partial().parse(req.body);
      assert(
        Object.keys(input).length,
        400,
        'EMPTY_PATCH',
        'Provide at least one field to update.',
      );
      if (entity === 'buses') {
        await validateBus(input as Partial<z.infer<typeof bus>>);
        if (
          ('active' in input && input.active === false) ||
          ('approved' in input && input.approved === false)
        ) {
          const active = await Trip.findOne({ busId: id, status: 'ACTIVE' });
          if (active) await endTrip(req.auth!.user, String(active._id), redis, io, true);
        }
      }
      if (entity === 'schedules')
        await validateSchedule(input as Partial<z.infer<typeof schedule>>);
      if (entity === 'routes' && 'routeGeometry' in input && input.routeGeometry)
        assert(
          'coordinatesVerified' in input && input.coordinatesVerified,
          422,
          'GEOMETRY_UNVERIFIED',
          'Only manually verified geometry may be published.',
        );
      const item = await model.findByIdAndUpdate(
        id,
        {
          $set: {
            ...input,
            ...(entity === 'routes' &&
            'coordinatesVerified' in input &&
            input.coordinatesVerified === false
              ? { routeGeometry: null }
              : {}),
            ...(entity === 'routes' && 'status' in input
              ? { reviewedAt: input.status === 'VERIFIED' ? new Date() : null }
              : {}),
          },
          ...(entity === 'routes' ? { $inc: { version: 1 } } : {}),
        },
        { new: true, runValidators: true },
      );
      assert(item, 404, 'NOT_FOUND', 'Record not found.');
      if (entity === 'buses' && 'assignedDriverIds' in input) {
        await DriverProfile.updateMany({ allowedBusIds: id }, { $pull: { allowedBusIds: id } });
        await DriverProfile.updateMany(
          { userId: { $in: input.assignedDriverIds } },
          { $addToSet: { allowedBusIds: id } },
        );
      }
      await audit(req, `${entity.toUpperCase()}_UPDATED`, id);
      res.json({ item });
    });
    app.delete(`${base}/${entity}/:id`, async (req, res) => {
      const id = objectId.parse(req.params.id);
      assert(
        !(await Trip.exists({
          status: 'ACTIVE',
          [entity === 'buses' ? 'busId' : entity === 'routes' ? 'routeId' : 'scheduleEntryId']: id,
        })),
        409,
        'RECORD_IN_USE',
        'End active trips before deleting this record.',
      );
      if (entity === 'routes')
        assert(
          !(await Bus.exists({ routeIds: id })) && !(await ScheduleEntry.exists({ routeId: id })),
          409,
          'RECORD_IN_USE',
          'Remove bus assignments and schedules before deleting this route.',
        );
      if (entity === 'buses')
        assert(
          !(await ScheduleEntry.exists({ busId: id })),
          409,
          'RECORD_IN_USE',
          'Remove schedule assignments before deleting this bus.',
        );
      const item = await model.findByIdAndDelete(id);
      assert(item, 404, 'NOT_FOUND', 'Record not found.');
      if (entity === 'buses')
        await DriverProfile.updateMany({ allowedBusIds: id }, { $pull: { allowedBusIds: id } });
      await audit(req, `${entity.toUpperCase()}_DELETED`, id);
      res.json({ item: { _id: id, deleted: true } });
    });
  }
  app.post(`${base}/trips/:id/end`, async (req, res) =>
    res.json({
      item: await endTrip(req.auth!.user, objectId.parse(req.params.id), redis, io, true),
    }),
  );
  app.get(`${base}/audit`, async (req, res) => {
    const { page, limit } = paging(req);
    res.json({
      items: await AuditLog.find()
        .sort({ timestamp: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      total: await AuditLog.countDocuments(),
      page,
      limit,
    });
  });
  app.get(`${base}/export`, async (_req, res) =>
    res
      .attachment('lal-transport-export.json')
      .json({
        routes: await Route.find().lean(),
        schedules: await ScheduleEntry.find().lean(),
        buses: await Bus.find().lean(),
      }),
  );
}
