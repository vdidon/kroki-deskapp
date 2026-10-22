// @ts-check
// Runtime `kd` injecté dans le worker de chaque plugin (protocole v1,
// doc/plugin-protocol.md §5-§6). Ce fichier n'est PAS un module de l'app : il
// est chargé comme texte par ui/js/plugins.js et préfixé au blob du worker,
// suivi de `kd.__load("<url absolue de l'entry>")`. Il tourne donc dans le
// scope global d'un module worker sandboxé (pas de DOM, pas d'`invoke`).
//
// Enveloppe des messages : { kd: 1, id?, method?, params?, result?, error? }.
// Champs inconnus ignorés des deux côtés (levier de compat du protocole).
//
// Types : types/plugin-protocol.d.ts. Ce fichier est un script (pas d'import :
// il est concaténé au blob), d'où les `import()` en JSDoc.

/** @typedef {import("../../types/plugin-protocol").KdGlobal} KdGlobal */
/** @typedef {import("../../types/plugin-protocol").KdWireMessage} KdWireMessage */
/** @typedef {import("../../types/plugin-protocol").KdOutgoingFromWorker} KdOutgoingFromWorker */
/** @typedef {import("../../types/plugin-protocol").KdRawHandler} KdRawHandler */
/** @typedef {import("../../types/plugin-protocol").KdRequestError} KdRequestError */

/** @type {Map<number, { resolve: (value: unknown) => void, reject: (reason: unknown) => void }>} */
const __kdPending = new Map();
/** @type {Map<string, KdRawHandler>} */
const __kdHandlers = new Map();
let __kdNextId = 1;

// `kd` n'existe pas sur le `globalThis` de la lib DOM : cast vers KdGlobal.
/** @type {KdGlobal} */ (/** @type {unknown} */ (globalThis)).kd = {
  /**
   * Enregistre le handler d'une méthode entrante (hôte → plugin).
   * @param {string} method
   * @param {KdRawHandler} handler
   */
  onRequest(method, handler) {
    __kdHandlers.set(method, handler);
  },
  /**
   * Appelle un service de l'hôte (plugin → hôte), ex. `host/readFile`.
   * @param {string} method
   * @param {unknown} [params]
   * @returns {Promise<unknown>}
   */
  request(method, params) {
    return new Promise((resolve, reject) => {
      const id = __kdNextId++;
      __kdPending.set(id, { resolve, reject });
      postMessage(/** @satisfies {KdOutgoingFromWorker} */ ({ kd: 1, id, method, params }));
    });
  },
  /**
   * Notification sans réponse (plugin → hôte), ex. `host/log`.
   * @param {string} method
   * @param {unknown} [params]
   */
  notify(method, params) {
    postMessage(/** @satisfies {KdOutgoingFromWorker} */ ({ kd: 1, method, params }));
  },
};

self.onmessage = async (e) => {
  // Message de l'hôte, non validé : seuls `kd`, `id`, `method` sont testés.
  const m = /** @type {KdWireMessage | null | undefined} */ (e.data);
  if (!m || m.kd !== 1) return;

  // Réponse à une requête du plugin (kd.request).
  if (m.id != null && ("result" in m || "error" in m)) {
    const p = __kdPending.get(/** @type {number} */ (m.id));
    if (!p) return;
    __kdPending.delete(/** @type {number} */ (m.id));
    if ("error" in m) {
      // `Error()` convertit un message non chaîne ; `code` est relayé tel quel.
      const err = /** @type {KdRequestError} */ (
        new Error(/** @type {string | undefined} */ (m.error?.message) || "erreur de l'hôte")
      );
      err.code = /** @type {string | undefined} */ (m.error?.code) || "internal";
      p.reject(err);
    } else {
      p.resolve(m.result);
    }
    return;
  }

  if (!m.method) return;
  // Clé de Map : une méthode non chaîne ne trouve simplement aucun handler.
  const handler = __kdHandlers.get(/** @type {string} */ (m.method));

  // Notification entrante (pas d'id) : best effort, jamais de réponse.
  if (m.id == null) {
    if (handler) {
      try {
        await handler(m.params);
      } catch {
        /* une notification n'a pas de canal d'erreur */
      }
    }
    return;
  }

  // Requête entrante : le retour du handler devient `result`, une exception
  // devient `error` (code `internal` par défaut, ou `err.code` si posé).
  if (!handler) {
    postMessage(/** @satisfies {KdOutgoingFromWorker} */ ({
      kd: 1,
      id: /** @type {number} */ (m.id),
      error: { code: "method-not-found", message: /** @type {string} */ (m.method) },
    }));
    return;
  }
  try {
    const result = await handler(m.params);
    postMessage(
      /** @satisfies {KdOutgoingFromWorker} */ ({ kd: 1, id: /** @type {number} */ (m.id), result: result ?? {} }),
    );
  } catch (err) {
    // N'importe quelle valeur peut être levée par le plugin : `code`/`message`
    // lus seulement si `err` est vrai, puis `|| …` / `String()`. Un `code` non
    // chaîne posé par le plugin passe tel quel (l'hôte ne le valide pas non plus).
    postMessage(/** @satisfies {KdOutgoingFromWorker} */ ({
      kd: 1,
      id: /** @type {number} */ (m.id),
      error: {
        code: /** @type {string} */ ((err && /** @type {KdRequestError} */ (err).code) || "internal"),
        message: String((err && /** @type {KdRequestError} */ (err).message) || err),
      },
    }));
  }
};

// Charge l'entry du plugin (URL absolue plugin://…) puis signale l'hôte. Les
// handlers `kd.onRequest` du module sont enregistrés à l'import, avant que
// l'hôte n'envoie `initialize`.
/** @type {KdGlobal} */ (/** @type {unknown} */ (globalThis)).kd.__load = async (entryUrl) => {
  try {
    await import(entryUrl);
    postMessage(/** @satisfies {KdOutgoingFromWorker} */ ({ kd: 1, method: "worker/ready" }));
  } catch (err) {
    postMessage(/** @satisfies {KdOutgoingFromWorker} */ ({
      kd: 1,
      method: "worker/error",
      params: { message: String((err && /** @type {Error} */ (err).message) || err) },
    }));
  }
};
