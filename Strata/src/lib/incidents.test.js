import { test, describe } from 'node:test';
import assert from 'node:assert';
import { scoreIncident } from './incidents.js';

describe('scoreIncident', () => {
  const createEvent = (service, timestampOffsetMs) => ({
    service,
    timestamp: new Date(Date.now() - timestampOffsetMs).toISOString(),
  });

  const createLog = (service) => ({ service });

  test('calculates base score for a single recent event', () => {
    // 1 event = 18 frequencyWeight
    // Recent (0 min) = 33 recencyWeight (35 - 1*2)
    // 1 service spread = 10
    // 1 ecosystem noise = 3
    // Total = 18 + 33 + 10 + 3 = 64
    const events = [createEvent('web', 0)];
    const allLogs = [createLog('web')];

    const score = scoreIncident(events, allLogs);
    assert.strictEqual(score, 64);
  });

  test('caps frequencyWeight at 45', () => {
    // 3 events = 45 frequencyWeight (3 * 18 = 54, max 45)
    // Recent = 33 recencyWeight
    // 1 service = 10
    // 1 ecosystem noise = 3
    // Total = 45 + 33 + 10 + 3 = 91
    const events = [
      createEvent('web', 0),
      createEvent('web', 0),
      createEvent('web', 0),
    ];
    const allLogs = [createLog('web')];

    const score = scoreIncident(events, allLogs);
    assert.strictEqual(score, 91);
  });

  test('calculates correct recencyWeight based on time elapsed', () => {
    // 1 event, 10 minutes ago
    // recencyWeight = Math.max(10, 35 - 10 * 2) = 15
    // frequencyWeight = 18
    // service spread = 10
    // ecosystem noise = 3
    // Total = 18 + 15 + 10 + 3 = 46
    const events = [createEvent('web', 10 * 60_000)];
    const allLogs = [createLog('web')];

    const score = scoreIncident(events, allLogs);
    assert.strictEqual(score, 46);
  });

  test('caps recencyWeight at a minimum of 10 for very old events', () => {
    // 1 event, 30 minutes ago
    // recencyWeight = Math.max(10, 35 - 30 * 2) = Math.max(10, -25) = 10
    // frequencyWeight = 18
    // service spread = 10
    // ecosystem noise = 3
    // Total = 18 + 10 + 10 + 3 = 41
    const events = [createEvent('web', 30 * 60_000)];
    const allLogs = [createLog('web')];

    const score = scoreIncident(events, allLogs);
    assert.strictEqual(score, 41);
  });

  test('increases score with higher serviceSpread and ecosystemNoise', () => {
    // 2 events across 2 services = 36 frequencyWeight
    // Recent = 33 recencyWeight
    // 2 services spread = 20
    // 4 ecosystem noise = 12
    // Total = 36 + 33 + 20 + 12 = 101 -> capped at 100
    const events = [
      createEvent('web', 0),
      createEvent('db', 0),
    ];
    const allLogs = [
      createLog('web'),
      createLog('db'),
      createLog('cache'),
      createLog('auth'),
    ];

    const score = scoreIncident(events, allLogs);
    assert.strictEqual(score, 100);
  });

  test('caps total score at 100', () => {
    // Make sure it doesn't exceed 100 even with many events and services
    const events = [
      createEvent('web', 0),
      createEvent('db', 0),
      createEvent('cache', 0),
      createEvent('auth', 0),
    ];
    const allLogs = [
      createLog('web'),
      createLog('db'),
      createLog('cache'),
      createLog('auth'),
      createLog('search'),
    ];

    const score = scoreIncident(events, allLogs);
    assert.strictEqual(score, 100);
  });
});
