// @ts-check

// Récupère l'export CommonJS de bytefield-svg puis nettoie le pseudo-Node.
window.__bytefield = (window.module && window.module.exports) || null;
delete window.module;
