// scripts/test_signal_classify.mjs
// Pure-function boundary tests for classifyEngagement. No DOM, no timers,
// no framework — matches this repo's zero-build-step philosophy.
// Run with: node scripts/test_signal_classify.mjs
import assert from 'node:assert/strict';
import { classifyEngagement } from '../public/js/engines/signal-detection.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
}

console.log('classifyEngagement:');

test('below sprint_ready threshold on the picker returns null', () => {
  const r = classifyEngagement({ activeStreakTicks: 23, activeMode: null, tabSwitchesThisTick: 0, lastHyperfocusFireTick: 0 });
  assert.equal(r, null);
});

test('at sprint_ready threshold on the picker fires sprint_ready', () => {
  const r = classifyEngagement({ activeStreakTicks: 24, activeMode: null, tabSwitchesThisTick: 0, lastHyperfocusFireTick: 0 });
  assert.deepEqual(r, { label: 'sprint_ready', confidence: 0.55 });
});

test('sprint_ready threshold crossed but a mode is active returns null', () => {
  const r = classifyEngagement({ activeStreakTicks: 100, activeMode: 'freeze_rescue', tabSwitchesThisTick: 0, lastHyperfocusFireTick: 0 });
  assert.equal(r, null);
});

test('below hyperfocus threshold in a sprint returns null', () => {
  const r = classifyEngagement({ activeStreakTicks: 539, activeMode: 'focus_sprint', tabSwitchesThisTick: 0, lastHyperfocusFireTick: 0 });
  assert.equal(r, null);
});

test('at hyperfocus threshold in a sprint fires hyperfocus', () => {
  const r = classifyEngagement({ activeStreakTicks: 540, activeMode: 'focus_sprint', tabSwitchesThisTick: 0, lastHyperfocusFireTick: 0 });
  assert.deepEqual(r, { label: 'hyperfocus', confidence: 0.6 });
});

test('hyperfocus threshold crossed but not in a sprint returns null', () => {
  const r = classifyEngagement({ activeStreakTicks: 540, activeMode: null, tabSwitchesThisTick: 0, lastHyperfocusFireTick: 0 });
  assert.equal(r, null);
});

test('re-fire before the 30min delta returns null', () => {
  const r = classifyEngagement({ activeStreakTicks: 719, activeMode: 'focus_sprint', tabSwitchesThisTick: 0, lastHyperfocusFireTick: 540 });
  assert.equal(r, null); // 719 - 540 = 179 ticks, one short of 180
});

test('re-fire at exactly the 30min delta fires again', () => {
  const r = classifyEngagement({ activeStreakTicks: 720, activeMode: 'focus_sprint', tabSwitchesThisTick: 0, lastHyperfocusFireTick: 540 });
  assert.deepEqual(r, { label: 'hyperfocus', confidence: 0.6 });
});

test('re-fire uses the gap since last fire, not alignment to a fixed grid', () => {
  // lastHyperfocusFireTick=550 is NOT a multiple of 180 (simulating an
  // earlier fire that landed on a delayed/irregular tick). A naive modulo
  // check (activeStreakTicks % 180 === 0) would miss this boundary
  // entirely (730 % 180 = 10, not 0) — the delta check still fires
  // correctly because the actual gap (730-550=180) has been reached.
  const r = classifyEngagement({ activeStreakTicks: 730, activeMode: 'focus_sprint', tabSwitchesThisTick: 0, lastHyperfocusFireTick: 550 });
  assert.deepEqual(r, { label: 'hyperfocus', confidence: 0.6 });
});

test('tab-switch distress on this tick suppresses sprint_ready even past threshold', () => {
  const r = classifyEngagement({ activeStreakTicks: 100, activeMode: null, tabSwitchesThisTick: 3, lastHyperfocusFireTick: 0 });
  assert.equal(r, null);
});

test('2 tab-switches this tick (below the 3+ distress floor) does not suppress', () => {
  const r = classifyEngagement({ activeStreakTicks: 24, activeMode: null, tabSwitchesThisTick: 2, lastHyperfocusFireTick: 0 });
  assert.deepEqual(r, { label: 'sprint_ready', confidence: 0.55 });
});

console.log(`\n${passed} passed`);
