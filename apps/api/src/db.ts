import mongoose from 'mongoose';
import { Redis } from 'ioredis';
import { cfg } from './config.js';
import { models } from './models.js';
export async function connectDatabase() {
  mongoose.set('autoIndex', false);
  if (mongoose.connection.readyState !== 1)
    await mongoose.connect(cfg.MONGODB_URI, {
      maxPoolSize: cfg.MONGODB_MAX_POOL_SIZE,
      minPoolSize: 0,
      maxConnecting: 2,
      serverSelectionTimeoutMS: 10000,
    });
}
export function createRedis() {
  return new Redis(cfg.REDIS_URL, {
    maxRetriesPerRequest: 2,
    lazyConnect: true,
    enableReadyCheck: true,
  });
}
export async function migrate() {
  for (const model of models) await model.createIndexes();
  await mongoose.connection
    .collection('migrations')
    .updateOne(
      { _id: '001_initial_indexes' as never },
      { $setOnInsert: { appliedAt: new Date() } },
      { upsert: true },
    );
}
