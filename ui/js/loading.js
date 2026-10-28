// @ts-check
// Loading overlay for the render area.
//
// Displaying a large document happens in two steps: the transformation by the
// plugin that claims it (asynchronous, in its worker) then markdown-it +
// KaTeX + DOMPurify + DOM insertion. This second step is **synchronous** and
// occupies the main thread — close to a second for a 100 KB document, which
// produces ~2 MB of HTML and ~54,000 nodes. Without visual feedback, the tab
// stays empty the whole time: the wait feels longer than it is.
//
// Three constraints dictate the implementation:
//
// 1. **Anti-flash.** The overlay only appears after `DELAY_MS`: an ordinary
//    document renders well before that, and must not flicker anything.
// 2. **Paint before blocking.** Showing the overlay is not enough: as long as
//    the main thread has not yielded, nothing is painted. A synchronous phase
//    started right after would thus show the overlay *after* it has finished
//    — that is, never. Hence `paintLoading`, to be awaited just before that
//    phase.
// 3. **An animation that survives blocking.** During the synchronous phase,
//    the main thread cannot animate anything. Only the `transform` and
//    `opacity` properties are animated by the compositor, off the main
//    thread: the overlay's CSS sticks to them (cf. `#loading-overlay` in
//    `css/app.css`), otherwise the spinner would freeze exactly when it is
//    meant to reassure.

import { t } from "./i18n.js";

const DELAY_MS = 180;

// Markdown size beyond which a **synchronous** render is deemed long enough to
// deserve the overlay. The anti-flash delay is useless for these phases: a
// `setTimeout` does not fire while the main thread is blocked, so the overlay
// must be put up *beforehand*, on prediction. Markdown size is an imperfect
// predictor — the real cost follows the volume of DOM produced, which KaTeX
// formulas blow up (~20× the source) — but it is free and only errs on the
// harmless side: a large, formula-poor document shows a slightly short overlay.
const HEAVY_CHARS = 60000;

const overlay = document.getElementById("loading-overlay");
const labelEl = overlay?.querySelector(".loading-label");

/** @type {ReturnType<typeof setTimeout> | null} */
let timer = null;
let depth = 0; // nested renders (renderActive called during a toggle)

/**
 * Signals the start of a render phase. The overlay only appears if it lasts
 * longer than `DELAY_MS`. Always pair with `endLoading` in a `finally`: a
 * failing render must not leave the overlay up.
 *
 * @param {string} [label]
 */
export function beginLoading(label = t("loading.rendering")) {
  depth += 1;
  if (!overlay || timer !== null || !overlay.hidden) return; // already armed or visible
  timer = setTimeout(() => {
    timer = null;
    if (labelEl) labelEl.textContent = label;
    overlay.hidden = false;
  }, DELAY_MS);
}

/** Is the overlay actually displayed? */
export function loadingVisible() {
  return !!overlay && !overlay.hidden;
}

/**
 * Yields to the browser for one paint — but **only if** the overlay is
 * displayed. On a fast document it never appears, and the two-frame wait is
 * not paid. Two nested `requestAnimationFrame`s: the first runs before the
 * current frame's paint, the second after.
 *
 * @returns {Promise<void>}
 */
export function paintLoading() {
  if (!loadingVisible()) return Promise.resolve();
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/**
 * To be awaited just before a **synchronous** render phase working on `text`.
 * Beyond `HEAVY_CHARS`, puts the overlay up without waiting for the delay —
 * then waits for it to be painted. Below that, does nothing and costs nothing.
 *
 * To be used in addition to `beginLoading`, not instead of it: the delay covers
 * the asynchronous phases (plugin transformation), this one the blocking
 * phases, and a single render often chains both.
 *
 * @param {string | null | undefined} text
 */
export async function beforeHeavyRender(text) {
  if (!overlay || String(text ?? "").length < HEAVY_CHARS) return;
  if (overlay.hidden) {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    overlay.hidden = false;
  }
  await paintLoading();
}

/** End of the render phase: disarms the overlay, or removes it if it is up. */
export function endLoading() {
  depth = Math.max(0, depth - 1);
  if (depth > 0) return;
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (overlay) overlay.hidden = true;
}
