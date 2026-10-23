import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cwd = fileURLToPath(new URL('../../', import.meta.url));
function run(source: string, overrides: Record<string, string>) {
  return spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], {
    cwd,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      ALLOW_DEMO_AUTH: 'false',
      APP_ORIGIN: 'https://bus.example.test',
      ALLOWED_ORIGINS: 'https://bus.example.test',
      ...overrides,
    },
    encoding: 'utf8',
    timeout: 15000,
  });
}

test('production refuses configuration that enables demo authentication', () => {
  const result = run("await import('./apps/api/src/config.ts')", { ALLOW_DEMO_AUTH: 'true' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Demo authentication cannot be enabled in production/);
});

test('CORS origin configuration rejects malformed hosts and URLs containing paths', () => {
  for (const origin of [
    'not-an-origin',
    'https://bus.example.test/secret',
    'https://user:pass@bus.example.test',
    '*',
  ]) {
    const result = run("await import('./apps/api/src/config.ts')", { ALLOWED_ORIGINS: origin });
    assert.notEqual(result.status, 0, `Invalid origin was accepted: ${origin}`);
  }
});

test('academic domain checks accept explicit DU subdomains and reject lookalikes and unrelated configured domains', () => {
  const result = run(
    `
    import assert from 'node:assert/strict';
    const { isAcademicEmail } = await import('./apps/api/src/auth.ts');
    for (const email of ['student@du.ac.bd','student@student.du.ac.bd','student@cse.du.ac.bd']) assert.equal(isAcademicEmail(email),true);
    for (const email of ['student@gmail.com','student@du.ac.bd.evil.com','student@evildu.ac.bd','student@cse.du.ac.bd.evil.com','a@du.ac.bd@evil.com']) assert.equal(isAcademicEmail(email),false);
  `,
    { DU_EMAIL_DOMAINS: 'du.ac.bd,student.du.ac.bd,cse.du.ac.bd,gmail.com' },
  );
  assert.equal(result.status, 0, result.stderr);
});
