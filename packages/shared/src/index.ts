import { z } from 'zod';

export const roles = ['STUDENT', 'DRIVER', 'ADMIN'] as const;
export type Role = (typeof roles)[number];
export const directions = ['UP', 'DOWN'] as const;
export const busTypes = ['SINGLE_DECKER', 'DOUBLE_DECKER', 'OTHER', 'UNKNOWN'] as const;
export const verificationStates = ['NEEDS_ADMIN_VERIFICATION', 'VERIFIED'] as const;
export const directionSchema = z.enum(directions);
export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid identifier');
export const tripStartInput = z
  .object({
    busId: objectId,
    routeId: objectId,
    direction: directionSchema,
    scheduleEntryId: objectId.optional(),
  })
  .strict();
export const locationInput = z
  .object({
    eventId: z.string().uuid(),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    observedAt: z.string().datetime(),
    accuracy: z.number().finite().min(0).max(10000).nullable().optional(),
    heading: z.number().finite().min(0).max(360).nullable().optional(),
    speed: z.number().finite().min(0).max(100).nullable().optional(),
    simulated: z.boolean().optional(),
  })
  .strict();
export type LocationInput = z.infer<typeof locationInput>;
export type TripStartInput = z.infer<typeof tripStartInput>;
export type Freshness = 'LIVE' | 'STALE' | 'OFFLINE' | 'ENDED';
export type Position = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  observedAt: string;
  receivedAt: string;
  simulated: boolean;
};
export function freshness(
  status: string,
  receivedAt: string | Date | null | undefined,
  now = Date.now(),
  staleMs = 30000,
  offlineMs = 120000,
): Freshness {
  if (status === 'ENDED') return 'ENDED';
  if (!receivedAt) return 'OFFLINE';
  const age = now - new Date(receivedAt).getTime();
  return age > offlineMs ? 'OFFLINE' : age > staleMs ? 'STALE' : 'LIVE';
}
export function formatTime(time: string, locale = 'bn-BD', hour12 = false): string {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Expected HH:mm');
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'Asia/Dhaka',
    hour: '2-digit',
    minute: '2-digit',
    hour12,
  }).format(new Date(`2000-01-01T${time}:00+06:00`));
}
export function academicDomainAllowed(email: string, domains: string[]): boolean {
  const value = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(value)) return false;
  const domain = value.split('@')[1];
  return domains
    .map((x) => x.trim().toLowerCase())
    .filter((x) => x === 'du.ac.bd' || x.endsWith('.du.ac.bd'))
    .includes(domain);
}
/** Unknown days never become a promise of service. */
export function operatesOn(days: number[] | null | undefined, weekday: number): boolean | null {
  return days == null ? null : days.includes(weekday);
}
