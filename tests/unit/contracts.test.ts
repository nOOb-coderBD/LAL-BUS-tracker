import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  academicDomainAllowed,
  formatTime,
  freshness,
  operatesOn,
  locationInput,
} from '@lal/shared';
import { readFile } from 'node:fs/promises';

test('academic domains are exact allowlisted DU domains, never lookalikes', () => {
  const allowed = ['du.ac.bd', 'student.du.ac.bd', 'cse.du.ac.bd'];
  for (const email of ['student@du.ac.bd', 'student@student.du.ac.bd', 'STUDENT@CSE.DU.AC.BD'])
    assert.equal(academicDomainAllowed(email, allowed), true);
  for (const email of [
    'a@gmail.com',
    'a@student.du.ac.bd.evil.com',
    'a@evildu.ac.bd',
    'a@unknown.du.ac.bd',
    '@du.ac.bd',
    'a@@du.ac.bd',
  ])
    assert.equal(academicDomainAllowed(email, allowed), false);
});
test('freshness uses received measurement age and preserves ended state', () => {
  const now = Date.now();
  assert.equal(freshness('ACTIVE', new Date(now - 1000), now), 'LIVE');
  assert.equal(freshness('ACTIVE', new Date(now - 31000), now), 'STALE');
  assert.equal(freshness('ACTIVE', new Date(now - 121000), now), 'OFFLINE');
  assert.equal(freshness('ACTIVE', null, now), 'OFFLINE');
  assert.equal(freshness('ENDED', new Date(now), now), 'ENDED');
});
test('Dhaka departure display converts 12/24h without inventing service days', () => {
  assert.match(formatTime('13:35', 'en-GB'), /13:35/);
  assert.match(formatTime('13:35', 'en-US', true), /01:35 PM/);
  assert.equal(operatesOn(null, 2), null);
  assert.equal(operatesOn([1, 2], 2), true);
  assert.equal(operatesOn([1, 2], 0), false);
  assert.throws(() => formatTime('25:00'));
});
test('GPS contract rejects invalid coordinates, fabricated fields, malformed timestamps', () => {
  const point = {
    eventId: crypto.randomUUID(),
    latitude: 23.7,
    longitude: 90.4,
    observedAt: new Date().toISOString(),
    simulated: true,
  };
  assert.equal(locationInput.safeParse(point).success, true);
  assert.equal(locationInput.safeParse({ ...point, latitude: 91 }).success, false);
  assert.equal(locationInput.safeParse({ ...point, accuracy: -1 }).success, false);
  assert.equal(locationInput.safeParse({ ...point, observedAt: 'today' }).success, false);
  assert.equal(locationInput.safeParse({ ...point, driverId: 'forged' }).success, false);
});
test('source has precisely 17 draft routes and 205 intact source entries', async () => {
  const source = JSON.parse(
    await readFile(new URL('../../data/lal_bus_tracker_routes_seed.json', import.meta.url), 'utf8'),
  );
  assert.equal(source.timezone, 'Asia/Dhaka');
  assert.equal(source.sourceIsLive, false);
  assert.equal(source.busRoutes.length, 17);
  assert.equal(new Set(source.busRoutes.map((r: any) => r.slug)).size, 17);
  assert.equal(source.busRoutes.flatMap((r: any) => r.schedule).length, 205);
  assert.ok(
    source.busRoutes.every(
      (r: any) => r.status === 'NEEDS_ADMIN_VERIFICATION' && r.routeGeometry === null,
    ),
  );
  assert.ok(
    source.busRoutes.flatMap((r: any) => r.schedule).every((s: any) => s.daysOfWeek === null),
  );
  const dup = source.busRoutes
    .find((r: any) => r.slug === 'choitali')
    .schedule.filter((s: any) => s.direction === 'UP' && s.departureTime === '07:10');
  assert.equal(dup.length, 2);
});
