# Changelog

All notable changes to Kroki Desk are recorded in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project follows [semantic versioning](https://semver.org/spec/v2.0.0.html).

## [3.25.0] — 2026-10-16

### Added
- **English and French interface.** Kroki Desk follows the language of the
  operating system — French on a French Windows or Linux desktop, English
  otherwise — and Settings → Language lets you pick one explicitly. The change
  applies at once to every open window, error messages included.
- **Plugins told the interface language.** The host sends `locale` with
  `initialize`, `document/transform` and `fence/render`, and notifies
  `locale/changed` (plugin protocol §6.1, §6.6): the bundled LaTeX plugin
  shows its warnings in the interface language.

### Changed
- The local Kroki API and the command-line output answer in English whatever
  the interface language, so that the tools reading them behave the same on
  every machine.

## [3.24.0] — 2026-10-16

### Added
- **Double-click on the formats of plugins installed by the MSI.** The
  extensions of a plugin ticked during installation now open Kroki Desk by
  default (`.tex`, `.latex`, `.csv`…), instead of only showing up under
  "Open with". A format for which you have already chosen another application
  keeps that choice.
- **Bundled plugin selection configurable at build time.** The plugins
  shipped with the MSI and the `.deb` package, and those ticked by default,
  are described by a simple text file (`bundled-plugins.default.txt`,
  overridden locally by `bundled-plugins.txt`); names and extensions are read
  from the plugin manifests.

### Changed
- **Settings moved to `%APPDATA%\kroki-deskapp\settings.json`**
  (Linux: `~/.config/kroki-deskapp/`), next to the plugins. Settings from a
  previous version are not carried over: theme, icons and Kroki server have to
  be set again once, and a plugin removed earlier may be reinstalled on first
  launch.
- Application identifier and publisher shown by the installer renamed.

## [3.23.1] — 2026-10-14

### Fixed
- **White icon on the taskbar pin after an update through the MSI.** The Start
  menu shortcut took its icon from the Windows Installer cache, a folder
  specific to each version and deleted at the next update; the pin, a frozen
  copy of the shortcut, ended up with no icon. The shortcut now reads it from
  the executable. A pin that is already damaged has to be redone once (unpin,
  then pin again).

## [3.23.0] — 2026-10-12

### Added
- **`-d` (`--detach`) command-line option.** `kroki_deskapp -d "doc.md"`
  launches the application detached from the terminal and returns
  immediately: from bash (Git Bash, Linux), the terminal no longer waits for
  the application to close, and closing the terminal no longer takes the
  application down with it.

## [3.22.0] — 2026-10-05

### Added
- **Match markers on the scrollbar.** During an in-document search
  (`Ctrl+F`), a tick marks each match on the scrollbar, at its height in the
  document — the current match in orange. You can see at a glance where the
  results are concentrated. The markers follow window resizing, zooms and
  figures that finish rendering; the scrollbar remains grabbable through them.

### Fixed
- **Each document keeps its own current match.** Reaching match 3 in one tab
  and then switching to another no longer puts the latter on match 3: each
  document resumes the match you had reached in it (as long as the query has
  not changed), or the first one.
- **Collapsed content is no longer counted in the search.** Matches located
  inside a closed accordion (collapsed sources, a plugin's expandable
  sections…) were counted and navigation jumped to them without showing
  anything. They are now ignored by all three searches; opening or closing an
  accordion updates the counter while staying on the current match.

## [3.21.0] — 2026-09-25

### Added
- **Detach a tab from its context menu.** Right-clicking a tab offers
  "Detach into a new window" (« Détacher dans une nouvelle fenêtre »): the
  document opens in a window of the same size, offset from the original
  window — the same result as dragging the tab out of the bar, without having
  to drag it. The entry is disabled on a window's only tab.

## [3.20.0] — 2026-09-24

### Added
- **Links to a line: `fichier.md#L75`.** A link whose fragment is a line
  number, in the style of GitHub and VS Code (`#L75`, or a range `#L75-L80`
  of which only the start counts), opens the document and brings that source
  line to the top of the view — within the same document or to another one,
  in preview as in source view, including for documents transformed by a
  plugin (`.tex`…), where the number designates the line of the original
  file. Until now, the document opened but stayed at the top. If the
  document actually contains an element with the identifier `L75`, that
  element takes precedence.
- **Open a document at a reference from the command line.**
  `kroki_deskapp.exe "modele.tex#eq:sigmaU"` opens the document and scrolls
  to the reference, with the same syntax as links: LaTeX `\label`, numbered
  section (`#sec-2-1`), anchor set by a plugin, markdown heading or line
  number (`#L42`). Works whether or not the application is already open —
  which lets an agent directly show the passage it is talking about. A file
  name that itself contains `#` can still be opened as is.
- **Installer: the application launches by name.** The MSI registers it in
  *App Paths*: `start kroki_deskapp …`, `Start-Process kroki_deskapp …` and
  Win+R `kroki_deskapp` work without knowing its installation folder or
  adding it to the PATH.

## [3.19.0] — 2026-09-17

### Added
- **Context menu on tabs.** Right-clicking a tab offers "Copy path" (« Copier
  le chemin »; full path of the file), "Show in file explorer" (« Afficher
  dans l'explorateur de fichiers »; opens the folder with the file selected),
  "Close tabs to the left" (« Fermer les onglets à gauche »), "Close tabs to
  the right" (« Fermer les onglets à droite ») and "Close other tabs"
  (« Fermer les autres onglets »). The clicked tab stays open and becomes the
  active tab if the previously active one was closed. Entries that do not
  apply (first tab, last tab, single tab) are greyed out.

## [3.18.1] — 2026-09-16

### Fixed
- **Table of contents and internal links land on their target again.** On a
  large document, a click in the table of contents could stop several sections
  short of the target and stay there: blocks never displayed yet only had an
  estimated height, and the readjustment meant to make up for the gap
  afterwards sometimes gave up along the way. The lazy layout introduced in
  3.14.1 is removed: the whole document is laid out on opening, so jumps
  (table of contents, `#anchor` links, links to another document, preview ↔
  source view sync) now aim at exact positions on the first try.

### Notes
- Accepted trade-off: opening a very large math document goes back to its
  pre-3.14.1 time (around 1.4 s instead of ~0.6 s for 100 KB of source and
  nearly a thousand formulas). The loading overlay covers this wait. Switching
  between preview and source view stays fast: each view's DOM is still kept.

## [3.18.0] — 2026-09-16

### Added
- **TikZ figures drawn, if a TeX distribution is installed.** A ` ```tikz `
  block (full LaTeX document, as Kroki expects it, or a bare `tikzpicture`) is
  now rendered locally by the workstation's distribution — MiKTeX or TeX
  Live, with `latex` and `dvisvgm` on the PATH — instead of requiring an
  external Kroki server. Same approach as Java for PlantUML: nothing is
  bundled, detection is done once, and the "Information" dialog
  (« Informations ») shows a new "TeX engine" (« Moteur TeX ») group. Text is
  converted to outlines: the SVG does not depend on any font. About 1 to 2 s
  per figure, cached. This is what lets the `latex-doc` plugin 1.4.0 draw the
  `tikzpicture`s of `.tex` documents.
- Compilation runs in a temporary folder, without `\write18`, with a maximum
  delay of 60 s, and without automatic package installation under MiKTeX (its
  window would pop up mid-render): a missing package yields an error message
  that names it. A TeX error is reported with its line.

## [3.17.1] — 2026-09-07

### Changed
- **A `.kdws` session now always opens in at least one new window.** Until
  now its first window was grafted onto the target window — the one of the
  drop, or the first window opened for a double-click when the application
  was already running: the session's tabs ended up mixed with the work in
  progress, with no way to tell them apart. The target window is now reused
  only if it is still empty (startup on a `.kdws`, "drop a file" window
  (« déposer un fichier »)); as soon as it contains a tab, the session opens
  next to it. Focus and the opening report follow the session's first window.

## [3.17.0] — 2026-09-03

### Added
- **Page zoom with the wheel (`Shift+wheel`).** The existing zoom
  (`Ctrl+wheel`) is a *text* zoom: it enlarges characters and reflows the
  column, but a figure that already spans the full width keeps exactly its
  size — impossible to get close to a diagram too dense to be read on one
  screen. `Shift+wheel` adds a true page zoom: nothing reflows, everything
  grows — text, figures, tables — and the page overflows into horizontal
  scrolling, which lets you browse a sub-part of it. Zooming is centered on
  the cursor (the hovered point stays in place), from 1 to 8. The two zooms
  combine; `Ctrl+0` resets both to 1. The `Ctrl+F` search now also centers an
  off-screen match horizontally.

## [3.16.0] — 2026-08-28

### Added
- **Windows installer (`.msi`) with file associations.** The application used
  to be distributed as a single executable to copy; file types had to be
  associated by hand to open a document by double-click. An MSI installer is
  now added alongside the portable binary — which is still produced and
  distributed as is. It places the application in `Program Files`, registers
  it under "Installed apps" (clean uninstall, in-place update from one version
  to the next) and associates the file types.

  Nothing is forced, though: Kroki Desk **adds itself** to "Open with" for
  everything it can read — `.md`, `.markdown`, `.mdown`, `.mkd`, `.txt`,
  `.html`, `.htm` — without replacing the default application. Direct
  double-click is only claimed for the formats that belong to it: `.kdws`
  (sessions) and `.kdext` (plugins), as well as those of installed plugins.
  For the others, it would have no effect anyway: Windows protects the user's
  choice and never dislodges a format that is already assigned — claiming it
  would only overwrite a system value that uninstalling would not restore.
- **Double-click on a `.kdext` archive: plugin installation.** A corollary of
  the association above. A plugin archive is not a document; opened from File
  Explorer, the command line or a second instance, it now goes to the
  installation flow — trust dialog included, exactly like a drag-and-drop onto
  the window. It used to show up as a tab with binary content.
- **All plugins shipped with the installer, your choice.** The MSI bundles the
  archives of all the plugins in the repository and an installer page lets you
  tick the ones to install: `latex-doc` (`.tex`, `.latex`) is ticked from the
  start, while the three examples from the protocol specification —
  `csv-tables` (`.csv`), `barchart`, `ini-highlight` — are available unticked.
  The application silently installs the selected plugins on its first launch:
  associating `.tex` without providing the matching plugin would only have
  given a degraded rendering.

  **This selection also drives the associations**: `.tex` and `.latex` are
  only associated with `latex-doc`, and `.csv` only with `csv-tables` —
  associating a format whose plugin is absent would only have given a tab in
  error.

  The selected plugins are then **kept up to date** — installing a newer
  version of Kroki Desk updates the ones it ships, without asking anything.
  Three safeguards: a newer version installed by hand is never rolled back; a
  plugin removed from the Plugins dialog is **not** reinstalled at the next
  startup; and reinstalling it by hand puts it back into the automatic update
  loop. Unticking a plugin in the installer does not uninstall one that is
  already in place — removal is done from the application. This is the only
  installation route that skips the trust dialog: these archives come from the
  same installer as the executable, hence the same chain of trust.
  Drag-and-drop and the Plugins dialog, on the other hand, keep it.
- **Debian/Ubuntu package (`.deb`).** The Linux counterpart of the Windows
  installer, alongside the bare binary and the AppImage, which are still
  produced as is. It installs with
  `sudo apt install ./kroki_deskapp-linux-x86_64-debian12.deb`, adds the
  application to the menu, associates the file types and uninstalls with
  `sudo apt remove kroki-desk`. Debian 12 and Ubuntu 24.04 or newer.

  The same plugins are shipped, with the same default selection —
  `latex-doc` installed on first launch, the three specification examples
  simply dropped into `/usr/lib/Kroki Desk/example-plugins/`, which can then
  be installed from the Plugins dialog without a network. A Debian package has
  no interface to ask the question at install time; the choice is therefore
  made afterwards, not during.

  The associations follow the spirit of the Windows version: Kroki Desk
  **adds itself** to "Open with" for `.md`, `.markdown`, `.mdown`, `.mkd`,
  `.html`, `.htm`, `.tex` and `.latex` without dislodging your default
  applications, and direct double-click works for `.kdws` and `.kdext`, of
  which it is the only declared handler. Nothing is forced: on Linux, the
  default application remains a user setting. One deliberate difference:
  `.txt` is not associated — the system does not distinguish extensions
  there, and claiming it would have made Kroki Desk show up for every text
  file, including those it cannot open.

## [3.15.1] — 2026-08-25

### Fixed
- **`diagramsnet` was missing from the engine inventory of the "Information" dialog (« Informations »).**
  The type was accepted in a fence — writing ` ```diagramsnet ` did produce a
  diagram block — but it appeared in none of the four runtime groups: neither
  among the built-in engines nor among those that require an external Kroki
  server. Anyone checking whether draw.io could be drawn found nothing, and
  only learned the answer by watching the rendering fail. It is now listed
  where it belongs, along with the eleven other types recognized by Kroki but
  not bundled. No change to rendering: the behavior was correct, it was the
  displayed inventory that was incomplete.

## [3.15.0] — 2026-08-24

### Added
- **The welcome screen lists all keyboard shortcuts.** It only showed three of
  the fifteen or so that the application recognizes; the others could only be
  discovered by hovering over a toolbar button — or not at all for those that
  have no button (`Ctrl+Tab`, `F3`, zoom, `F5`). They are now grouped by
  category — files and windows, search, display — under the drop zone, with
  the equivalent mouse gestures (`Ctrl`+wheel, middle-click on a tab, detach
  by dragging).

## [3.14.2] — 2026-08-21

### Changed
- **Switching between preview ↔ source view ↔ intermediate markdown is
  instant.** Every return to preview rebuilt the document from scratch —
  markdown-it, KaTeX, DOMPurify, then tens of thousands of nodes — to
  redisplay exactly the same content. Each view's rendering is now kept and
  simply redisplayed: on a 100 KB document, returning to preview goes from
  **~500 ms to ~80 ms**. Diagrams that were already rendered stay rendered,
  instead of being recomputed.
- **The reading position is better preserved when switching.** A consequence
  of the previous point: the view recovers the heights it had already
  measured, whereas a rebuilt view started again from estimates. The drift
  reported in 3.14.1 drops from ~780 px to a few tens of pixels from the
  second round trip onward.

### Notes
- The kept rendering is discarded as soon as the document changes — change on
  disk, theme or icon change, manual refresh — so that no view can display
  stale content.

## [3.14.1] — 2026-08-21

### Changed
- **Lazy layout of large documents: opening ~2× faster.** Blocks located
  off-screen are no longer laid out until they get close to it. In a math
  document, formulas account for 96% of the nodes — 52,000 out of 54,000 for
  100 KB of source — while only a few dozen blocks are visible at any given
  time. The same 100 KB document opens in ~630 ms versus ~1,400 ms, i.e.
  1,870 ms before this series' optimizations.
  The content stays whole in the page: in-document search, multi-document
  search, the table of contents and internal links find exactly the same
  results as before, and printing lays out the entire document. Scroll jumps
  are readjusted once the blocks crossed have actually been laid out — an
  internal link or a table-of-contents entry lands pixel-perfect, as before.

### Notes
- Preview ↔ source view sync can, on a very large document, come back a few
  hundred pixels away from its starting position after a round trip: the
  switch rebuilds the view, which loses the heights already measured. No
  effect on reading, but noticeable.

## [3.14.0] — 2026-08-21

### Added
- **Loading overlay while a document renders.** A large document used to
  leave the tab empty with nothing displayed: a spinner and "Rendering
  document…" (« Rendu du document… ») now cover the wait, on opening as well
  as when switching between preview / source view / intermediate markdown. It
  only appears if rendering exceeds ~180 ms, or right away if the document is
  large enough that the blocking phase would prevent that delay from
  triggering. The content already displayed stays scrollable underneath
  during a reload caused by a change on disk, and the animation, driven by
  `transform`, keeps spinning while the main thread is busy.

### Changed
- **Rendering of large LaTeX documents is ~25% faster** (`latex-doc` plugin
  1.2.1): the definition-collection pass now only parses the preamble.
  Measured on a 100 KB document with 933 formulas — 1,870 ms → 1,400 ms.

## [3.13.0] — 2026-08-21

### Added
- **In-document search (`Ctrl+F`), built in.** A compact bar opens in the
  top-right corner of the reading area: field, `n/m` counter,
  previous / next match and close. All matches are highlighted, the current
  one in a contrasting shade. `Enter` / `Shift+Enter` and `F3` / `Shift+F3`
  step through the results, `Esc` closes. The search applies to what is
  displayed: it follows the current mode (preview, source view, intermediate
  markdown) and is recomputed on each switch.
- **`Aa` / `ab` / `.*` options in both searches.** Attached to the right of
  the field, editor-style: match case, whole word, regular expression. An
  invalid pattern turns the field red instead of silently emptying the
  results.
- **Close button** on the multi-document search panel (`Ctrl+Shift+F`), to the
  right of the field.

### Changed
- **The webview's native search bar is replaced.** `Ctrl+F`, `F3` and `Ctrl+G`
  now open the application's bar. The old options panel ("Match case"
  (« Respecter la casse »), "Whole word" (« Mot entier »), "Match diacritics"
  (« Respecter les signes diacritiques »)) goes away with it: unthemed,
  untranslated and unrelated to the application's tab model.

### Notes
- "Whole word" recognizes accented letters, Greek and Cyrillic (`été`, `naïve`
  are whole words) where JavaScript's `\b` stops at ASCII.
- Table of contents, in-document search and multi-document search share the
  same anchor on screen: opening one closes the others.

## [3.12.0] — 2026-08-04

### Added
- **Choice of displayed icons, in the Settings (« Réglages »).** A "Displayed
  icons" (« Icônes affichées ») section lists the icons of the two bars — the
  window's (open, session, search, refresh, new window, information) and the
  document's (table of contents, source view, intermediate markdown, full
  width, export) — each with its preview and its checkbox. The setting is
  shared by all windows and persists across restarts.
- **"Intermediate markdown" view available in release builds.** The button
  that shows the markdown generated by a document plugin (`.tex`…) is no
  longer reserved for debug builds: it is enabled in the Settings, and stays
  **disabled by default**. It only appears on documents actually transformed
  by a plugin.

### Notes
- Only icons explicitly ticked or unticked are saved; all the others follow
  their default. A default changed in a later version will therefore apply to
  icons never touched, without overwriting a choice already made. "Reset"
  (« Réinitialiser ») erases these choices and hands control back to the
  defaults.
- The "Settings" (« Réglages ») icon always remains visible: it is the only
  access point to this dialog.
- Hiding an icon does not remove the function when it has a shortcut (Ctrl+O,
  Ctrl+Shift+F, Ctrl+Shift+N, F5 remain active). Disabling "Source view"
  (« Code source »), "Intermediate markdown" (« Markdown intermédiaire ») or
  "Full width" (« Pleine largeur ») brings the views concerned back to normal
  display, so as not to leave them in a state that could no longer be exited.

## [3.11.1] — 2026-07-31

### Fixed
- **Source view (« Code source »): stray margins at the top and left.** The view inherited the reading indent meant for the centered
  preview, and reserved room for five digits in its gutter whatever the
  document. The first line now sits flush with the top of the area and the
  gutter is sized to the actual number of lines — the numbers and the code
  gain the width that was lost (all the more visible under page zoom).

## [3.11.0] — 2026-07-31

### Added
- **Syntax highlighting of the source view (« Code source »)**:
  the *source code* button no longer shows uniform grey text. Markdown is
  colored by the grammar bundled in the application; formats served by a
  plugin are colored by the plugin itself — `.tex`/`.latex` for latex-doc,
  highlighting added in its version 1.1.0. A format without a grammar stays
  in plain text, as before. Preview ↔ source alignment, line numbers and line
  folding are unchanged: the highlighting is painted over the lines already
  laid out, without changing either their number or their height.
- Search (`Ctrl+Shift+F`) and highlighting of the selected word now find
  matches **spanning two colors** in the source view (they would have been
  lost, since highlighting splits a line into several text fragments).

## [3.10.1] — 2026-07-21

### Fixed
- **The 2nd row of tabs uses the full width of the window**: it stopped at the
  level of the action buttons even though those only occupy the first row.
  Only the 1st row now stops before the buttons, the extra tabs go underneath
  and have the full width available — title compression kicks in later and
  truncates less.

## [3.10.0] — 2026-07-21

### Added
- **Two-row tab bar when space runs out**: instead of compressing titles as
  soon as the first row is full, the following tabs wrap onto a second row
  while keeping their natural width (the action buttons stay at the top
  right). Title compression only resumes when both rows are full, spread
  evenly to fit exactly two rows. The bar goes back to one row by itself when
  tabs are closed or the window is widened. Tab drag-and-drop (reordering,
  detaching) works on both rows.

## [3.9.1] — 2026-07-18

### Fixed
- **Blurry icon at some Windows display scales**: the application icon
  (taskbar, title bar, Alt-Tab, File Explorer) could look blurry at 125% /
  150% / 200% scales, because Windows had to resize a neighboring size. The
  `.ico` file now embeds all 16 sizes of the Windows DPI grid (16 → 256 px,
  including 20, 30, 36, 40, 60, 72, 96, 180), encoded as BMP for maximum
  compatibility with the shell: each context finds an exact match, with no
  scaling.

## [3.9.0] — 2026-07-15

### Added
- **Opening of static HTML pages** (`.html`, `.htm`) — notably the
  application's HTML exports, which can now be reread in Kroki Desk. The Open
  dialog, drag-and-drop, command line, `.kdws` sessions and relative links
  in documents accept these extensions. The page is displayed as is in a tab,
  through a sandboxed iframe (no script executed); view actions (source view,
  table of contents, export, global search) do not apply to these tabs.

## [3.8.0] — 2026-07-15

### Added
- **`.kdws` sessions**: a JSON file that lists documents to reopen, grouped
  by window, in tab order (active tab included). The new "stack" button in the
  tab bar saves the current state (all windows, the calling window first);
  paths are made relative to the `.kdws` location when possible (`/`
  separator, portable Windows/Linux format). A `.kdws` opens by drag-and-drop,
  the Open dialog, the command line or double-click (once the file type is
  associated): the session's first window opens in the target window, the
  following ones in new windows. Files that are missing or unsupported are
  skipped and reported (toast); the application still does not restore
  anything automatically at startup.

## [3.7.0] — 2026-07-15

### Added
- **Export the rendered view as a standalone HTML page**: new button (download
  arrow) in the view action stack, to the right of the rendered view. The
  exported page embeds the application's stylesheets (forced or automatic theme
  preserved), diagrams as inline SVG and local images as data URIs — viewable
  in any browser, with no application and no network. Plotly figures are
  exported frozen (SVG snapshot, no interactivity); KaTeX fonts are not
  embedded (fallback to system fonts).

### Changed
- **Slimmer tab bar** (two fewer buttons): **plugins** are now managed from
  Settings → "Manage plugins…" (« Réglages → Gérer les plugins… »), and the
  change log (**What's new**, « Nouveautés ») from the information dialog,
  renamed **"Information"** (« Informations ») — which now also shows the
  application version above the status of the runtimes and engines.

## [3.6.0] — 2026-07-15

### Added
- **Plugin changelog** (protocol v1, §3.1): a plugin can ship a `CHANGELOG.md`
  at the root of its `.kdext` archive. When present, its card in the Plugins
  dialog gets a **"What's new"** (« Nouveautés ») button that shows it in the
  application's changelog dialog — markdown rendered and sanitized by the host,
  without running the plugin. Pure naming convention: no manifest field,
  compatible with existing plugins.

## [3.5.0] — 2026-07-15

### Added
- **`.kdext` archives: all the usual zip compression methods** are now
  accepted when installing a plugin — Store (Copy), Deflate, Deflate64, BZip2,
  LZMA and Zstandard (previously: Deflate and Store only). An archive packed
  with 7-Zip therefore works whichever method is chosen, except for PPMd
  (deliberately excluded, marginal use), whose rejection now shows the real
  cause instead of a misleading "manifest.json missing" (« manifest.json
  absent »).

## [3.4.0] — 2026-07-13

### Added
- **`fence:markdown` plugin capability** (protocol v1, §6.3): a plugin can
  render a fence block as **derived markdown**, fed back through the
  application's full pipeline (markdown-it + DOMPurify) and then hydrated
  recursively — native Kroki diagrams and plugin highlighting included. Nesting
  depth is bounded, derived `data-source-line` attributes are neutralized.
- **"Open folder" button** (« Ouvrir le dossier ») in the Plugins dialog: opens
  the plugins folder (`%APPDATA%\kroki-deskapp\plugins` on Windows,
  `$XDG_CONFIG_HOME/kroki-deskapp/plugins` on Linux) in the platform's file
  manager — the folder is created if it doesn't exist yet. Handy for the
  plugin development loop (copying a `plugins/<id>/` folder directly).

## [3.2.0] — 2026-07-13

### Added
- **Search across all open documents** (magnifier button in the tab bar or
  `Ctrl+Shift+F`): a panel searches the typed text in the **source** of every
  tab in the window (case-insensitive, including tabs that were never
  displayed). Results are grouped by document with line number and excerpt;
  clicking a result activates the tab and brings the line to the top of the
  view (preview or source view), with all occurrences highlighted in the
  displayed view as long as the panel is open. `Esc` closes the panel.

## [3.1.0] — 2026-07-13

### Changed
- Internal changes, no effect on this distribution's features.

## [3.0.0] — 2026-07-13

### Added
- **Plugin system** (protocol v1, spec `doc/plugin-protocol.md`): `.kdext`
  archives add file types (`document:markdown`), fence languages
  (`fence:svg`/`fence:html`) and highlighters (`highlight:code`) **without
  recompiling the application**. Each plugin runs in a sandboxed worker (no
  DOM, no Tauri commands, no disk — JSON messages only; reading neighboring
  files is opt-in and confined to the document's folder). Install by dragging a
  `.kdext` onto the window or through the new **Plugins** dialog in the toolbar
  (cards with name/description/version/status, removal, "Add a plugin…"
  (« Ajouter un plugin… ») button); a trust dialog is always shown (publisher,
  version, capabilities in plain language), previous version kept as `.bak`.
  Plugins live in `%APPDATA%\kroki-deskapp\plugins` (path without a publisher
  identifier).
- **`scripts/pack_plugin.ps1` script**: packs a plugin folder into a `.kdext`
  in `dist/`.

### Changed
- **CSP**: the `plugin://` protocol (read-only, confined to the plugins folder)
  is allowed in `script-src`/`connect-src` so plugin modules and assets can be
  loaded in their worker.

## [2.9.1] — 2026-07-10

### Changed
- Internal changes, no effect on this distribution's features.

## [2.9.0] — 2026-07-10

### Changed
- Internal changes, no effect on this distribution's features.

## [2.8.3] — 2026-07-09

### Changed
- Internal changes, no effect on this distribution's features.

## [2.8.2] — 2026-07-09

### Changed
- Internal changes, no effect on this distribution's features.

## [2.8.1] — 2026-07-09

### Changed
- Internal changes, no effect on this distribution's features.

## [2.8.0] — 2026-07-09

### Changed
- Internal changes, no effect on this distribution's features.

## [2.7.0] — 2026-07-08

### Changed
- Internal changes, no effect on this distribution's features.

## [2.6.0] — 2026-07-08

### Changed
- Internal changes, no effect on this distribution's features.

## [2.5.2] — 2026-07-08

### Changed
- Internal changes, no effect on this distribution's features.

## [2.5.1] — 2026-07-07

### Changed
- Internal changes, no effect on this distribution's features.

## [2.5.0] — 2026-07-07

### Changed
- Internal changes, no effect on this distribution's features.

## [2.4.0] — 2026-07-07

### Changed
- Internal changes, no effect on this distribution's features.

## [2.3.0] — 2026-07-07

### Added
- **"What's new" button** (« Nouveautés ») in the toolbar (clock icon, next to
  the runtimes and settings buttons): shows the change log version by version,
  from newest to oldest. The changelog is embedded in the executable at
  compile time — always in sync with the installed version, no network access.

## [2.2.2] — 2026-07-07

### Changed
- Internal changes, no effect on this distribution's features.

## [2.2.1] — 2026-07-07

### Fixed
- **Label of the "Java engines" group** (« Moteurs Java ») (runtimes
  information window): the "(PlantUML, ditaa)" parenthetical is removed —
  redundant with the list of types shown under the group, and incomplete
  (c4plantuml was missing).

## [2.2.0] — 2026-07-07

### Changed
- Internal changes, no effect on this distribution's features.

## [2.1.1] — 2026-07-07

### Changed
- Internal changes, no effect on this distribution's features.

## [2.1.0] — 2026-07-07

### Changed
- Internal changes, no effect on this distribution's features.

## [2.0.0] — 2026-07-06

### Added
- **Links to a section of another document**: a relative markdown link with a
  fragment (`[..](second.md#section)`) opens the target document in a tab and
  then scrolls to the anchor. `xlink:href` links in graphviz SVGs are now
  clickable.

## [1.12.1] — 2026-07-06

### Changed
- Internal changes, no effect on this distribution's features.

## [1.12.0] — 2026-07-06

### Changed
- Internal changes, no effect on this distribution's features.

## [1.11.1] — 2026-07-06

### Changed
- Internal changes, no effect on this distribution's features.

## [1.11.0] — 2026-07-05

### Changed
- Internal changes, no effect on this distribution's features.

## [1.10.0] — 2026-07-05

### Added
- **Highlighting of occurrences of the selected word**: selecting a word in the
  document highlights all its other occurrences (case-insensitive search), in
  amber to stand out from the blue of the selection. Built on the CSS Custom
  Highlight API — no node is injected into the DOM, so diagram SVGs, source
  view and the native selection (painted on top) stay intact. The highlight
  disappears as soon as the selection is cleared or spans several words.

## [1.9.1] — 2026-07-04

### Fixed
- **YAML frontmatter** at the top of a document (`---` … `---`, typical of
  `SKILL.md` files): it was rendered as a mess — the opening `---` became a
  horizontal rule and the `key: value` block a lumped paragraph and then a
  setext heading because of the closing `---`. A dedicated markdown-it block
  rule now captures it and displays it as a readable key/value table. Source
  line numbers for the rest of the document are preserved (preview ↔ source
  alignment intact).

## [1.9.0] — 2026-07-01

### Added
- **"Full width" button** (« pleine largeur ») in the view action stack (below
  the source button): toggles the preview between its centered reading width
  (920 px) and the full window width. Mostly useful when zoomed out, where the
  logical width grows and would otherwise leave wide empty margins on the
  sides. The reading position is preserved when toggling (you stay at the
  heading shown at the top, as with source mode). Plotly figures re-fit to the
  new width; the source view stays full width.

## [1.8.1] — 2026-06-30

### Fixed
- **Table-of-contents anchors with special punctuation**: internal links
  (Markdown table of contents such as `[…](#…)`) to a heading containing ` — `
  (em dash) or `:` pointed to nothing — clicking had no effect. Slug generation
  collapsed consecutive spaces into a single hyphen whereas GitHub emits one
  per space (`Titre — sous` → `titre--sous`). Slugs now match GitHub: one
  hyphen per space.

## [1.8.0] — 2026-06-29

### Added
- **Global "Refresh" button** (« Rafraîchir »): added to the action bar next to
  the "Open" button (« Ouvrir »), it re-reads **all** open tabs from disk and
  re-renders them. The **F5** and **Ctrl+R** shortcuts remain limited to the
  **active** tab.

## [1.7.0] — 2026-06-27

### Added
- **Table of contents**: a dedicated button, stacked above the "source" button
  (« code source ») in the top-right corner of the rendering area, unfolds to
  its left a panel listing chapters and sub-chapters (`#`…`######` headings,
  indented by level). Clicking an entry jumps straight to the heading — to the
  element in *preview* mode, to the matching line in *source* mode — and closes
  the panel. The panel also closes on an outside click, the `Esc` key or a tab
  change.

## [1.6.0] — 2026-06-27

### Added
- **Source view of a tab**: a floating button in the top-right corner of the
  rendering area toggles the **active** tab (and only that one) between the
  *preview* rendering and the read-only **raw Markdown source** (monospace,
  line numbers). The default behavior on open remains the *preview*. Toggling
  **preserves the reading position**: the first line shown at the top stays
  aligned between the two modes (mapped through `data-source-line` on the
  rendered blocks).

## [1.5.0] — 2026-06-26

### Added
- **Theme setting (Settings → Theme)** (« Réglages → Thème »): *Automatic*
  (follows the system, default), *Light* or *Dark*, forcing the appearance
  independently of the Windows setting. The override covers the whole
  interface — chrome, **document body** (`github-markdown`) and code syntax
  highlighting (`highlight.js`) — not just the app palette. The choice is
  persisted and propagated live to all open windows. In *Automatic* mode, the
  interface keeps following system switches.

### Fixed
- **Plotly figures unreadable in dark theme**: a ` ```plotly ` figure was
  placed on the white card reserved for Kroki diagrams while receiving light
  gray text (gray on white, unreadable). Plotly is now rendered natively in
  dark — transparent background (the figure blends into the page), light text
  and lightened grids/axes on all subplots. Kroki SVG diagrams (mermaid,
  graphviz, plantuml…), whose colors are fixed by their engine, deliberately
  stay on a white card.

## [1.4.2] — 2026-06-26

### Fixed
- **Misplaced hover on Plotly figures under page zoom**: page zoom (`Ctrl +/-`,
  `Ctrl+wheel`), applied through the CSS `zoom` property, skewed Plotly's
  hit-testing — which doesn't compensate for an ancestor's `zoom`: it draws its
  plot in logical pixels but locates the cursor in visual pixels, so the
  tooltip pointed at another point, with an offset growing with the zoom. The
  figure now neutralizes the inherited scale (`--plotly-inv-zoom`, effective
  1:1 scale) and its plot is re-fit to the column width via `Plotly.relayout`
  while preserving the aspect ratio — rather than via `Plots.resize`, which
  overwrote the height of a container with no CSS height.

## [1.4.1] — 2026-06-26

### Fixed
- **Plotly figures displayed twice**: when a static image (`![…](x.png)`)
  immediately precedes a ` ```plotly src=x.json ` block with the same *stem*
  (its portable fallback), both were rendered and each figure appeared twice.
  `hidePairedFallbackImage` now hides the image once the interactive rendering
  succeeds; on failure, the PNG stays visible.

## [1.4.0] — 2026-06-26

### Added
- **Interactive Plotly charts**: a ` ```plotly ` block is rendered as an
  **interactive** figure (hover / zoom / pan) in the main window, bypassing the
  Kroki engines' SVG pipeline. The `{data, layout}` spec is provided as inline
  JSON or via `src=file.json`. The Plotly bundle (~4.8 MB) is loaded on demand
  at the first figure (`'self'` script, no CSP change — `'unsafe-eval'` is
  already allowed for d2).
- `read_data_file` backend command to read the spec JSON, **confined to the
  document's folder**: absolute paths rejected, traversal protection (`..` /
  symlink) and `.json` allowlist.

## [1.3.0] — 2026-06-26

### Added
- Inline (`$…$`) and block (`$$…$$`) LaTeX **math formulas**, rendered by
  embedded **KaTeX** (`markdown-it-texmath` plugin). `.woff2` fonts are
  included in the executable: local rendering, no network, no `eval`.
  DOMPurify's `mathMl` profile is enabled to preserve accessibility MathML.

## [1.2.0] — 2026-06-15

### Added
- **erd** and **excalidraw** diagram engines embedded.
- **ditaa** engine embedded via a `.jar` (SVG output, run as a subprocess).
- **"Runtimes & engines"** dialog (« Runtimes & moteurs »): status of each
  engine (supported / missing system prerequisite / unsupported).
- **Drag and drop** of text files from Cursor / VS Code (`CF_UNICODETEXT` /
  `text/uri-list`, beyond Explorer's `CF_HDROP` alone).
- **Drag and drop of folders**: expanded to their direct Markdown files.
- A **new window** opens when the executable is launched again.
- Degraded **Linux** support (conditional compilation, JS/WASM rendering under
  WebKitGTK; cross-window drag remains Windows-specific).

### Performance
- Hidden rendering webview started off the critical startup path.
- Diagram engines loaded **on demand** rather than at boot.

### Removed
- Orphaned `xdita.jar` removed from the assets.

## [1.1.0] — 2026-06-10

### Added
- **d2**, **dbml** and **bpmn** engines.

## [1.0.0] — 2026-06-10

### Added
- Initial release: native Windows Markdown viewer (Tauri 2 / Rust), with
  **built-in** Kroki diagram rendering (mermaid, plantuml, graphviz, svgbob,
  pikchr, vega/vegalite…) with no server, no Docker, no network.
- GitHub-style Markdown: tables, task lists, syntax highlighting, heading
  anchors, relative links between `.md` files, local images.
- **Tabs** (reorderable, closed with middle-click / `Ctrl+W`) and
  **multi-window** with tab detaching by drag and drop.
- Drag and drop of `.md` files, automatic reload on disk change.
- Single-instance **CLI** and **local Kroki API** (HTTP `127.0.0.1`), plus
  support for an optional external Kroki server.

[3.25.0]: #3250--2026-10-16
[3.24.0]: #3240--2026-10-16
[3.23.1]: #3231--2026-10-14
[3.23.0]: #3230--2026-10-12
[3.22.0]: #3220--2026-10-05
[3.21.0]: #3210--2026-09-25
[3.20.0]: #3200--2026-09-24
[3.19.0]: #3190--2026-09-17
[3.18.1]: #3181--2026-09-16
[3.18.0]: #3180--2026-09-16
[3.17.1]: #3171--2026-09-07
[3.17.0]: #3170--2026-09-03
[3.16.0]: #3160--2026-08-28
[3.15.1]: #3151--2026-08-25
[3.15.0]: #3150--2026-08-24
[3.14.0]: #3140--2026-08-21
[3.13.0]: #3130--2026-08-21
[3.12.0]: #3120--2026-08-04
[3.11.1]: #3111--2026-07-31
[3.11.0]: #3110--2026-07-31
[3.10.1]: #3101--2026-07-21
[3.10.0]: #3100--2026-07-21
[3.9.1]: #391--2026-07-18
[3.9.0]: #390--2026-07-15
[3.8.0]: #380--2026-07-15
[3.7.0]: #370--2026-07-15
[3.6.0]: #360--2026-07-15
[3.5.0]: #350--2026-07-15
[3.4.0]: #340--2026-07-13
[3.3.0]: #330--2026-07-13
[3.2.0]: #320--2026-07-13
[3.1.0]: #310--2026-07-13
[3.0.0]: #300--2026-07-13
[2.9.1]: #291--2026-07-10
[2.9.0]: #290--2026-07-10
[2.8.3]: #283--2026-07-09
[2.8.2]: #282--2026-07-09
[2.8.1]: #281--2026-07-09
[2.8.0]: #280--2026-07-09
[2.7.0]: #270--2026-07-08
[2.6.0]: #260--2026-07-08
[2.5.2]: #252--2026-07-08
[2.5.1]: #251--2026-07-07
[2.5.0]: #250--2026-07-07
[2.4.0]: #240--2026-07-07
[2.3.0]: #230--2026-07-07
[2.2.2]: #222--2026-07-07
[2.2.1]: #221--2026-07-07
[2.2.0]: #220--2026-07-07
[2.1.1]: #211--2026-07-07
[2.1.0]: #210--2026-07-07
[2.0.0]: #200--2026-07-06
[1.12.1]: #1121--2026-07-06
[1.12.0]: #1120--2026-07-06
[1.11.1]: #1111--2026-07-06
[1.11.0]: #1110--2026-07-05
[1.10.0]: #1100--2026-07-05
[1.9.1]: #191--2026-07-04
[1.9.0]: #190--2026-07-01
[1.8.1]: #181--2026-06-30
[1.8.0]: #180--2026-06-29
[1.7.0]: #170--2026-06-27
[1.6.0]: #160--2026-06-27
[1.5.0]: #150--2026-06-26
[1.4.2]: #142--2026-06-26
[1.4.1]: #141--2026-06-26
[1.4.0]: #140--2026-06-26
[1.3.0]: #130--2026-06-26
[1.2.0]: #120--2026-06-15
[1.1.0]: #110--2026-06-10
[1.0.0]: #100--2026-06-10
