// Replace this loader with the host app's passage service when embedding the demo.
// Only complete, validated chapters are cached; failures remain retryable.
export function createChapterLoader({ fetcher = fetch, baseUrl = 'https://bible-api.com', translation = 'web' } = {}) {
  const cache = new Map();
  return async (cell, { signal } = {}) => {
    const key = `${translation}:${cell.itemId}/${cell.label}`;
    if (cache.has(key)) return cache.get(key);
    const url = `${baseUrl.replace(/\/$/, '')}/data/${encodeURIComponent(translation)}/${encodeURIComponent(cell.itemId)}/${encodeURIComponent(cell.label)}`;
    const response = await fetcher(url, { signal, referrerPolicy: 'no-referrer' });
    if (!response.ok) {
      const error = new Error(response.status === 429 ? 'Please wait a moment, then retry.' : 'Chapter unavailable. Please retry.');
      if (response.status === 429) error.retryAfterMs = Math.max(30000, (Number(response.headers?.get('Retry-After')) || 0) * 1000);
      throw error;
    }
    const data = await response.json();
    if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
    const rows = data.verses;
    if (!Array.isArray(rows) || !rows.length || rows.some((verse, index) =>
      verse.book_id !== cell.itemId || Number(verse.chapter) !== Number(cell.label)
      || Number(verse.verse) !== index + 1 || typeof verse.text !== 'string' || !verse.text.trim())) {
      throw new Error('Chapter text could not be verified. Please retry.');
    }
    const chapter = { id: cell.id, translation: data.translation?.name ?? translation,
      source: url, verses: rows.map((verse) => verse.text.trim().replace(/\s+/g, ' ')) };
    if (cache.size >= 128) cache.delete(cache.keys().next().value);
    cache.set(key, chapter);
    return chapter;
  };
}
