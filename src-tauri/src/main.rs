// Pas de console en release (l'app reste utilisable en CLI : les arguments
// fonctionnent sans fenêtre de terminal).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// En tête : `tr!` (macro textuelle) doit être définie avant les modules qui l'emploient.
#[macro_use]
mod i18n;
mod commands;
#[cfg(windows)]
mod drop_target;
mod engine;
mod kroki;
mod manager;
mod plugins;
mod server;
mod session;
mod state;
mod updates;
mod watcher;

use std::path::PathBuf;

use tauri::{Manager, WindowEvent};

/// Options CLI (courte et longue, comme `docker run -d`) qui relancent
/// l'application détachée du terminal appelant.
const DETACH_FLAGS: [&str; 2] = ["-d", "--detach"];

/// `-d`/`--detach` : relance l'exe sans l'option, détaché du terminal (pas de
/// console, entrées/sorties nulles, groupe de processus propre), puis quitte —
/// le shell reprend la main aussitôt, même sous bash, qui attend sinon la
/// fermeture d'un exe GUI. Fait avant tout le reste : l'instance relancée passe
/// ensuite par le chemin normal, `single-instance` compris. Si la relance
/// échoue, on continue au premier plan plutôt que de ne rien ouvrir.
fn detach_if_requested() {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    let is_detach = |a: &std::ffi::OsString| DETACH_FLAGS.iter().any(|f| a == f);
    if !args.iter().any(is_detach) {
        return;
    }
    let exe = match std::env::current_exe() {
        Ok(exe) => exe,
        Err(e) => {
            eprintln!("[cli] --detach: executable not found ({e}), running in the foreground");
            return;
        }
    };
    let rest: Vec<_> = args.iter().filter(|a| !is_detach(*a)).collect();
    let command = || {
        let mut cmd = std::process::Command::new(&exe);
        cmd.args(&rest)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        cmd
    };

    #[cfg(windows)]
    let spawned = {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
        let flags = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP;
        // Sortir du job de l'appelant (un terminal ou un agent qui tue son job
        // à la fermeture emporterait l'app) ; refusé si le job l'interdit,
        // d'où la seconde tentative sans.
        command()
            .creation_flags(flags | CREATE_BREAKAWAY_FROM_JOB)
            .spawn()
            .or_else(|_| command().creation_flags(flags).spawn())
    };
    #[cfg(unix)]
    let spawned = {
        use std::os::unix::process::CommandExt;
        // Groupe propre : hors du groupe de premier plan du terminal, donc ni
        // Ctrl+C ni le SIGHUP de sa fermeture ne l'atteignent.
        command().process_group(0).spawn()
    };

    match spawned {
        Ok(_) => std::process::exit(0),
        Err(e) => {
            eprintln!("[cli] --detach: relaunch failed ({e}), running in the foreground")
        }
    }
}

fn main() {
    detach_if_requested();
    tauri::Builder::default()
        // Doit être enregistré en premier : une seconde invocation de l'exe
        // (`kroki_deskapp.exe fichier.md`) forwarde ses arguments ici.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let args = manager::collect_file_args(argv.into_iter().skip(1), &PathBuf::from(cwd));
            if args.is_empty() {
                // Relance sans fichier (re-clic sur l'exe) → nouvelle fenêtre.
                manager::open_new_window(app);
            } else {
                // Fichiers passés (Explorateur, agent…) → onglets dans la
                // fenêtre existante, saut vers le fragment éventuel.
                manager::open_in_first_window(app, &args);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(state::AppState::default())
        .manage(state::SettingsState::default())
        .manage(kroki::KrokiState::default())
        .manage(watcher::WatcherState::default())
        .manage(engine::EngineState::default())
        .manage(server::ServerState::default())
        .invoke_handler(tauri::generate_handler![
            commands::get_window_state,
            commands::read_document,
            commands::render_diagram,
            commands::renderer_ready,
            commands::render_job_done,
            commands::open_paths,
            commands::open_file_dialog,
            commands::activate_tab,
            commands::close_tab,
            commands::close_tabs_around,
            commands::detach_tab,
            commands::reveal_tab_file,
            commands::reorder_tab,
            commands::new_window,
            commands::close_window,
            commands::set_title,
            commands::focus_window,
            commands::finish_tab_drag,
            commands::debug_finish_tab_drag_at,
            commands::get_settings,
            commands::get_runtimes,
            commands::get_changelog,
            commands::get_theme,
            commands::get_icons,
            commands::get_i18n,
            commands::set_settings,
            commands::open_link,
            commands::take_pending_anchors,
            commands::read_data_file,
            commands::export_html,
            commands::save_session,
            plugins::list_plugins,
            plugins::plugin_manifest_preview,
            plugins::install_plugin,
            plugins::uninstall_plugin,
            plugins::pick_plugin_archive,
            plugins::take_pending_plugin_installs,
            plugins::open_plugins_dir,
            plugins::plugin_changelog,
            plugins::plugin_read_sibling,
            updates::check_update,
        ])
        // Sert les fichiers des plugins au worker sandboxé (lecture seule,
        // confinée au dossier du plugin) : `http://plugin.localhost/<id>/…`
        // sous Windows, `plugin://localhost/<id>/…` sous Linux.
        .register_uri_scheme_protocol("plugin", |_ctx, request| plugins::serve(&request))
        .setup(|app| {
            let handle = app.handle().clone();
            commands::load_settings(&handle);
            // Langue avant tout message : seeding, scan et fenêtres en émettent.
            let language = handle.state::<state::SettingsState>().0.lock().unwrap().language.clone();
            i18n::set_language(&language);
            // Plugins livrés avec l'installeur : installés/mis à jour avant le
            // scan, pour que le registre parte de l'état final. Lit
            // `removed_plugins` des réglages — donc après `load_settings`.
            plugins::seed_bundled(&handle);
            // Registre des plugins avant la 1ʳᵉ fenêtre : les extensions
            // effectives (dialogs, drops, args CLI) en dépendent.
            plugins::init();
            watcher::init(&handle);
            // API Kroki locale pour les outils tiers.
            let s = handle
                .state::<state::SettingsState>()
                .0
                .lock()
                .unwrap()
                .clone();
            server::apply_settings(&handle, s.server_enabled, s.server_port);

            // Fenêtre principale d'abord : c'est le chemin critique de l'affichage.
            let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
            let args = manager::collect_file_args(std::env::args().skip(1), &cwd);
            let label = manager::create_window(&handle, None, None)?;
            manager::open_file_args(&handle, &label, &args);

            // Webview cachée des moteurs de rendu : créée hors du chemin critique.
            // Son `build()` bloque le main thread ~0,85 s (init WebView2) ; on le
            // diffère après l'affichage de la 1re fenêtre, sinon il retarderait son
            // apparition d'autant. `ensure_renderer` poste le `build()` sur le main
            // thread ; le court délai laisse la fenêtre faire son premier rendu.
            let h = handle.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(300));
                engine::ensure_renderer(&h);
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                let app = window.app_handle();
                if window.label() == engine::RENDERER_LABEL {
                    engine::renderer_destroyed(app);
                    return;
                }
                manager::cleanup_window(app, window.label());
                // La webview de rendu cachée ne doit pas maintenir l'app en vie.
                let no_doc_window = {
                    let st = app.state::<state::AppState>();
                    let st = st.0.lock().unwrap();
                    st.window_order.is_empty()
                };
                if no_doc_window {
                    app.exit(0);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running the application");
}
