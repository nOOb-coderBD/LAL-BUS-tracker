import http from 'k6/http';
import { check, sleep } from 'k6';

if (__ENV.ACK_OWN_TARGET !== 'YES')
  throw new Error('Set ACK_OWN_TARGET=YES only for infrastructure you control and may load-test.');
const profile = __ENV.PROFILE || 'smoke';
if (!['smoke', '1k', '10k', 'rps'].includes(profile))
  throw new Error('PROFILE must be smoke, 1k, 10k or rps.');
const vus = Number(__ENV.VUS || (profile === '1k' ? 1000 : profile === '10k' ? 10000 : 1));
const rate = Number(__ENV.RATE || 10);
if (!Number.isInteger(vus) || vus < 1 || !Number.isInteger(rate) || rate < 1)
  throw new Error('VUS and RATE must be positive integers.');
if ((vus > 100 || (profile === 'rps' && rate > 100)) && __ENV.ALLOW_LARGE_LOAD !== 'YES') {
  throw new Error(
    'Load above 100 viewers / 100 RPS requires ALLOW_LARGE_LOAD=YES and provisioned target capacity.',
  );
}
const duration = __ENV.DURATION || '15s';
const base = (__ENV.BASE_URL || 'http://127.0.0.1:5173').replace(/\/$/, '');
const scenario =
  profile === 'rps'
    ? {
        executor: 'constant-arrival-rate',
        rate,
        timeUnit: '1s',
        duration,
        preAllocatedVUs: Math.min(vus, 100),
        maxVUs: vus,
      }
    : profile === 'smoke'
      ? { executor: 'constant-vus', vus, duration }
      : {
          executor: 'ramping-vus',
          startVUs: 0,
          stages: [
            { duration: __ENV.RAMP_DURATION || '2m', target: vus },
            { duration, target: vus },
            { duration: '30s', target: 0 },
          ],
        };

export const options = {
  scenarios: { http: scenario },
  summaryTrendStats: ['avg', 'min', 'med', 'p(50)', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    http_req_failed: [`rate<${__ENV.MAX_ERROR_RATE || 0.01}`],
    http_req_duration: [`p(95)<${__ENV.P95_MS || 750}`, `p(99)<${__ENV.P99_MS || 1500}`],
    checks: ['rate>0.99'],
    ...(profile === 'rps' ? { dropped_iterations: ['count==0'] } : {}),
  },
};

export default function () {
  // Exactly one request per iteration, so arrival-rate iterations equal target RPS.
  const path = __ITER % 5 === 0 ? '/api/v1/health/ready' : '/api/v1/routes?limit=20';
  const response = http.get(`${base}${path}`, {
    headers: __ENV.SESSION_COOKIE ? { Cookie: __ENV.SESSION_COOKIE } : {},
    tags: { endpoint: path.split('?')[0] },
    timeout: '10s',
  });
  check(response, { 'HTTP 200': (r) => r.status === 200 });
  if (profile !== 'rps') sleep(Number(__ENV.THINK_SECONDS || 1));
}

export function handleSummary(data) {
  return {
    'load-http-summary.json': JSON.stringify(data, null, 2),
    stdout: `HTTP run completed; thresholds determine exit status. Report: load-http-summary.json\n`,
  };
}
