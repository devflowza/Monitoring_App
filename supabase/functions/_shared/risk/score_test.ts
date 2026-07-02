import { assertEquals } from 'jsr:@std/assert@1';
import { computeRisk } from './score.ts';

Deno.test('empty factors → zero / low', () => {
  const r = computeRisk([], {});
  assertEquals(r.totalScore, 0);
  assertEquals(r.tier, 'low');
});

Deno.test('all factors saturated → 100 / critical, breakdown sums to total', () => {
  const weights = { a: 2, b: 1 };
  const r = computeRisk([{ key: 'a', value: 1 }, { key: 'b', value: 1 }], weights);
  assertEquals(r.totalScore, 100);
  assertEquals(r.tier, 'critical');
  const sum = Object.values(r.breakdown).reduce((s, v) => s + v.contribution, 0);
  assertEquals(sum, 100); // transparency invariant
});

Deno.test('values are clamped to [0,1]', () => {
  const r = computeRisk([{ key: 'a', value: 5 }], { a: 1 });
  assertEquals(r.totalScore, 100);
});

Deno.test('tiers map by threshold', () => {
  assertEquals(computeRisk([{ key: 'a', value: 0.3 }], { a: 1 }).tier, 'elevated');
  assertEquals(computeRisk([{ key: 'a', value: 0.6 }], { a: 1 }).tier, 'high');
});
