// @ts-check

// Options d'un champ de recherche — casse / mot entier / expression régulière —
// et la RegExp qui en découle. Partagé par la recherche dans le document
// (`docsearch.js`) et la recherche multi-documents (`globalsearch.js`) : mêmes
// boutons `Aa` `ab` `.*` collés à droite du champ, même sémantique.

/**
 * État des boutons `Aa` `ab` `.*`.
 * @typedef {object} SearchOptions
 * @property {boolean} caseSensitive
 * @property {boolean} wholeWord
 * @property {boolean} regex
 */

// Caractère « de mot » pour l'option « mot entier ». `\b` est ASCII-only en
// JavaScript : il couperait `été` ou `naïve` en deux (é/ï hors `\w`) et ferait
// échouer la recherche sur du texte français. On pose donc des lookarounds sur
// un `\w` étendu au latin accentué, au grec et au cyrillique — sans le flag `u`,
// qui rendrait invalides des expressions utilisateur par ailleurs correctes.
const WORD = "[\\w\\u00C0-\\u024F\\u0370-\\u03FF\\u0400-\\u04FF]";

// Lookbehind : Chromium l'a depuis toujours, WebKitGTK seulement depuis 2023.
// Sur un moteur qui ne le connaît pas, « mot entier » retombe sur `\b` (ASCII).
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
 * RegExp globale correspondant à la requête, ou `null` si elle est vide.
 * Lève (SyntaxError) quand `regex` est demandé sur une expression invalide :
 * c'est à l'appelant d'en faire un état affiché, pas un plantage.
 * @param {string | null | undefined} query
 * @param {Partial<SearchOptions>} [options]
 * @returns {RegExp | null}
 */
export function buildMatcher(query, { caseSensitive = false, wholeWord = false, regex = false } = {}) {
  const q = String(query ?? "");
  if (!q) return null;
  // Groupe non capturant : sans lui, `foo|bar` + « mot entier » ne cadrerait que
  // la dernière alternative. Ne décale aucun numéro de groupe de l'utilisateur.
  let src = regex ? `(?:${q})` : escapeRegExp(q);
  if (wholeWord) src = LOOKBEHIND ? `(?<!${WORD})${src}(?!${WORD})` : `\\b${src}\\b`;
  return new RegExp(src, caseSensitive ? "g" : "gi");
}

/**
 * Itère les occurrences de `re` dans `text`, au plus `cap` fois.
 * Les correspondances vides (`a*`, `^`) sont sautées : elles n'ont rien à
 * surligner et boucleraient indéfiniment sur `lastIndex`.
 * @param {RegExp | null} re  globale (`g`), sinon `exec` boucle sur la même occurrence
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
 * Câble les `<button data-opt>` d'une rangée d'options sur un objet d'état
 * (muté en place, à lire au moment de chaque recherche) et prévient `onChange`
 * à chaque bascule.
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
