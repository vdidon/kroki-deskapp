// @ts-check
// Voile de chargement de la zone de rendu.
//
// Afficher un gros document se fait en deux temps : la transformation par le
// plugin qui le revendique (asynchrone, dans son worker) puis markdown-it +
// KaTeX + DOMPurify + insertion DOM. Ce second temps est **synchrone** et
// occupe le thread principal — près d'une seconde pour un document de 100 Ko,
// qui produit ~2 Mo de HTML et ~54 000 nœuds. Sans retour visuel, l'onglet
// reste vide pendant tout ce temps : l'attente se perçoit plus longue qu'elle
// n'est.
//
// Trois contraintes dictent l'implémentation :
//
// 1. **Anti-flash.** Le voile n'apparaît qu'au bout de `DELAY_MS` : un document
//    ordinaire se rend bien avant, et ne doit rien faire clignoter.
// 2. **Peindre avant de bloquer.** Afficher le voile ne suffit pas : tant que
//    le thread principal n'a pas rendu la main, rien n'est peint. Une phase
//    synchrone lancée dans la foulée afficherait donc le voile *après* s'être
//    terminée — c'est-à-dire jamais. D'où `paintLoading`, à attendre juste
//    avant cette phase.
// 3. **Une animation qui survit au blocage.** Pendant la phase synchrone, le
//    thread principal ne peut plus animer quoi que ce soit. Seules les
//    propriétés `transform` et `opacity` sont animées par le compositeur, hors
//    thread principal : le CSS du voile s'y tient (cf. `#loading-overlay` dans
//    `css/app.css`), sans quoi le spinner se figerait exactement quand il doit
//    rassurer.

import { t } from "./i18n.js";

const DELAY_MS = 180;

// Taille de markdown au-delà de laquelle un rendu **synchrone** est réputé
// assez long pour mériter le voile. Le délai anti-flash ne peut rien pour ces
// phases : un `setTimeout` ne se déclenche pas pendant que le thread principal
// est bloqué, si bien que le voile doit être posé *avant*, sur prédiction.
// La taille du markdown est un prédicteur imparfait — le coût réel suit le
// volume de DOM produit, que les formules KaTeX font exploser (~20× le source)
// — mais elle est gratuite et ne se trompe que dans le sens inoffensif : un
// document volumineux et pauvre en formules affiche un voile un peu court.
const HEAVY_CHARS = 60000;

const overlay = document.getElementById("loading-overlay");
const labelEl = overlay?.querySelector(".loading-label");

/** @type {ReturnType<typeof setTimeout> | null} */
let timer = null;
let depth = 0; // rendus imbriqués (renderActive appelé pendant une bascule)

/**
 * Signale le début d'une phase de rendu. Le voile n'apparaîtra que si elle
 * dure plus de `DELAY_MS`. À apparier systématiquement avec `endLoading`
 * dans un `finally` : un rendu qui échoue ne doit pas laisser le voile posé.
 *
 * @param {string} [label]
 */
export function beginLoading(label = t("loading.rendering")) {
  depth += 1;
  if (!overlay || timer !== null || !overlay.hidden) return; // déjà armé ou visible
  timer = setTimeout(() => {
    timer = null;
    if (labelEl) labelEl.textContent = label;
    overlay.hidden = false;
  }, DELAY_MS);
}

/** Le voile est-il effectivement affiché ? */
export function loadingVisible() {
  return !!overlay && !overlay.hidden;
}

/**
 * Rend la main au navigateur le temps d'un paint — mais **seulement si** le
 * voile est affiché. Sur un document rapide il n'apparaît jamais, et l'attente
 * de deux frames n'est pas payée. Deux `requestAnimationFrame` imbriqués :
 * le premier s'exécute avant le paint du frame courant, le second après.
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
 * À attendre juste avant une phase de rendu **synchrone** portant sur `text`.
 * Au-delà de `HEAVY_CHARS`, pose le voile sans attendre le délai — puis attend
 * qu'il soit peint. En deçà, ne fait rien et ne coûte rien.
 *
 * À utiliser en plus de `beginLoading`, pas à sa place : le délai couvre les
 * phases asynchrones (transformation par un plugin), celle-ci les phases
 * bloquantes, et un même rendu enchaîne souvent les deux.
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

/** Fin de la phase de rendu : désarme le voile, ou le retire s'il est posé. */
export function endLoading() {
  depth = Math.max(0, depth - 1);
  if (depth > 0) return;
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (overlay) overlay.hidden = true;
}
