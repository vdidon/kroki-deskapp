// Dialog « Informations » : version de l'app, état des runtimes/moteurs sur
// le poste courant, accès au changelog (« Nouveautés »). Les données des
// moteurs viennent du backend (`get_runtimes`) ; chaque groupe porte un
// statut : ok (app + système), blocked (app, prérequis système manquant),
// unsupported (pas pris en charge par l'application).

import { invoke } from "./app.js";
import { openChangelog } from "./changelog.js";

const dialog = document.getElementById("info-dialog");
const groupsEl = document.getElementById("info-groups");
const versionEl = document.getElementById("info-version");

const STATUS_LABELS = {
  ok: "Disponible",
  blocked: "Prérequis manquant",
  unsupported: "Non embarqué",
};

function renderGroup(g) {
  const status = STATUS_LABELS[g.status] ? g.status : "unsupported";

  const group = document.createElement("section");
  group.className = `rt-group ${status}`;

  const head = document.createElement("div");
  head.className = "rt-head";

  const titles = document.createElement("div");
  const title = document.createElement("div");
  title.className = "rt-title";
  title.textContent = g.label;
  const req = document.createElement("div");
  req.className = "rt-req";
  req.textContent = g.requirement;
  titles.append(title, req);

  const badge = document.createElement("span");
  badge.className = `rt-badge ${status}`;
  badge.textContent = STATUS_LABELS[status];

  head.append(titles, badge);
  group.append(head);

  if (g.note) {
    const note = document.createElement("p");
    note.className = "rt-note";
    note.textContent = g.note;
    group.append(note);
  }

  if (Array.isArray(g.types) && g.types.length) {
    const chips = document.createElement("div");
    chips.className = "rt-types";
    for (const t of g.types) {
      const chip = document.createElement("span");
      chip.className = "rt-chip";
      chip.textContent = t;
      chips.append(chip);
    }
    group.append(chips);
  }

  return group;
}

export async function openInfo() {
  try {
    versionEl.textContent = `Kroki Desk v${await window.__TAURI__.app.getVersion()}`;
  } catch {
    versionEl.textContent = "Kroki Desk";
  }
  let groups;
  try {
    groups = await invoke("get_runtimes");
  } catch (err) {
    groups = [];
    groupsEl.replaceChildren();
    const error = document.createElement("p");
    error.className = "settings-error";
    error.textContent = String(err);
    groupsEl.append(error);
    dialog.showModal();
    return;
  }
  groupsEl.replaceChildren(...groups.map(renderGroup));
  dialog.showModal();
}

export function initInfo() {
  document.getElementById("info-close").addEventListener("click", () => dialog.close());
  // Le changelog s'empile au-dessus du dialog (modales imbriquées, comme le
  // dialog de confiance au-dessus du dialog Plugins).
  document.getElementById("info-changelog").addEventListener("click", openChangelog);
}
