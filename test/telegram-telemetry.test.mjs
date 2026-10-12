import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { telegramText } from '../dist/server/server/workers.js';

// Canonical fixture contract: cases[].name, payload, expected_lines and forbidden_text.
// Inputs are explicit local files; no deployment environment or credentials are read.
const fixture = JSON.parse(readFileSync(new URL('./inputs/telegram-telemetry.example.json', import.meta.url), 'utf8'));
assert.ok(Array.isArray(fixture.cases), 'cases must be an array');
for (const [index, entry] of fixture.cases.entries()) {
  assert.equal(typeof entry.name, 'string', `cases.${index}.name must be a string`);
  assert.ok(entry.payload && typeof entry.payload === 'object', `cases.${index}.payload must be an object`);
  assert.ok(Array.isArray(entry.expected_lines), `cases.${index}.expected_lines must be an array`);
  assert.ok(Array.isArray(entry.forbidden_text), `cases.${index}.forbidden_text must be an array`);
  test(entry.name, () => {
    const original = JSON.stringify(entry.payload);
    const text = telegramText(entry.payload);
    for (const expected of entry.expected_lines) assert.ok(text.includes(expected), `Missing expected message: ${expected}`);
    for (const forbidden of entry.forbidden_text) assert.ok(!text.includes(forbidden), `Unexpected technical wording: ${forbidden}`);
    assert.equal(JSON.stringify(entry.payload), original, 'Formatting must preserve the original diagnostics');
    assert.ok(text.length <= 4096);
  });
}
