// @ts-check

// Options of a search field — case / whole word / regular expression — and the
// RegExp derived from them. Shared by the in-document search (`docsearch.js`)
// and the multi-document search (`globalsearch.js`): same `Aa` `ab` `.*`
// buttons stuck to the right of the field, same semantics.

/**
 * State of the buttons `Aa` `ab` `.*`.
 * @typedef {object} SearchOptions
 * @property {boolean} caseSensitive
 * @property {boolean} wholeWord
 * @property {boolean} regex
 */

// "Word" character for the "whole word" option. `\b` is ASCII-only in
// JavaScript: it would split `été` or `naïve` in two (é/ï are outside `\w`) and
// break the search on French text. So we put lookarounds on a `\w` extended to
// accented Latin, Greek and Cyrillic — without the `u` flag, which would make
// otherwise valid user expressions invalid.
const WORD = "[\\w\\u00C0-\\u024F\\u0370-\\u03FF\\u0400-\\u04FF]";

// Lookbehind: Chromium has always had it, WebKitGTK only since 2023. On an
// engine that lacks it, "whole word" falls back to `\b` (ASCII).
const LOOKBEHIND = (() => {
  try {
    new RegExp("(?<!a)b");
    return true;
  } catch {
    return false;
  }
})();

/**
 * @param {unknown} s
 * @returns {string}
 */
export function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Global RegExp matching the query, or `null` if it is empty.
 * Throws (SyntaxError) when `regex` is requested on an invalid expression:
 * it is up to the caller to turn that into a displayed state, not a crash.
 * @param {string | null | undefined} query
 * @param {Partial<SearchOptions>} [options]
 * @returns {RegExp | null}
 */
export function buildMatcher(query, { caseSensitive = false, wholeWord = false, regex = false } = {}) {
  const q = String(query ?? "");
  if (!q) return null;
  // Non-capturing group: without it, `foo|bar` + "whole word" would only bound
  // the last alternative. Does not shift any of the user's group numbers.
  let src = regex ? `(?:${q})` : escapeRegExp(q);
  if (wholeWord) src = LOOKBEHIND ? `(?<!${WORD})${src}(?!${WORD})` : `\\b${src}\\b`;
  return new RegExp(src, caseSensitive ? "g" : "gi");
}

/**
 * Iterates the occurrences of `re` in `text`, at most `cap` times.
 * Empty matches (`a*`, `^`) are skipped: they have nothing to highlight and
 * would loop forever on `lastIndex`.
 * @param {RegExp | null} re  global (`g`), otherwise `exec` loops on the same occurrence
 * @param {string} text
 * @param {number} [cap]
 * @returns {Generator<RegExpExecArray, void, unknown>}
 */
export function* iterMatches(re, text, cap = Infinity) {
  if (!re || cap <= 0) return;
  re.lastIndex = 0;
  let n = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    yield m;
    if (++n >= cap) return;
  }
}

/** @type {Record<string, keyof SearchOptions | undefined>} */
const KEYS = { case: "caseSensitive", word: "wholeWord", regex: "regex" };

/**
 * Wires the `<button data-opt>` of an options row to a state object (mutated
 * in place, to be read at each search) and notifies `onChange` on every
 * toggle.
 * @param {ParentNode} container
 * @param {() => void} [onChange]
 * @returns {SearchOptions}
 */
export function initSearchToggles(container, onChange) {
  /** @type {SearchOptions} */
  const opts = { caseSensitive: false, wholeWord: false, regex: false };
  const buttons = /** @type {NodeListOf<HTMLButtonElement>} */ (
    container.querySelectorAll("button[data-opt]")
  );
  for (const btn of buttons) {
    const key = KEYS[btn.dataset.opt ?? ""];
    if (!key) continue;
    btn.addEventListener("click", () => {
      opts[key] = !opts[key];
      btn.classList.toggle("active", opts[key]);
      btn.setAttribute("aria-pressed", String(opts[key]));
      onChange?.();
    });
  }
  return opts;
}
