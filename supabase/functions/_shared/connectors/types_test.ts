import { assertEquals } from 'jsr:@std/assert@1';
import { classifyAddress } from './types.ts';

Deno.test('internal address', () => {
  const r = classifyAddress('a@visionfreights.com', ['visionfreights.com'], ['gmail.com']);
  assertEquals(r.isInternal, true);
  assertEquals(r.isPersonal, false);
});

Deno.test('personal external address', () => {
  const r = classifyAddress('x@gmail.com', ['visionfreights.com'], ['gmail.com']);
  assertEquals(r.isInternal, false);
  assertEquals(r.isPersonal, true);
});

Deno.test('unknown external address', () => {
  const r = classifyAddress('y@competitor.com', ['visionfreights.com'], ['gmail.com']);
  assertEquals(r.isInternal, false);
  assertEquals(r.isPersonal, false);
});

Deno.test('null address is safe', () => {
  const r = classifyAddress(null, ['visionfreights.com'], ['gmail.com']);
  assertEquals(r.isInternal, false);
  assertEquals(r.isPersonal, false);
});
