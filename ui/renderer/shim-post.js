// @ts-check

// Grab bytefield-svg's CommonJS export, then clean up the pseudo-Node.
window.__bytefield = (window.module && window.module.exports) || null;
delete window.module;
