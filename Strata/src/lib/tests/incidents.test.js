import test from 'node:test';
import assert from 'node:assert';
import { buildIncidents } from '../incidents.js';

test('buildIncidents should group errors by service and errorCode', () => {
  const logs = [
    { level: 'error', service: 'auth-service', errorCode: 'AUTH_001', timestamp: new Date().toISOString() },
    { level: 'error', service: 'auth-service', errorCode: 'AUTH_001', timestamp: new Date(Date.now() - 1000).toISOString() },
    { level: 'error', service: 'db-service', errorCode: 'DB_001', timestamp: new Date().toISOString() },
    { level: 'info', service: 'auth-service', errorCode: 'AUTH_001', timestamp: new Date().toISOString() } // Should be ignored
  ];

  const incidents = buildIncidents(logs);

  assert.strictEqual(incidents.length, 2);

  const authIncident = incidents.find(i => i.id === 'auth-service:AUTH_001');
  assert.ok(authIncident);
  assert.strictEqual(authIncident.eventCount, 2);
  assert.strictEqual(authIncident.service, 'auth-service');
  assert.strictEqual(authIncident.errorCode, 'AUTH_001');

  const dbIncident = incidents.find(i => i.id === 'db-service:DB_001');
  assert.ok(dbIncident);
  assert.strictEqual(dbIncident.eventCount, 1);
});

test('buildIncidents should sort incidents by score descending', () => {
  // A highly frequent error with multiple services should score higher
  const now = Date.now();
  const logs = [
    { level: 'error', service: 'service-a', errorCode: 'ERR_1', timestamp: new Date(now).toISOString() },

    // many events for service-b ERR_2 to give it a higher score
    { level: 'error', service: 'service-b', errorCode: 'ERR_2', timestamp: new Date(now).toISOString() },
    { level: 'error', service: 'service-b', errorCode: 'ERR_2', timestamp: new Date(now).toISOString() },
    { level: 'error', service: 'service-b', errorCode: 'ERR_2', timestamp: new Date(now).toISOString() },
    { level: 'error', service: 'service-b', errorCode: 'ERR_2', timestamp: new Date(now).toISOString() },
  ];

  const incidents = buildIncidents(logs);

  assert.strictEqual(incidents.length, 2);

  // Incident 0 should be ERR_2 due to higher frequency
  assert.strictEqual(incidents[0].errorCode, 'ERR_2');
  assert.strictEqual(incidents[1].errorCode, 'ERR_1');
  assert.ok(incidents[0].score >= incidents[1].score);
});

test('buildIncidents should ignore non-error logs', () => {
  const logs = [
    { level: 'info', service: 'auth-service', errorCode: 'AUTH_001', timestamp: new Date().toISOString() },
    { level: 'warn', service: 'auth-service', errorCode: 'AUTH_002', timestamp: new Date().toISOString() },
    { level: 'debug', service: 'auth-service', errorCode: 'AUTH_003', timestamp: new Date().toISOString() }
  ];

  const incidents = buildIncidents(logs);
  assert.strictEqual(incidents.length, 0);
});

test('buildIncidents should set correct properties on each incident object', () => {
  const timestamp = new Date().toISOString();
  const logs = [
    { level: 'error', service: 'test-service', errorCode: 'TEST_01', timestamp: timestamp }
  ];

  const incidents = buildIncidents(logs);
  assert.strictEqual(incidents.length, 1);
  const incident = incidents[0];

  assert.strictEqual(incident.id, 'test-service:TEST_01');
  assert.strictEqual(incident.service, 'test-service');
  assert.strictEqual(incident.errorCode, 'TEST_01');
  assert.strictEqual(incident.eventCount, 1);
  assert.strictEqual(incident.latestTimestamp, timestamp);
  assert.strictEqual(typeof incident.score, 'number');
  assert.ok(['low', 'medium', 'high', 'critical'].includes(incident.severity));
  assert.strictEqual(typeof incident.summary, 'string');
});
