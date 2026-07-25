// scripts/test_signal_engine.mjs
// Stateful SignalDetectionEngine tests: active-streak bookkeeping,
// enterMode/clearActiveMode, and simulateTicks-driven end-to-end firing.
// Run with: node scripts/test_signal_engine.mjs
import assert from 'node:assert/strict';
import { SignalDetectionEngine } from '../public/js/engines/signal-detection.js';

// The dispatch path calls localStorage.getItem, which doesn't exist in
// plain Node — stub it. Module import itself never touches it (only
// firing a state-detected event does), so a plain top-level assignment
// here (before any test runs) is sufficient.
globalThis.localStorage = { getItem: () => null };

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
}

function freshEngine() {
  const e = new SignalDetectionEngine();
  e.lastActivity = Date.now(); // "just active" baseline; start() is never
  return e;                    // called, so no real DOM listeners attach
}

console.log('SignalDetectionEngine:');

test('simulateTicks accumulates activeStreakTicks while continuously active', () => {
  const e = freshEngine();
  e.simulateTicks(5);
  assert.equal(e.activeStreakTicks, 5);
});

test('sprint_ready fires exactly once when the streak crosses the floor', () => {
  const e = freshEngine();
  const fired = [];
  e.addEventListener('state-detected', (ev) => fired.push(ev.detail.label));
  e.simulateTicks(24); // exactly SPRINT_READY_STREAK_TICKS
  e.simulateTicks(24); // stays crossed for a while longer
  assert.deepEqual(fired, ['sprint_ready']); // only once, not every tick
});

test('sprint_ready never fires while a mode is active', () => {
  const e = freshEngine();
  e.enterMode('freeze_rescue');
  const fired = [];
  e.addEventListener('state-detected', (ev) => fired.push(ev.detail.label));
  e.simulateTicks(30);
  assert.deepEqual(fired, []);
});

test('clearActiveMode lets sprint_ready fire if the streak already qualifies', () => {
  const e = freshEngine();
  e.enterMode('freeze_rescue');
  e.simulateTicks(30); // streak keeps building even while a mode is active
  e.clearActiveMode();
  const fired = [];
  e.addEventListener('state-detected', (ev) => fired.push(ev.detail.label));
  e.simulateTicks(1);
  assert.deepEqual(fired, ['sprint_ready']);
});

test('hyperfocus fires once at the 90min floor, then again after the 30min re-fire gap', () => {
  const e = freshEngine();
  e.enterMode('focus_sprint');
  const fired = [];
  e.addEventListener('state-detected', (ev) => fired.push(ev.detail.label));
  e.simulateTicks(540); // exactly HYPERFOCUS_STREAK_TICKS
  assert.deepEqual(fired, ['hyperfocus']);
  e.simulateTicks(179); // one tick short of the 30min re-fire gap
  assert.deepEqual(fired, ['hyperfocus']);
  e.simulateTicks(1); // now exactly at the gap
  assert.deepEqual(fired, ['hyperfocus', 'hyperfocus']);
});

test('a real idle period (90s+) resets the active streak', () => {
  const e = freshEngine();
  e.enterMode('focus_sprint');
  e.simulateTicks(50);
  assert.equal(e.activeStreakTicks, 50);
  e.lastActivity = Date.now() - 95_000; // 95s stale — past INACTIVITY_THRESHOLD_MS
  e.simulateTicks(1);
  assert.equal(e.activeStreakTicks, 0);
});

test('3+ tab-switches in one tick resets the streak (distress override)', () => {
  const e = freshEngine();
  e.simulateTicks(10);
  assert.equal(e.activeStreakTicks, 10);
  e.tabSwitchesThisTick = 3;
  e.simulateTicks(1);
  assert.equal(e.activeStreakTicks, 0);
});

test('2 tab-switches in one tick does not reset the streak', () => {
  const e = freshEngine();
  e.simulateTicks(10);
  e.tabSwitchesThisTick = 2;
  e.simulateTicks(1);
  assert.equal(e.activeStreakTicks, 11);
});

console.log(`\n${passed} passed`);
