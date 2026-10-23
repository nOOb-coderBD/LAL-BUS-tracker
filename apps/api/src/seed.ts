import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { Bus, Route, ScheduleEntry, User, DriverProfile } from './models.js';
import { rootDir, demoEnabled } from './config.js';
const entry = z.object({
  direction: z.enum(['UP', 'DOWN']),
  departureTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  departurePlace: z.string().nullable(),
  busType: z.string().nullable(),
  vehicleNumber: z.string().nullable(),
  notes: z.string().nullable(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).nullable(),
  isStaffOnly: z.boolean(),
});
const route = z.object({
  slug: z.string(),
  nameBn: z.string(),
  subtitleFromScreenshot: z.string().nullable(),
  routeUpText: z.string().nullable(),
  routeDownText: z.string().nullable(),
  schedule: z.array(entry),
  sourceScreenshot: z.string(),
  publishedLastUpdatedText: z.string().nullable(),
  sourceNotes: z.string().nullable(),
  status: z.literal('NEEDS_ADMIN_VERIFICATION'),
  routeGeometry: z.null(),
  coordinatesVerified: z.literal(false),
  sourceScreenshotIndex: z.number(),
});
const schema = z.object({
  project: z.string(),
  timezone: z.literal('Asia/Dhaka'),
  source: z.string(),
  sourceIsLive: z.literal(false),
  verificationRequired: z.literal(true),
  notice: z.string(),
  busRoutes: z.array(route),
});
export async function importSeed({ writeReport = true }: { writeReport?: boolean } = {}) {
  const raw = JSON.parse(
    await readFile(`${rootDir}data/lal_bus_tracker_routes_seed.json`, 'utf8'),
  ) as unknown;
  const data = schema.parse(raw);
  const count = data.busRoutes.reduce((s, r) => s + r.schedule.length, 0);
  if (data.busRoutes.length !== 17 || count !== 205)
    throw new Error('Expected exactly 17 routes and 205 original timetable entries');
  for (const r of data.busRoutes) {
    const source = {
      screenshot: r.sourceScreenshot,
      screenshotIndex: r.sourceScreenshotIndex,
      publishedLastUpdatedText: r.publishedLastUpdatedText,
      notes: r.sourceNotes,
      description: data.source,
      original: r,
    };
    const doc = await Route.findOneAndUpdate(
      { $or: [{ sourceKey: r.slug }, { slug: r.slug }] },
      {
        $set: { sourceKey: r.slug },
        $setOnInsert: {
          slug: r.slug,
          nameBn: r.nameBn,
          subtitle: r.subtitleFromScreenshot,
          routeUpText: r.routeUpText,
          routeDownText: r.routeDownText,
          status: r.status,
          routeGeometry: null,
          coordinatesVerified: false,
          source,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    for (const [index, s] of r.schedule.entries()) {
      const sourceKey = `${r.slug}:${s.direction}:${index}`;
      await ScheduleEntry.updateOne(
        { sourceKey },
        {
          $setOnInsert: {
            ...s,
            routeId: doc._id,
            sourceKey,
            status: 'NEEDS_ADMIN_VERIFICATION',
            source: { screenshot: r.sourceScreenshot, originalIndex: index, original: s },
            busId: null,
          },
        },
        { upsert: true },
      );
    }
  }
  const report = {
    routeCount: data.busRoutes.length,
    scheduleCount: count,
    sourceIsLive: false,
    allEntriesNeedAdminVerification: true,
    sourceSha256: (await import('node:crypto'))
      .createHash('sha256')
      .update(await readFile(`${rootDir}data/lal_bus_tracker_routes_seed.json`))
      .digest('hex'),
    routeCounts: data.busRoutes.map((r) => ({ slug: r.slug, entries: r.schedule.length })),
    ambiguities: [
      'All operating days unknown; no projection onto actual dates',
      'Route text and stop spellings require manual confirmation; no geocoding performed',
      'Route names are not physical bus identities; no fleet inventory generated',
      'Duplicate departure times preserved by original per-route index',
      'Staff-only flags retained; screenshot timestamps are historical metadata',
      'Unknown physical numbers remain null; supplied number strings preserved only on source schedules',
    ],
    duplicateDepartureEntries: 0,
  };
  for (const r of data.busRoutes) {
    const seen = new Set<string>();
    for (const s of r.schedule) {
      const k = `${s.direction}:${s.departureTime}`;
      if (seen.has(k)) report.duplicateDepartureEntries++;
      seen.add(k);
    }
  }
  if (writeReport)
    await writeFile(`${rootDir}data/import-report.json`, JSON.stringify(report, null, 2) + '\n');
  return report;
}
export async function seedDemo() {
  if (!demoEnabled)
    throw new Error('Demo seed requires NODE_ENV=development and ALLOW_DEMO_AUTH=true');
  const profiles = {
    student: 'STUDENT',
    driver: 'DRIVER',
    admin: 'ADMIN',
    unapproved: 'DRIVER',
  } as const;
  const users = {} as Record<keyof typeof profiles, InstanceType<typeof User>>;
  for (const [persona, role] of Object.entries(profiles) as [keyof typeof profiles, string][]) {
    users[persona] = await User.findOneAndUpdate(
      { email: `demo.${persona}@demo.invalid` },
      {
        $setOnInsert: {
          name: `Development ${persona}`,
          email: `demo.${persona}@demo.invalid`,
          role,
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
          isDemo: true,
        },
      },
      { upsert: true, new: true },
    );
  }
  const r = await Route.findOne({ $or: [{ sourceKey: 'isha-kha' }, { slug: 'isha-kha' }] });
  if (!r) throw new Error('Run db:seed before db:demo');
  const bus = await Bus.findOneAndUpdate(
    { isDemo: true, displayNameEn: 'Development simulator — not a physical bus' },
    {
      $setOnInsert: {
        displayNameBn: 'উন্নয়ন পরীক্ষার বাস · বাস্তব বাস নয়',
        displayNameEn: 'Development simulator — not a physical bus',
        fleetNumber: null,
        registrationNumber: null,
        busType: 'UNKNOWN',
        routeIds: [r._id],
        assignedDriverIds: [users.driver._id],
        active: true,
        approved: true,
        isDemo: true,
      },
    },
    { upsert: true, new: true },
  );
  for (const p of ['driver', 'unapproved'] as const) {
    await DriverProfile.updateOne(
      { userId: users[p]._id },
      {
        $setOnInsert: {
          userId: users[p]._id,
          driverIdentifier: `development-${p}`,
          approvedAt: p === 'driver' ? new Date() : null,
          approvedBy: p === 'driver' ? users.admin._id : null,
          allowedBusIds: p === 'driver' ? [bus._id] : [],
        },
      },
      { upsert: true },
    );
  }
  return { ...users, bus };
}
