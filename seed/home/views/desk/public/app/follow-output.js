// Follow a chat's output until the reader deliberately leaves the end. Scroll
// events alone aren't intent: layout, highlighting and browser anchoring move
// the viewport too. Each chat owns its controller (page and panel can coexist).
export function followOutput(scroller, content, onChange) {
  const slack = 2;
  let following = true, headingDown = false, dragging = false, touch = null;
  let pointerDown = false, announceFrame = null;
  let lastTop = scroller.scrollTop;
  const events = new AbortController();
  const listen = (node, name, fn) => node.addEventListener(name, fn, { passive: true, signal: events.signal });
  const distance = () => scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
  const announce = () => { announceFrame = null; onChange(following); };
  const setMode = (next) => {
    if (following === next) return;
    following = next;
    // A focus-induced scroll can pause during mousedown. Don't put Latest
    // under that pointer before mouseup: it would steal the disclosure click.
    if (!pointerDown) { cancelAnimationFrame(announceFrame); announce(); }
  };
  const pin = () => {
    if (!following || !scroller.getClientRects().length) return;
    if (Math.abs(distance()) > slack) scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    lastTop = scroller.scrollTop;
  };
  const pause = () => { headingDown = false; setMode(false); };
  const follow = () => { headingDown = false; setMode(true); pin(); };

  // Scrolling within a tool's output or code block doesn't leave the chat's end.
  const nestedScrolls = (target, delta) => {
    for (let el = target instanceof Element ? target : null; el && el !== scroller; el = el.parentElement) {
      if (!/^(auto|scroll)$/.test(getComputedStyle(el).overflowY)) continue;
      if (delta < 0 ? el.scrollTop > 0 : el.scrollHeight - el.clientHeight - el.scrollTop > slack) return true;
    }
    return false;
  };
  const intent = (target, delta) => {
    if (!delta || nestedScrolls(target, delta)) return;
    headingDown = delta > 0;
    if (!headingDown && scroller.scrollHeight > scroller.clientHeight) setMode(false);
  };
  listen(scroller, 'wheel', (e) => {
    if (!e.ctrlKey && Math.abs(e.deltaY) >= Math.abs(e.deltaX)) intent(e.target, e.deltaY);
  });
  listen(scroller, 'touchstart', (e) => {
    const p = e.touches.length === 1 ? e.touches[0] : null;
    touch = p ? { x: p.clientX, y: p.clientY, target: e.target } : null;
  });
  listen(scroller, 'touchmove', (e) => {
    if (!touch || e.touches.length !== 1) { touch = null; return; }
    const p = e.touches[0], dx = touch.x - p.clientX, dy = touch.y - p.clientY;
    if (Math.abs(dy) >= Math.abs(dx)) intent(touch.target, dy);
    touch.x = p.clientX; touch.y = p.clientY;
  });
  listen(scroller, 'touchend', () => { touch = null; });
  listen(scroller, 'touchcancel', () => { touch = null; });
  listen(scroller, 'keydown', (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    // Space activates buttons and disclosure rows; it only scrolls the viewport itself.
    if (e.key === ' ' && e.target !== scroller) return;
    if (['ArrowUp', 'PageUp', 'Home'].includes(e.key) || (e.key === ' ' && e.shiftKey)) intent(e.target, -1);
    else if (['ArrowDown', 'PageDown', 'End', ' '].includes(e.key)) intent(e.target, 1);
  });
  listen(scroller, 'focusin', (e) => {
    if (!(e.target instanceof Element) || e.target === scroller) return;
    const view = scroller.getBoundingClientRect(), box = e.target.getBoundingClientRect();
    // Chromium may already have scrolled the focused control into view before
    // focusin; WebKit does it afterward. Both are deliberate navigation.
    if (box.top < view.top || box.bottom > view.bottom || scroller.scrollTop < lastTop - slack) pause();
  });
  listen(scroller, 'pointerdown', (e) => {
    pointerDown = true;
    dragging = e.pointerType === 'mouse' && e.target === scroller;
    if (dragging) pause();
  });
  const release = () => {
    if (!pointerDown) return;
    pointerDown = false; dragging = false;
    cancelAnimationFrame(announceFrame);
    announceFrame = requestAnimationFrame(announce);
  };
  listen(window, 'pointerup', release);
  listen(window, 'pointercancel', release);
  listen(scroller, 'scroll', () => {
    const top = scroller.scrollTop;
    if (dragging && top !== lastTop) {
      headingDown = top > lastTop;
      if (!headingDown) setMode(false);
    }
    lastTop = top;
    if (following) pin();
    else if (headingDown && distance() <= slack) setMode(true);
  });
  const observer = new ResizeObserver(pin);
  observer.observe(scroller); // composer growth, panel width, mobile keyboard
  observer.observe(content); // streamed text, reports, images, expanded rows
  onChange(true);
  return { follow, pause, pin, destroy() { events.abort(); observer.disconnect(); cancelAnimationFrame(announceFrame); } };
}
