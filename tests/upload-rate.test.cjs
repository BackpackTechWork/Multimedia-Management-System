const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../public/js/drive.js'), 'utf8');
const start = source.indexOf('  function createRecentUploadRateTracker(');
const end = source.indexOf('\n  function startUploadSession()', start);
assert.ok(start >= 0 && end > start);
const factory = vm.runInNewContext(`(${source.slice(start, end).trim()})`);

test('rate excludes bytes uploaded before sampling began', () => {
  const tracker = factory();
  assert.equal(tracker.sample(10_000_000_000, 0), null);
  assert.equal(tracker.sample(10_030_000_000, 3000), 10_000_000);
});

test('recent rate recovers after a long stall instead of retaining the session average', () => {
  const tracker = factory();
  for (let time = 0; time <= 120000; time += 1000) tracker.sample(100_000_000, time);
  let rate;
  for (let time = 121000; time <= 151000; time += 1000) rate = tracker.sample(100_000_000 + (time - 120000) * 10000, time);
  assert.equal(rate, 10_000_000);
});

test('pause/resume resets exclude both paused time and progress from before the pause', () => {
  const tracker = factory();
  tracker.sample(0, 0);
  assert.equal(tracker.sample(30_000_000, 3000), 10_000_000);
  tracker.reset();
  assert.equal(tracker.sample(30_000_000, 3_603_000), null);
  assert.equal(tracker.sample(45_000_000, 3_606_000), 5_000_000);
});

test('idle ticks decay to zero after the recent window and byte corrections reset the baseline', () => {
  const tracker = factory();
  tracker.sample(0, 0);
  tracker.sample(30_000_000, 3000);
  let rate;
  for (let time = 4000; time <= 34000; time += 1000) rate = tracker.sample(30_000_000, time);
  assert.equal(rate, 0);
  assert.equal(tracker.sample(20_000_000, 35000), null);
  assert.equal(tracker.sample(23_000_000, 38000), 1_000_000);
});

test('clock rollback resets the baseline instead of creating negative or infinite speed', () => {
  const tracker = factory();
  tracker.sample(0, 10000);
  assert.equal(tracker.sample(1000, 5000), null);
  assert.equal(tracker.sample(4000, 8000), 1000);
});

test('upload lifecycle resets and periodic sampling are wired into the displayed estimate', () => {
  assert.match(source, /uploadSummaryTimer = setInterval\(\(\) => updateUploadSummary\(\), 1000\)/);
  assert.match(source, /function pauseUpload[\s\S]*?uploadRateTracker\.reset\(\)/);
  assert.match(source, /function resumeUpload[\s\S]*?uploadRateTracker\.reset\(\)/);
  assert.match(source, /function finishUploadSession[\s\S]*?clearInterval\(uploadSummaryTimer\)/);
  assert.doesNotMatch(source, /uploadedBytes \/ elapsedSeconds/);
});
