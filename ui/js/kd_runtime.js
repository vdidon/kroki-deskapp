// Runtime `kd` injecté dans le worker de chaque plugin (protocole v1,
// doc/plugin-protocol.md §5-§6). Ce fichier n'est PAS un module de l'app : il
// est chargé comme texte par ui/js/plugins.js et préfixé au blob du worker,
// suivi de `kd.__load("<url absolue de l'entry>")`. Il tourne donc dans le
// scope global d'un module worker sandboxé (pas de DOM, pas d'`invoke`).
//
// Enveloppe des messages : { kd: 1, id?, method?, params?, result?, error? }.
// Champs inconnus ignorés des deux côtés (levier de compat du protocole).

const __kdPending = new Map();
const __kdHandlers = new Map();
let __kdNextId = 1;

globalThis.kd = {
  /** Enregistre le handler d'une méthode entrante (hôte → plugin). */
  onRequest(method, handler) {
    __kdHandlers.set(method, handler);
  },
  /** Appelle un service de l'hôte (plugin → hôte), ex. `host/readFile`. */
  request(method, params) {
    return new Promise((resolve, reject) => {
      const id = __kdNextId++;
      __kdPending.set(id, { resolve, reject });
      postMessage({ kd: 1, id, method, params });
    });
  },
  /** Notification sans réponse (plugin → hôte), ex. `host/log`. */
  notify(method, params) {
    postMessage({ kd: 1, method, params });
  },
};

self.onmessage = async (e) => {
  const m = e.data;
  if (!m || m.kd !== 1) return;

  // Réponse à une requête du plugin (kd.request).
  if (m.id != null && ("result" in m || "error" in m)) {
    const p = __kdPending.get(m.id);
    if (!p) return;
    __kdPending.delete(m.id);
    if ("error" in m) {
      const err = new Error(m.error?.message || "erreur de l'hôte");
      err.code = m.error?.code || "internal";
      p.reject(err);
    } else {
      p.resolve(m.result);
    }
    return;
  }

  if (!m.method) return;
  const handler = __kdHandlers.get(m.method);

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
    postMessage({
      kd: 1,
      id: m.id,
      error: { code: "method-not-found", message: m.method },
    });
    return;
  }
  try {
    const result = await handler(m.params);
    postMessage({ kd: 1, id: m.id, result: result ?? {} });
  } catch (err) {
    postMessage({
      kd: 1,
      id: m.id,
      error: {
        code: (err && err.code) || "internal",
        message: String((err && err.message) || err),
      },
    });
  }
};

// Charge l'entry du plugin (URL absolue plugin://…) puis signale l'hôte. Les
// handlers `kd.onRequest` du module sont enregistrés à l'import, avant que
// l'hôte n'envoie `initialize`.
globalThis.kd.__load = async (entryUrl) => {
  try {
    await import(entryUrl);
    postMessage({ kd: 1, method: "worker/ready" });
  } catch (err) {
    postMessage({
      kd: 1,
      method: "worker/error",
      params: { message: String((err && err.message) || err) },
    });
  }
};
