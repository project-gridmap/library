import assert from 'node:assert/strict';
import test from 'node:test';
import { createChapterLoader } from '../demo/chapter-source.js';

const cell = { id: 'RUT/2', itemId: 'RUT', label: '2' };
const payload = { translation: { name: 'World English Bible' }, verses: [
  { book_id: 'RUT', chapter: 2, verse: 1, text: ' First verse.\n' },
  { book_id: 'RUT', chapter: 2, verse: 2, text: ' Second\nverse. ' },
] };

test('live loader uses the explicit chapter endpoint and caches successful chapters', async () => {
  const calls = [];
  const load = createChapterLoader({ fetcher: async (...args) => {
    calls.push(args); return { ok: true, json: async () => payload };
  } });
  const controller = new AbortController();
  const chapter = await load(cell, { signal: controller.signal });
  assert.deepEqual(chapter.verses, ['First verse.', 'Second verse.']);
  assert.equal(calls[0][0], 'https://bible-api.com/data/web/RUT/2');
  assert.equal(calls[0][1].signal, controller.signal);
  assert.equal(await load(cell), chapter);
  assert.equal(calls.length, 1);
});

test('failed and rate-limited requests can be retried without a poisoned cache', async () => {
  let attempts = 0;
  const load = createChapterLoader({ fetcher: async () => ++attempts === 1
    ? { ok: false, status: 429 } : { ok: true, json: async () => payload } });
  await assert.rejects(load(cell), (error) => /wait a moment/.test(error.message) && error.retryAfterMs >= 30000);
  assert.equal((await load(cell)).verses.length, 2);
  assert.equal(attempts, 2);
});

test('mismatched chapters and missing or unordered verses are rejected', async () => {
  for (const verses of [[], [payload.verses[1]], [{ ...payload.verses[0], chapter: 3 }],
    [{ ...payload.verses[0], book_id: 'GEN' }], [{ ...payload.verses[0], text: '' }]]) {
    const load = createChapterLoader({ fetcher: async () => ({ ok: true, json: async () => ({ verses }) }) });
    await assert.rejects(load(cell), /could not be verified/);
  }
});

test('cancellation cannot populate the success cache even if a server ignores abort', async () => {
  let resolve, calls = 0;
  const load = createChapterLoader({ fetcher: () => {
    calls++;
    if (calls > 1) return Promise.resolve({ ok: true, json: async () => payload });
    return new Promise((done) => { resolve = done; });
  } });
  const controller = new AbortController();
  const pending = load(cell, { signal: controller.signal });
  controller.abort(); resolve({ ok: true, json: async () => payload });
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal((await load(cell)).verses.length, 2);
  assert.equal(calls, 2);
});
