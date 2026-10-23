import { createServer, type Server } from 'node:http';

type Runtime = Awaited<ReturnType<(typeof import('../apps/api/dist/app.js'))['createRuntime']>>;

function unavailableServer(code: string, message: string): Server {
  const body = JSON.stringify({ error: { code, message } });
  const server = createServer((_request, response) => {
    response.writeHead(503, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Retry-After': '30',
    });
    response.end(body);
  });
  server.on('upgrade', (_request, socket) => {
    socket.end(
      'HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
    );
  });
  return server;
}

async function initialize(): Promise<{ server: Server; runtime: Runtime | null }> {
  // Hosting credentials must come from the platform, never the local development
  // fallbacks in config.ts. The static frontend can render an honest API error.
  const missing = ['MONGODB_URI', 'REDIS_URL'].filter((name) => !process.env[name]?.trim());
  if (missing.length) {
    return {
      server: unavailableServer(
        'BACKEND_NOT_CONFIGURED',
        `Configure ${missing.join(' and ')} in the hosting environment to enable the API.`,
      ),
      runtime: null,
    };
  }
  if (process.env.VERCEL === '1') process.env.NODE_ENV = 'production';
  if (process.env.VERCEL === '1' && process.env.ALLOW_DEMO_AUTH === 'true') {
    return {
      server: unavailableServer(
        'UNSAFE_AUTH_CONFIGURATION',
        'Development authentication must be disabled for public hosting.',
      ),
      runtime: null,
    };
  }
  try {
    const { createRuntime } = await import('../apps/api/dist/app.js');
    const runtime = await createRuntime();
    return { server: runtime.httpServer, runtime };
  } catch {
    // Do not log connection URIs, credential-bearing errors, or verification data.
    console.error('Lal Bus backend initialization failed. Check database and Redis connectivity.');
    return {
      server: unavailableServer(
        'BACKEND_UNAVAILABLE',
        'The backend could not connect to its required data services. Please try again later.',
      ),
      runtime: null,
    };
  }
}

// A single initialization/pool set is retained by the warm function module.
// Vercel binds this HTTP server and upgrades Socket.IO WebSocket connections;
// calling listen() here would create an unrelated port and break that contract.
const initialized = await initialize();
export default initialized.server;

/** Used by local lifecycle tests; this is not an HTTP endpoint. */
export async function closeVercelRuntime(): Promise<void> {
  if (initialized.runtime) await initialized.runtime.close();
  else if (initialized.server.listening) {
    await new Promise<void>((resolve, reject) =>
      initialized.server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
