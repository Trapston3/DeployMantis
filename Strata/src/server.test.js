import { test, after } from 'node:test';
import assert from 'node:assert';
import { inferErrorCode, server } from './server.js';

test('inferErrorCode handles standard error status codes', () => {
  assert.strictEqual(inferErrorCode(500, '/some/path'), 'HTTP_500');
  assert.strictEqual(inferErrorCode(502, '/some/path'), 'HTTP_500');
  assert.strictEqual(inferErrorCode(404, '/some/path'), 'HTTP_404');
  assert.strictEqual(inferErrorCode(403, '/some/path'), 'HTTP_403');
  assert.strictEqual(inferErrorCode(401, '/some/path'), 'HTTP_401');
});

test('inferErrorCode prioritizes status code over internal paths', () => {
  // Assuming a 500 error on /metrics or /health should be an error
  assert.strictEqual(inferErrorCode(500, '/metrics'), 'HTTP_500');
  assert.strictEqual(inferErrorCode(404, '/health'), 'HTTP_404');
});

test('inferErrorCode handles specific internal paths for success or other non-mapped codes', () => {
  assert.strictEqual(inferErrorCode(200, '/metrics'), 'PROMETHEUS_SCRAPE');
  assert.strictEqual(inferErrorCode(200, '/health'), 'HEALTH_PROBE');

  // What about an unexpected code, e.g., 400 or 422? It falls through to PROMETHEUS_SCRAPE / HEALTH_PROBE right now
  assert.strictEqual(inferErrorCode(400, '/metrics'), 'PROMETHEUS_SCRAPE');
  assert.strictEqual(inferErrorCode(400, '/health'), 'HEALTH_PROBE');
});

test('inferErrorCode handles HTTP_OK default case', () => {
  assert.strictEqual(inferErrorCode(200, '/api/logs'), 'HTTP_OK');
  assert.strictEqual(inferErrorCode(201, '/something'), 'HTTP_OK');
  assert.strictEqual(inferErrorCode(204, '/api/logs'), 'HTTP_OK');
  assert.strictEqual(inferErrorCode(400, '/bad-request'), 'HTTP_OK'); // Based on logic, 400 goes to HTTP_OK
});

after(() => {
  if (server) {
    server.close();
  }
});
