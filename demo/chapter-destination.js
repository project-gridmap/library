// Every readable chapter in the prime book can become a passage.
export function chapterTextLayout(box, viewport, { retained = false, characterWidth = 9, progressive = false } = {}) {
  const left = Math.max(0, box.x), top = Math.max(0, box.y);
  const visibleWidth = Math.min(viewport.w, box.x + box.width) - left;
  const visibleHeight = Math.min(viewport.h, box.y + box.height) - top;
  if (visibleWidth <= 0 || visibleHeight <= 0) return null;
  const padding = progressive ? Math.max(4, Math.min(16, Math.min(visibleWidth, visibleHeight) * 0.08)) : 16;
  const width = Math.min(440, visibleWidth - padding * 2), height = visibleHeight - padding * 2;
  const fontSize = progressive ? Math.max(7, Math.min(14, (width - 12) / 15)) : 14;
  const lineHeight = Math.ceil(fontSize * 1.6);
  const headerHeight = progressive ? Math.max(14, Math.ceil(fontSize * 32 / 15)) : 32;
  const footerHeight = progressive ? Math.max(28, Math.ceil(fontSize * 64 / 14)) : 64;
  const rows = Math.max(0, Math.floor((height - headerHeight - footerHeight) / lineHeight));
  const characters = (width - 32) / Math.max(1, characterWidth);
  if (progressive) {
    if (visibleWidth < 36 || visibleHeight < 28) return null;
  } else if (characters < (retained ? 21 : 25) || rows < (retained ? 4 : 6)) return null;
  return { left: left + padding + (visibleWidth - padding * 2 - width) / 2, top: top + padding,
    width, height, fontSize, lineHeight, headerHeight, footerHeight, rows,
    skeletonOnly: progressive && (width < 48 || rows < 2),
    visibleArea: visibleWidth * visibleHeight, centerX: left + visibleWidth / 2, centerY: top + visibleHeight / 2 };
}

export function activeChapter(candidates, viewport, previousId = null) {
  if (!candidates.length) return null;
  const diagonal = Math.hypot(viewport.w, viewport.h) / 2;
  const score = ({ layout }) => layout.visibleArea / (viewport.w * viewport.h)
    * (1 - 0.45 * Math.min(1, Math.hypot(layout.centerX - viewport.w / 2, layout.centerY - viewport.h / 2) / diagonal));
  const ranked = candidates.map((candidate) => ({ ...candidate, score: score(candidate) })).sort((a, b) => b.score - a.score);
  const previous = ranked.find(({ cell }) => cell.id === previousId);
  return previous && ranked[0].score < previous.score * 1.25 ? previous.cell.id : ranked[0].cell.id;
}

export function activeBook(candidates, viewport, previousId = null) {
  const books = new Map();
  for (const { cell, layout } of candidates) {
    const book = books.get(cell.itemId) ?? { area: 0, x: 0, y: 0 };
    book.area += layout.visibleArea;
    book.x += layout.centerX * layout.visibleArea;
    book.y += layout.centerY * layout.visibleArea;
    books.set(cell.itemId, book);
  }
  // Centrality matters more than raw area: a narrow book such as Ruth should
  // remain prime when centred between much wider neighbours.
  const diagonal = Math.hypot(viewport.w, viewport.h) / 2;
  const ranked = [...books].map(([id, book]) => {
    const distance = Math.hypot(book.x / book.area - viewport.w / 2, book.y / book.area - viewport.h / 2) / diagonal;
    return { id, score: Math.sqrt(book.area / (viewport.w * viewport.h)) * Math.exp(-8 * distance * distance) };
  }).sort((a, b) => b.score - a.score);
  const previous = ranked.find(({ id }) => id === previousId);
  return previous && ranked[0].score < previous.score * 1.25 ? previous.id : ranked[0]?.id ?? null;
}

// The underlying chapter is untouched. Continuation punctuation is a display cue.
export function continuationText(text) {
  const value = text.trimEnd();
  const ending = /[.!?,;:…]+([”’"')\]]*)$/u;
  return ending.test(value) ? value.replace(ending, '…$1') : `${value}…`;
}

export function chapterTextPages(verses, width, rows, measure, { numberRatio = 11 / 15, reserve = 32, numberGap = 4 } = {}) {
  if (width <= 0 || rows < 1) return [];
  const lines = [];
  let offset = 0;
  verses.forEach((text, index) => {
    let line;
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const token = { text: word, verse: index + 1, verseStart: !line, offset: offset++ };
      const numberWidth = !line ? measure(String(index + 1)) * numberRatio + numberGap : 0;
      const added = measure(word) + numberWidth;
      if (!line || line.width + measure(' ') + added > width - reserve) {
        line = { tokens: [], width: 0 }; lines.push(line);
      }
      line.width += (line.tokens.length ? measure(' ') : 0) + added;
      line.tokens.push(token);
    }
  });
  const pages = [];
  for (let start = 0; start < lines.length;) {
    let end = Math.min(lines.length, start + rows);
    // Prefer a verse boundary near the bottom, without stranding most of a page.
    if (end < lines.length && !lines[end].tokens[0].verseStart) {
      for (let candidate = end - 1; candidate >= start + Math.ceil(rows * 0.6); candidate--) {
        if (lines[candidate].tokens[0].verseStart) { end = candidate; break; }
      }
    }
    const body = lines.slice(start, end);
    pages.push({ lines: body, start: body[0].tokens[0].offset,
      end: body.at(-1).tokens.at(-1).offset + 1 });
    start = end;
  }
  return pages;
}

export function installChapterDestination(map, { loadChapter, revealContent = false, dwellMs = 240,
  getRevealZoom = () => 0, onZoom = () => {}, requestIntervalMs = 0 } = {}) {
  const views = new Map(), bookmarks = new Map();
  let disposed = false, activeId = null, running = 0, lastCamera = null, allowRequests = true, lastRevealZoom;
  let nextRequestAt = 0, requestTimer;
  let activeBookId = null;

  function remove(view) {
    clearTimeout(view.dwell); clearTimeout(view.timeout);
    view.controller?.abort(); view.root.remove(); views.delete(view.id);
  }
  function introduce(view) {
    clearTimeout(view.dwell);
    view.dwell = setTimeout(() => {
      if (disposed || views.get(view.id) !== view) return;
      view.revealed = true; view.state = 'queued'; map.render();
    }, dwellMs);
  }
  function makeView(cell) {
    const root = document.createElement('section');
    root.setAttribute('data-chapter-id', cell.id); root.setAttribute('aria-label', `${cell.itemLabel} ${cell.label}`);
    Object.assign(root.style, { position: 'absolute', display: 'none', pointerEvents: 'none',
      fontSize: '14px', lineHeight: '23px', overflow: 'hidden', textTransform: 'none', letterSpacing: 'normal' });
    const reference = document.createElement('div'), body = document.createElement('div'), status = document.createElement('div');
    Object.assign(reference.style, { height: '32px', fontSize: '12px', letterSpacing: '.08em', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' });
    reference.textContent = `${cell.itemLabel} ${cell.label}`;
    Object.assign(body.style, { whiteSpace: 'nowrap', fontWeight: '400' });
    status.setAttribute('role', 'status');
    Object.assign(status.style, { fontSize: '12px', display: 'none', alignItems: 'center', gap: '8px' });
    const skeleton = document.createElement('div'), message = document.createElement('span'), retry = document.createElement('button');
    skeleton.setAttribute('aria-hidden', 'true');
    skeleton.setAttribute('data-chapter-skeleton', '');
    Object.assign(skeleton.style, { width: '100%', overflow: 'hidden' });
    retry.type = 'button'; retry.textContent = 'Retry';
    Object.assign(retry.style, { minHeight: '44px', pointerEvents: 'auto', textDecoration: 'underline' });
    const footer = document.createElement('nav'), previous = document.createElement('button'), next = document.createElement('button'), pageLabel = document.createElement('span');
    footer.setAttribute('aria-label', `${cell.itemLabel} ${cell.label} pages`);
    Object.assign(footer.style, { display: 'flex', height: '56px', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px' });
    previous.type = next.type = 'button';
    for (const [button, direction] of [[previous, 'left'], [next, 'right']]) {
      const caret = document.createElement('span'); caret.setAttribute('aria-hidden', 'true');
      Object.assign(caret.style, { display: 'inline-block', width: '.4em', height: '.4em',
        borderTop: '1.5px solid currentColor', borderRight: '1.5px solid currentColor',
        transform: `rotate(${direction === 'left' ? -135 : 45}deg)` });
      button.append(caret);
    }
    Object.assign(pageLabel.style, { fontWeight: '500', fontVariantNumeric: 'tabular-nums', letterSpacing: '.02em' });
    previous.setAttribute('aria-label', 'Previous chapter page'); next.setAttribute('aria-label', 'Next chapter page');
    for (const button of [previous, next, retry]) {
      Object.assign(button.style, { minWidth: '44px', minHeight: '44px', pointerEvents: 'auto' });
      if (button !== retry) button.style.fontSize = '22px';
      for (const type of ['pointerdown', 'pointerup', 'click', 'dblclick']) button.addEventListener(type, (event) => event.stopPropagation());
    }
    footer.append(previous, pageLabel, next); status.append(skeleton, message, retry);
    root.append(reference, body, status, footer); map.root.appendChild(root);
    const view = { id: cell.id, cell, root, reference, body, status, skeleton, message, retry, footer, previous, next, pageLabel,
      state: 'waiting', revealed: false, anchor: bookmarks.get(cell.id) ?? 0, pages: [], pageIndex: 0, key: '' };
    function turn(delta) {
      const page = view.pages[view.pageIndex + delta];
      if (!page || view.state !== 'ready') return;
      view.anchor = page.start; bookmarks.set(view.id, page.start); activeId = view.id; map.render();
    }
    previous.onclick = () => turn(-1); next.onclick = () => turn(1);
    for (const button of [previous, next]) button.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault(); event.stopPropagation(); turn(event.key === 'ArrowLeft' ? -1 : 1);
      }
    });
    retry.onclick = () => { view.state = 'queued'; view.key = ''; map.render(); };
    views.set(cell.id, view); introduce(view); return view;
  }
  function pump() {
    if (disposed || !allowRequests) return;
    if (views.get(activeId)?.state === 'waiting') return;
    const queued = [...views.values()].filter((view) => view.state === 'queued' && view.prefetch)
      .sort((a, b) => Number(b.id === activeId) - Number(a.id === activeId));
    for (const view of queued) {
      if (running >= 2) break;
      const delay = nextRequestAt - Date.now();
      if (delay > 0) {
        clearTimeout(requestTimer);
        requestTimer = setTimeout(() => { if (!disposed) map.render(); }, delay);
        break;
      }
      nextRequestAt = Date.now() + requestIntervalMs;
      view.state = 'loading'; view.controller = new AbortController(); running++;
      view.timeout = setTimeout(() => view.controller.abort(), 12000);
      Promise.resolve().then(() => loadChapter(view.cell, { signal: view.controller.signal })).then((chapter) => {
        if (disposed || views.get(view.id) !== view) return;
        if (!chapter.verses?.length) throw new Error('Chapter unavailable');
        view.verses = chapter.verses; view.state = 'ready';
      }).catch((error) => {
        if (disposed || views.get(view.id) !== view) return;
        if (error.retryAfterMs) {
          view.state = 'queued';
          nextRequestAt = Math.max(nextRequestAt, Date.now() + error.retryAfterMs);
          return;
        }
        view.state = 'error'; view.error = error.name === 'AbortError' ? 'Loading timed out.' : 'Chapter unavailable.';
      }).finally(() => {
        clearTimeout(view.timeout); running--;
        if (!disposed) map.render();
      });
    }
  }
  const removeLayer = map.addLayer(({ ctx, model, camera, toScreenX: X, toScreenY: Y, colourOf, theme }) => {
    const overview = map.frame?.(model.world, map.options?.layout === 'fit' ? 1 : 0.92);
    const zoom = camera.k / (overview?.k || camera.k);
    onZoom(zoom);
    const revealZoom = Math.max(0, Number(getRevealZoom()) || 0);
    if (lastRevealZoom !== undefined && revealZoom !== lastRevealZoom) {
      for (const view of [...views.values()]) remove(view);
      activeId = null;
    }
    lastRevealZoom = revealZoom;
    if (!revealContent) { for (const view of [...views.values()]) remove(view); activeId = null; return; }
    const viewport = map.viewport();
    ctx.font = `400 14px ${theme.font}`;
    const characterWidth = ctx.measureText('M').width;
    const project = (cell) => ({ x: X(cell.x), y: Y(cell.y), width: cell.width * camera.k, height: cell.height * camera.k });
    let candidates = [];
    for (const cell of model.cells) {
      if (map.isCellDisabled(cell)) continue;
      const view = views.get(cell.id), box = project(cell);
      const manual = revealZoom > 0;
      if (manual && zoom < revealZoom * (view?.textShown ? 0.88 : 1)) continue;
      const layout = chapterTextLayout(box, viewport, { characterWidth, retained: true, progressive: manual });
      if (!layout) continue;
      const readable = manual ? zoom >= revealZoom * (view?.textShown ? 0.88 : 1) && !layout.skeletonOnly
        : !!chapterTextLayout(box, viewport, { characterWidth, retained: view?.textShown });
      candidates.push({ cell, box, layout, readable, prefetch: true });
    }
    const keyboardBook = [...views.values()].find((view) =>
      document.activeElement?.matches?.(':focus-visible') && view.root.contains?.(document.activeElement))?.cell.itemId;
    activeBookId = keyboardBook && candidates.some(({ cell }) => cell.itemId === keyboardBook)
      ? keyboardBook : activeBook(candidates, viewport, activeBookId);
    candidates = candidates.filter(({ cell }) => cell.itemId === activeBookId);
    const eligible = new Set(candidates.map(({ cell }) => cell.id));
    for (const view of [...views.values()]) if (!eligible.has(view.id)) remove(view);
    const moving = map.gesture || map.drag?.moved || (lastCamera &&
      (Math.hypot(camera.cx - lastCamera.cx, camera.cy - lastCamera.cy) * camera.k > 3
        || Math.abs(Math.log(camera.k / lastCamera.k)) > 0.015));
    lastCamera = { ...camera }; allowRequests = !map.gesture && !map.drag?.moved;
    for (const candidate of candidates) {
      const view = views.get(candidate.cell.id) ?? makeView(candidate.cell);
      view.cell = candidate.cell; view.prefetch = candidate.prefetch;
      if (moving && !view.revealed) introduce(view);
    }
    const revealed = candidates.filter(({ cell }) => views.get(cell.id)?.revealed);
    const focused = activeId && document.activeElement?.matches?.(':focus-visible')
      && views.get(activeId)?.root.contains?.(document.activeElement);
    activeId = focused && revealed.some(({ cell }) => cell.id === activeId)
      ? activeId : activeChapter(candidates, viewport, activeId);
    pump();
    for (const { cell, box, layout, readable } of candidates) {
      const view = views.get(cell.id);
      const accent = colourOf(cell, theme.mutedText);
      const item = model.items?.[cell.itemIndex];
      const section = map.options?.showSections ? model.sections?.[cell.sectionIndex] : null;
      // Erase the chapter mark using its own geographic surface. Keep the
      // existing boundary, including selection, without introducing a reader fill.
      ctx.save(); ctx.globalAlpha = 1;
      ctx.clearRect(box.x + 2, box.y + 2, box.width - 4, box.height - 4);
      ctx.fillStyle = item ? map.surfaceBackground(item, section) : theme.background;
      ctx.fillRect(box.x + 2, box.y + 2, box.width - 4, box.height - 4); ctx.restore();
      Object.assign(view.root.style, { display: 'block', left: `${layout.left}px`, top: `${layout.top}px`,
        width: `${layout.width}px`, height: `${layout.height}px`, fontFamily: theme.font, color: theme.text,
        fontSize: `${layout.fontSize}px`, lineHeight: `${layout.lineHeight}px` });
      view.root.setAttribute('aria-busy', String(['waiting', 'queued', 'loading'].includes(view.state)));
      view.reference.style.color = view.footer.style.color = view.status.style.color = accent;
      view.reference.style.opacity = '.8'; view.body.style.opacity = '.9';
      const showText = view.state === 'ready' && readable && view.revealed;
      view.textShown = showText;
      view.reference.style.height = `${layout.headerHeight}px`;
      view.reference.style.fontSize = `${Math.max(7, layout.fontSize * 0.8)}px`;
      view.body.style.display = showText ? 'block' : 'none';
      view.body.style.height = `${layout.rows * layout.lineHeight}px`;
      view.status.style.display = showText ? 'none' : 'block';
      view.status.style.fontSize = `${Math.min(12, layout.fontSize)}px`;
      const skeletonHeight = Math.max(0, layout.height - layout.headerHeight - (layout.skeletonOnly ? 0 : layout.footerHeight));
      view.status.style.height = `${skeletonHeight}px`;
      view.footer.style.height = `${layout.footerHeight}px`;
      view.footer.style.fontSize = `${Math.max(10, layout.fontSize * 15 / 14)}px`;
      view.pageLabel.style.display = layout.width < 110 ? 'none' : '';
      for (const button of [view.previous, view.next]) Object.assign(button.style, {
        minWidth: `${Math.min(44, layout.width / 3)}px`, minHeight: `${layout.footerHeight}px`,
        fontSize: `${Math.max(20, layout.fontSize * 32 / 14)}px` });
      const numberSize = Math.max(6, layout.fontSize * 11 / 15), numberGap = layout.fontSize < 11 ? 2 : 4;
      ctx.font = `400 ${layout.fontSize}px ${theme.font}`;
      if (showText) {
        const key = `${layout.width.toFixed(1)}:${layout.rows}:${layout.fontSize}:${theme.font}:${accent}:${view.anchor}`;
        if (view.key !== key) {
          view.pages = chapterTextPages(view.verses, layout.width, layout.rows, (text) => ctx.measureText(text).width, { numberRatio: numberSize / layout.fontSize, reserve: layout.fontSize * 32 / 15, numberGap });
          view.pageIndex = Math.max(0, view.pages.findIndex((page) => view.anchor >= page.start && view.anchor < page.end));
          const page = view.pages[view.pageIndex], more = view.pageIndex < view.pages.length - 1;
          view.body.replaceChildren();
          page.lines.forEach((line, rowIndex) => {
            const row = document.createElement('div'); row.style.height = `${layout.lineHeight}px`;
            line.tokens.forEach((token, index) => {
              if (index) row.append(' ');
              if (token.verseStart || (rowIndex === 0 && index === 0)) {
                const number = document.createElement('sub'); number.textContent = String(token.verse);
                Object.assign(number.style, { fontSize: `${numberSize}px`, lineHeight: '0', verticalAlign: 'baseline', position: 'relative', top: `${Math.max(1, layout.fontSize * 2 / 15)}px`, marginRight: `${numberGap}px`, color: accent });
                row.append(number);
              }
              const last = rowIndex === page.lines.length - 1 && index === line.tokens.length - 1;
              row.append(last && more ? continuationText(token.text) : token.text);
            });
            view.body.append(row);
          });
          view.pageLabel.textContent = `${view.pageIndex + 1} / ${view.pages.length}`;
          view.previous.disabled = view.pageIndex === 0; view.next.disabled = !more;
          view.previous.style.opacity = view.previous.disabled ? '.25' : '1'; view.next.style.opacity = view.next.disabled ? '.25' : '1';
          view.key = key;
        }
      }
      const controls = showText && view.pages.length > 0;
      view.footer.style.visibility = controls ? 'visible' : 'hidden';
      view.retry.style.display = view.state === 'error' ? 'block' : 'none';
      const preparing = !showText && view.state !== 'error';
      view.message.textContent = view.state === 'error' ? view.error
        : view.state === 'ready' ? 'Zoom closer for chapter text.' : 'Loading chapter…';
      Object.assign(view.message.style, preparing ? { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clipPath: 'inset(50%)' }
        : { position: 'static', width: 'auto', height: 'auto', overflow: 'visible', clipPath: 'none' });
      view.skeleton.style.display = preparing ? 'block' : 'none';
      const skeletonKey = `${layout.width}:${skeletonHeight}:${layout.lineHeight}`;
      if (preparing && view.skeletonKey !== skeletonKey) {
        view.skeleton.replaceChildren();
        const count = Math.max(1, Math.min(6, Math.floor(skeletonHeight / layout.lineHeight)));
        for (let index = 0; index < count; index++) {
          const line = document.createElement('div');
          Object.assign(line.style, { height: `${layout.lineHeight}px`, display: 'flex', alignItems: 'center',
            gap: `${layout.fontSize * 0.5}px`, width: `${index === count - 1 ? 62 : 94}%`, opacity: '.22' });
          // Short word-like strokes suggest a manuscript's rhythm without
          // pretending to know its verse lengths before the chapter arrives.
          for (let word = 0; word < 5; word++) {
            const stroke = document.createElement('span');
            Object.assign(stroke.style, { flex: `${[3, 5, 2, 4, 6][(index + word) % 5]} 1 0`,
              height: `${Math.max(1, layout.fontSize * 0.24)}px`, background: 'currentColor' });
            line.append(stroke);
          }
          view.skeleton.append(line);
        }
        view.skeleton.style.height = `${skeletonHeight}px`;
        view.skeletonKey = skeletonKey;
      }
    }
  });
  return () => { disposed = true; clearTimeout(requestTimer); for (const view of [...views.values()]) remove(view); removeLayer(); };
}
