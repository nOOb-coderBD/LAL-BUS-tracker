import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const cwd = fileURLToPath(new URL('../../', import.meta.url));

// Separate processes exercise cold starts without sharing cached configuration
// or connection pools with the development-auth integration suite.
async function verifyEntry(environment: Record<string, string | undefined>, assertions: string) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    VERCEL: '1',
    NODE_ENV: 'production',
    ALLOW_DEMO_AUTH: 'false',
    LOG_LEVEL: 'silent',
    APP_ORIGIN: 'https://lal-test.example',
    ALLOWED_ORIGINS: 'https://lal-test.example',
    ...environment,
  };
  for (const [name, value] of Object.entries(env)) if (value === undefined) delete env[name];
  await execute(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      `
        import assert from 'node:assert/strict';
        import { once } from 'node:events';
        import { createConnection } from 'node:net';
        const entry = await import('./api/server.ts');
        const server = entry.default;
        assert.equal(server.listening, false, 'The platform must bind the exported server');
        try {
          server.listen(0, '127.0.0.1');
          await once(server, 'listening');
          const port = server.address().port;
          const base = 'http://127.0.0.1:' + port;
          ${assertions}
        } finally {
          await entry.closeVercelRuntime();
        }
      `,
    ],
    { cwd, env, timeout: 25000, maxBuffer: 1024 * 1024 },
  );
}

test('Vercel entry refuses missing platform services without local development fallbacks', async () => {
  await verifyEntry(
    { MONGODB_URI: undefined, REDIS_URL: undefined },
    `
      for (const path of ['/api/v1/health/ready', '/api/v1/routes']) {
        const response = await fetch(base + path);
        assert.equal(response.status, 503);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal(response.headers.get('retry-after'), '30');
        const body = await response.json();
        assert.equal(body.error.code, 'BACKEND_NOT_CONFIGURED');
        assert.match(body.error.message, /MONGODB_URI and REDIS_URL/);
      }
      const socket = createConnection({host: '127.0.0.1', port});
      await once(socket, 'connect');
      let reply = '';
      socket.setEncoding('utf8');
      socket.on('data', chunk => { reply += chunk; });
      socket.write('GET /socket.io/?EIO=4&transport=websocket HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: Upgrade\\r\\nUpgrade: websocket\\r\\nSec-WebSocket-Key: AAAAAAAAAAAAAAAAAAAAAA==\\r\\nSec-WebSocket-Version: 13\\r\\n\\r\\n');
      await once(socket, 'close');
      assert.ok(reply.startsWith('HTTP/1.1 503 Service Unavailable'));
    `,
  );
});

test('Vercel entry rejects public development authentication before connecting', async () => {
  await verifyEntry(
    {
      ALLOW_DEMO_AUTH: 'true',
      MONGODB_URI: 'mongodb://127.0.0.1:1/not-used',
      REDIS_URL: 'redis://127.0.0.1:1/0',
    },
    `
      const response = await fetch(base + '/api/v1/auth/dev-login', {method: 'POST'});
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error.code, 'UNSAFE_AUTH_CONFIGURATION');
    `,
  );
});

test('Vercel cold-start Redis failure returns an honest 503 and releases the Mongo pool', async () => {
  await verifyEntry(
    {
      MONGODB_URI: process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/lal_vercel_test',
      REDIS_URL: 'redis://127.0.0.1:1/14',
    },
    `
      const response = await fetch(base + '/api/v1/health/ready');
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error.code, 'BACKEND_UNAVAILABLE');
      const mongoose = (await import('mongoose')).default;
      assert.equal(mongoose.connection.readyState, 0, 'Failed initialization must release its pool');
    `,
  );
});

test('Vercel HTTP server reuses real MongoDB/Redis runtime with a bounded connection pool', async () => {
  await verifyEntry(
    {
      MONGODB_URI: process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/lal_vercel_test',
      REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/14',
      MONGODB_MAX_POOL_SIZE: undefined,
    },
    `
      const again = await import('./api/server.ts');
      assert.equal(again.default, server, 'Warm invocations must retain the existing server');
      const mongoose = (await import('mongoose')).default;
      const { cfg, demoEnabled } = await import('./apps/api/dist/config.js');
      assert.equal(demoEnabled, false);
      assert.equal(cfg.NODE_ENV, 'production');
      assert.equal(cfg.MONGODB_MAX_POOL_SIZE, 5);
      assert.equal(mongoose.connection.getClient().options.maxPoolSize, 5);
      assert.equal(mongoose.connection.getClient().options.minPoolSize, 0);
      assert.equal(server.listenerCount('upgrade'), 1, 'Socket.IO must attach to the exported server');
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await fetch(base + '/api/v1/health/ready');
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {status: 'ready', mongo: 'ok', redis: 'ok'});
      }
      const response = await fetch(base + '/api/v1/auth/dev-login', {
        method: 'POST',
        headers: {Origin: 'https://lal-test.example', 'Content-Type': 'application/json'},
        body: JSON.stringify({persona: 'student'})
      });
      assert.equal(response.status, 404, 'Development auth must not exist in hosted production');
    `,
  );
});
