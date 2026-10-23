import mongoose, { Schema } from 'mongoose';
const oid = Schema.Types.ObjectId;
const options = { timestamps: true, strict: 'throw' as const };
const pointSchema = new Schema(
  {
    type: { type: String, enum: ['Point'], required: true },
    coordinates: { type: [Number], required: true },
  },
  { _id: false },
);
const positionSchema = new Schema(
  {
    latitude: Number,
    longitude: Number,
    accuracy: { type: Number, default: null },
    heading: { type: Number, default: null },
    speed: { type: Number, default: null },
    observedAt: Date,
    receivedAt: Date,
    simulated: { type: Boolean, default: false },
    eventId: String,
  },
  { _id: false },
);
const userSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    emailVerifiedAt: { type: Date, default: null },
    role: { type: String, enum: ['STUDENT', 'DRIVER', 'ADMIN'], required: true },
    status: { type: String, enum: ['ACTIVE', 'DISABLED', 'PENDING'], default: 'ACTIVE' },
    oauthSubject: { type: String, default: null },
    isDemo: { type: Boolean, default: false },
  },
  options,
);
userSchema.index({ email: 1 }, { unique: true });
export const User = mongoose.model('User', userSchema);
const driverSchema = new Schema(
  {
    userId: { type: oid, ref: 'User', required: true },
    driverIdentifier: { type: String, required: true },
    approvedAt: { type: Date, default: null },
    approvedBy: { type: oid, ref: 'User', default: null },
    allowedBusIds: { type: [oid], ref: 'Bus', default: [] },
    activeTripId: { type: oid, ref: 'Trip', default: null },
  },
  options,
);
driverSchema.index({ userId: 1 }, { unique: true });
driverSchema.index({ driverIdentifier: 1 }, { unique: true });
export const DriverProfile = mongoose.model('DriverProfile', driverSchema);
const busSchema = new Schema(
  {
    displayNameBn: { type: String, required: true },
    displayNameEn: { type: String, default: null },
    fleetNumber: { type: String, default: null },
    registrationNumber: { type: String, default: null },
    busType: {
      type: String,
      enum: ['SINGLE_DECKER', 'DOUBLE_DECKER', 'OTHER', 'UNKNOWN'],
      default: 'UNKNOWN',
    },
    routeIds: { type: [oid], ref: 'Route', default: [] },
    assignedDriverIds: { type: [oid], ref: 'User', default: [] },
    active: { type: Boolean, default: true },
    approved: { type: Boolean, default: false },
    isDemo: { type: Boolean, default: false },
  },
  options,
);
for (const key of ['fleetNumber', 'registrationNumber'])
  busSchema.index(
    { [key]: 1 },
    { unique: true, partialFilterExpression: { [key]: { $type: 'string' } } },
  );
busSchema.index({ routeIds: 1, active: 1 });
busSchema.index({ assignedDriverIds: 1 });
export const Bus = mongoose.model('Bus', busSchema);
const routeSchema = new Schema(
  {
    sourceKey: { type: String, default: undefined },
    slug: { type: String, required: true },
    nameBn: { type: String, required: true },
    subtitle: { type: String, default: null },
    routeUpText: { type: String, default: null },
    routeDownText: { type: String, default: null },
    orderedStopIds: { UP: { type: [oid], default: [] }, DOWN: { type: [oid], default: [] } },
    routeGeometry: { type: Schema.Types.Mixed, default: null },
    coordinatesVerified: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ['NEEDS_ADMIN_VERIFICATION', 'VERIFIED'],
      default: 'NEEDS_ADMIN_VERIFICATION',
    },
    source: { type: Schema.Types.Mixed, default: null },
    reviewedAt: { type: Date, default: null },
    version: { type: Number, default: 1 },
  },
  options,
);
routeSchema.index({ slug: 1 }, { unique: true });
routeSchema.index(
  { sourceKey: 1 },
  { unique: true, partialFilterExpression: { sourceKey: { $type: 'string' } } },
);
export const Route = mongoose.model('Route', routeSchema);
const stopSchema = new Schema(
  {
    nameBn: { type: String, required: true },
    nameEn: { type: String, default: null },
    aliases: { type: [String], default: [] },
    point: { type: pointSchema, default: undefined },
    coordinatesVerified: { type: Boolean, default: false },
    routeIds: { type: [oid], default: [] },
  },
  options,
);
stopSchema.index({ point: '2dsphere' });
export const Stop = mongoose.model('Stop', stopSchema);
const scheduleSchema = new Schema(
  {
    routeId: { type: oid, ref: 'Route', required: true },
    direction: { type: String, enum: ['UP', 'DOWN'], required: true },
    departureTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    departurePlace: { type: String, default: null },
    busId: { type: oid, ref: 'Bus', default: null },
    busType: { type: String, default: null },
    vehicleNumber: { type: String, default: null },
    daysOfWeek: { type: [Number], default: null },
    isStaffOnly: { type: Boolean, default: false },
    notes: { type: String, default: null },
    destination: { type: String, default: null },
    status: {
      type: String,
      enum: ['NEEDS_ADMIN_VERIFICATION', 'VERIFIED'],
      default: 'NEEDS_ADMIN_VERIFICATION',
    },
    sourceKey: { type: String, default: undefined },
    source: { type: Schema.Types.Mixed, default: null },
  },
  options,
);
scheduleSchema.index(
  { sourceKey: 1 },
  { unique: true, partialFilterExpression: { sourceKey: { $type: 'string' } } },
);
scheduleSchema.index({ routeId: 1, direction: 1, departureTime: 1 });
export const ScheduleEntry = mongoose.model('ScheduleEntry', scheduleSchema);
const tripSchema = new Schema(
  {
    busId: { type: oid, ref: 'Bus', required: true },
    routeId: { type: oid, ref: 'Route', required: true },
    driverId: { type: oid, ref: 'User', required: true },
    direction: { type: String, enum: ['UP', 'DOWN'], required: true },
    scheduleEntryId: { type: oid, ref: 'ScheduleEntry', default: null },
    status: { type: String, enum: ['ACTIVE', 'ENDED', 'INTERRUPTED'], default: 'ACTIVE' },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
    latestPosition: { type: positionSchema, default: null },
    lastSnapshotAt: { type: Date, default: null },
    lastHeartbeatAt: { type: Date, default: null },
    version: { type: Number, default: 1 },
    isDemo: { type: Boolean, default: false },
    endedBy: { type: oid, ref: 'User', default: null },
    endReason: { type: String, default: null },
  },
  options,
);
tripSchema.index({ busId: 1 }, { unique: true, partialFilterExpression: { status: 'ACTIVE' } });
tripSchema.index({ driverId: 1 }, { unique: true, partialFilterExpression: { status: 'ACTIVE' } });
tripSchema.index({ status: 1, startedAt: -1 });
export const Trip = mongoose.model('Trip', tripSchema);
const sampleSchema = new Schema(
  {
    tripId: { type: oid, ref: 'Trip', required: true },
    busId: { type: oid, ref: 'Bus', required: true },
    point: { type: pointSchema, required: true },
    accuracy: { type: Number, default: null },
    speed: { type: Number, default: null },
    heading: { type: Number, default: null },
    observedAt: { type: Date, required: true },
    receivedAt: { type: Date, required: true },
    expireAt: { type: Date, required: true },
    simulated: { type: Boolean, default: false },
  },
  options,
);
sampleSchema.index({ point: '2dsphere' });
sampleSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });
sampleSchema.index({ tripId: 1, receivedAt: -1 });
export const LocationSample = mongoose.model('LocationSample', sampleSchema);
const auditSchema = new Schema(
  {
    actor: { type: oid, ref: 'User', default: null },
    action: { type: String, required: true },
    target: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    timestamp: { type: Date, default: Date.now },
  },
  options,
);
auditSchema.index({ timestamp: -1 });
export const AuditLog = mongoose.model('AuditLog', auditSchema);
const tokenSchema = new Schema(
  {
    email: { type: String, required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    developmentOnly: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  },
  { strict: 'throw' },
);
tokenSchema.index({ tokenHash: 1 }, { unique: true });
tokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const EmailVerificationToken = mongoose.model('EmailVerificationToken', tokenSchema);
export const models = [
  User,
  DriverProfile,
  Bus,
  Route,
  Stop,
  ScheduleEntry,
  Trip,
  LocationSample,
  AuditLog,
  EmailVerificationToken,
];
