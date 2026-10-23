import { parseArgs } from 'node:util';
import mongoose from 'mongoose';
import { connectDatabase, migrate } from './db.js';
import { importSeed, seedDemo } from './seed.js';
import { User, DriverProfile, AuditLog } from './models.js';
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { email: { type: 'string' }, name: { type: 'string' }, identifier: { type: 'string' } },
});
try {
  await connectDatabase();
  switch (positionals[0]) {
    case 'migrate':
      await migrate();
      console.log('Migration 001: indexes created.');
      break;
    case 'seed':
      console.log(JSON.stringify(await importSeed(), null, 2));
      break;
    case 'demo':
      await seedDemo();
      console.log(
        'Development personas and labelled simulator bus prepared. No real fleet numbers or coordinates created.',
      );
      break;
    case 'admin':
    case 'driver': {
      if (!values.email || !values.name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email))
        throw new Error('Provide --email and --name (driver optionally --identifier)');
      const role = positionals[0] === 'admin' ? 'ADMIN' : 'DRIVER';
      if (await User.exists({ email: values.email.toLowerCase() }))
        throw new Error('Email already exists; bootstrap refuses to overwrite an account');
      const user = await User.create({
        name: values.name,
        email: values.email.toLowerCase(),
        role,
        status: 'ACTIVE',
        emailVerifiedAt: null,
      });
      if (role === 'DRIVER')
        await DriverProfile.create({
          userId: user._id,
          driverIdentifier: values.identifier ?? user._id.toString(),
          approvedAt: null,
          allowedBusIds: [],
        });
      await AuditLog.create({
        action: `CLI_${role}_INVITED`,
        target: user._id.toString(),
        metadata: {},
      });
      console.log(
        `${role} invited. Account requires mailbox verification; drivers also require administrator approval and bus assignment.`,
      );
      break;
    }
    default:
      throw new Error(
        'Commands: migrate | seed | demo | admin --email EMAIL --name NAME | driver --email EMAIL --name NAME',
      );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'CLI failed');
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
