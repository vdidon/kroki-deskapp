// No console in release (the app stays usable from the CLI: arguments
// work without a terminal window).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// First: `tr!` (a textual macro) must be defined before the modules that use it.
#[macro_use]
mod i18n;
mod commands;
#[cfg(windows)]
mod drop_target;
mod engine;
mod journal;
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

/// CLI options (short and long, like `docker run -d`) that relaunch the
/// application detached from the calling terminal.
const DETACH_FLAGS: [&str; 2] = ["-d", "--detach"];

/// `-d`/`--detach`: relaunches the exe without the option, detached from the
/// terminal (no console, null stdio, own process group), then exits —
/// the shell gets control back immediately, even under bash, which otherwise
/// waits for a GUI exe to close. Done before everything else: the relaunched
/// instance then goes through the normal path, `single-instance` included. If
/// the relaunch fails, we carry on in the foreground rather than open nothing.
fn detach_if_requested() {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    let is_detach = |a: &std::ffi::OsString| DETACH_FLAGS.iter().any(|f| a == f);
    if !args.iter().any(is_detach) {
        return;
    }
    let exe = match std::env::current_exe() {
        Ok(exe) => exe,
        Err(e) => {
            journal::warn(
                "cli",
                format!("--detach: executable not found ({e}), running in the foreground"),
            );
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
        // Break away from the caller's job (a terminal or an agent that kills
        // its job on close would take the app with it); refused if the job
        // forbids it, hence the second attempt without.
        command()
            .creation_flags(flags | CREATE_BREAKAWAY_FROM_JOB)
            .spawn()
            .or_else(|_| command().creation_flags(flags).spawn())
    };
    #[cfg(unix)]
    let spawned = {
        use std::os::unix::process::CommandExt;
        // Own group: outside the terminal's foreground group, so neither
        // Ctrl+C nor the SIGHUP from its closing reaches it.
        command().process_group(0).spawn()
    };

    match spawned {
        Ok(_) => std::process::exit(0),
        Err(e) => journal::warn(
            "cli",
            format!("--detach: relaunch failed ({e}), running in the foreground"),
        ),
    }
}

fn main() {
    detach_if_requested();
    tauri::Builder::default()
        // Must be registered first: a second invocation of the exe
        // (`kroki_deskapp.exe file.md`) forwards its arguments here.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let args = manager::collect_file_args(argv.into_iter().skip(1), &PathBuf::from(cwd));
            if args.is_empty() {
                // Relaunch with no file (re-click on the exe) → new window.
                manager::open_new_window(app);
            } else {
                // Files passed (Explorer, agent…) → tabs in the existing
                // window, jumping to the fragment if any.
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
            commands::duplicate_tab,
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
            journal::get_journal,
            journal::plugin_log,
        ])
        // Serves the plugins' files to the sandboxed worker (read-only,
        // confined to the plugin's folder): `http://plugin.localhost/<id>/…`
        // on Windows, `plugin://localhost/<id>/…` on Linux.
        .register_uri_scheme_protocol("plugin", |_ctx, request| plugins::serve(&request))
        .setup(|app| {
            let handle = app.handle().clone();
            // Before everything else: startup entries also go out to the
            // windows (earlier ones stay readable through `get_journal`).
            journal::attach(&handle);
            commands::load_settings(&handle);
            // Language before any message: seeding, scan and windows emit them.
            let language = handle.state::<state::SettingsState>().0.lock().unwrap().language.clone();
            let code = i18n::set_language(&language);
            // Bug-report context; Java and TeX are logged when they are
            // probed (on demand: no JVM launched at startup).
            let external = handle
                .state::<state::SettingsState>()
                .0
                .lock()
                .unwrap()
                .external_url
                .clone();
            journal::info(
                "app",
                format!(
                    "Kroki Desk {} ({} {}), interface language {code} (setting: {language}), rendering: {}",
                    env!("CARGO_PKG_VERSION"),
                    std::env::consts::OS,
                    std::env::consts::ARCH,
                    if external.is_empty() {
                        "built-in engines".to_string()
                    } else {
                        format!("external Kroki server {}", journal::redact_url(&external))
                    }
                ),
            );
            // Plugins shipped with the installer: installed/updated before the
            // scan, so the registry starts from the final state. Reads the
            // settings' `removed_plugins` — hence after `load_settings`.
            plugins::seed_bundled(&handle);
            // Plugin registry before the 1st window: the effective extensions
            // (dialogs, drops, CLI args) depend on it.
            plugins::init();
            watcher::init(&handle);
            // Local Kroki API for third-party tools.
            let s = handle
                .state::<state::SettingsState>()
                .0
                .lock()
                .unwrap()
                .clone();
            server::apply_settings(&handle, s.server_enabled, s.server_port);

            // Main window first: it is the critical path of the display.
            let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
            let args = manager::collect_file_args(std::env::args().skip(1), &cwd);
            let label = manager::create_window(&handle, None, None)?;
            manager::open_file_args(&handle, &label, &args);

            // Hidden webview of the rendering engines: created off the critical path.
            // Its `build()` blocks the main thread ~0.85 s (WebView2 init); we
            // defer it until after the 1st window is shown, otherwise it would delay
            // its appearance by as much. `ensure_renderer` posts the `build()` to the
            // main thread; the short delay lets the window do its first render.
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
                // The hidden render webview must not keep the app alive.
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
