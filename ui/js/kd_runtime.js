// @ts-check
// `kd` runtime injected into each plugin's worker (protocol v1,
// doc/plugin-protocol.md §5-§6). This file is NOT an app module: it is
// loaded as text by ui/js/plugins.js and prepended to the worker blob,
// followed by `kd.__load("<absolute URL of the entry>")`. It therefore runs in the
// global scope of a sandboxed module worker (no DOM, no `invoke`).
//
// Message envelope: { kd: 1, id?, method?, params?, result?, error? }.
// Unknown fields are ignored on both sides (protocol compat lever).
//
// Types: types/plugin-protocol.d.ts. This file is a script (no import:
// it is concatenated into the blob), hence the JSDoc `import()`s.

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

// `kd` does not exist on the DOM lib's `globalThis`: cast to KdGlobal.
/** @type {KdGlobal} */ (/** @type {unknown} */ (globalThis)).kd = {
  /**
   * Registers the handler of an incoming method (host → plugin).
   * @param {string} method
   * @param {KdRawHandler} handler
   */
  onRequest(method, handler) {
    __kdHandlers.set(method, handler);
  },
  /**
   * Calls a host service (plugin → host), e.g. `host/readFile`.
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
   * Notification with no reply (plugin → host), e.g. `host/log`.
   * @param {string} method
   * @param {unknown} [params]
   */
  notify(method, params) {
    postMessage(/** @satisfies {KdOutgoingFromWorker} */ ({ kd: 1, method, params }));
  },
};

self.onmessage = async (e) => {
  // Message from the host, unvalidated: only `kd`, `id`, `method` are tested.
  const m = /** @type {KdWireMessage | null | undefined} */ (e.data);
  if (!m || m.kd !== 1) return;

  // Reply to a plugin request (kd.request).
  if (m.id != null && ("result" in m || "error" in m)) {
    const p = __kdPending.get(/** @type {number} */ (m.id));
    if (!p) return;
    __kdPending.delete(/** @type {number} */ (m.id));
    if ("error" in m) {
      // `Error()` converts a non-string message; `code` is relayed as is.
      const err = /** @type {KdRequestError} */ (
        new Error(/** @type {string | undefined} */ (m.error?.message) || "host error")
      );
      err.code = /** @type {string | undefined} */ (m.error?.code) || "internal";
      p.reject(err);
    } else {
      p.resolve(m.result);
    }
    return;
  }

  if (!m.method) return;
  // Map key: a non-string method simply finds no handler.
  const handler = __kdHandlers.get(/** @type {string} */ (m.method));

  // Incoming notification (no id): best effort, never a reply.
  if (m.id == null) {
    if (handler) {
      try {
        await handler(m.params);
      } catch {
        /* a notification has no error channel */
      }
    }
    return;
  }

  // Incoming request: the handler's return value becomes `result`, an exception
  // becomes `error` (code `internal` by default, or `err.code` if set).
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
    // The plugin may throw any value: `code`/`message` are read only if
    // `err` is truthy, then `|| …` / `String()`. A non-string `code` set by
    // the plugin passes through as is (the host does not validate it either).
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

// Loads the plugin entry (absolute plugin://… URL) then signals the host. The
// module's `kd.onRequest` handlers are registered at import time, before the
// host sends `initialize`.
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
