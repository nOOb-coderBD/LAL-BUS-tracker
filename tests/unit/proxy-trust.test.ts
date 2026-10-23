import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cwd = fileURLToPath(new URL('../../', import.meta.url));
function run(source: string, setting: string) {
  return spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], {
    cwd,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      ALLOW_DEMO_AUTH: 'false',
      APP_ORIGIN: 'https://bus.example.test',
      ALLOWED_ORIGINS: 'https://bus.example.test',
      TRUST_PROXY: setting,
    },
    encoding: 'utf8',
    timeout: 15000,
  });
}

// A test-only endpoint exercises Express address resolution with the actual API
// configuration. No diagnostic endpoint or authentication bypass is added to the app.
const resolveClients = `
  import express from 'express';
  const { cfg } = await import('./apps/api/src/config.ts');
  const app = express();
  app.set('trust proxy', cfg.trustProxyHops);
  app.get('/', (req, res) => res.json({ ip: req.ip, ips: req.ips }));
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    const clients = [];
    for (const address of ['198.51.100.10', '198.51.100.20']) {
      const response = await fetch(base, { headers: { 'X-Forwarded-For': address + ', 172.18.0.1' } });
      clients.push(await response.json());
    }
    console.log(JSON.stringify({ hops: cfg.trustProxyHops, clients }));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
`;

function resolved(setting: string): { hops: number; clients: { ip: string; ips: string[] }[] } {
  const result = run(resolveClients, setting);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('two trusted proxies preserve distinct client IPs for authentication rate-limit buckets', () => {
  const result = resolved('2');
  assert.equal(result.hops, 2);
  assert.deepEqual(
    result.clients.map((client) => client.ip),
    ['198.51.100.10', '198.51.100.20'],
  );
  assert.deepEqual(result.clients[0].ips, ['198.51.100.10', '172.18.0.1']);
});

test('default false/zero ignores forged forwarded IPs; legacy true still trusts exactly one hop', () => {
  for (const setting of ['false', '0']) {
    const result = resolved(setting);
    assert.equal(result.hops, 0);
    assert.deepEqual(result.clients, [
      { ip: '127.0.0.1', ips: [] },
      { ip: '127.0.0.1', ips: [] },
    ]);
  }
  for (const setting of ['true', '1']) {
    const result = resolved(setting);
    assert.equal(result.hops, 1);
    assert.deepEqual(
      result.clients.map((client) => client.ip),
      ['172.18.0.1', '172.18.0.1'],
    );
  }
});

test('proxy trust rejects unbounded or ambiguous configuration', () => {
  for (const setting of ['6', '100', '-1', '1.5', 'yes', 'Infinity', 'true,2']) {
    const result = run("await import('./apps/api/src/config.ts')", setting);
    assert.notEqual(result.status, 0, `Unsafe trust setting accepted: ${setting}`);
    assert.match(result.stderr, /TRUST_PROXY/);
  }
});
