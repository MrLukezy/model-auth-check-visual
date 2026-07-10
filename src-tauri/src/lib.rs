use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::Child;
use std::process::Command as StdCommand;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use tauri::Manager;

struct BackendHandle {
    child: Mutex<Option<Child>>,
    running: AtomicBool,
}

/// Locate the Python interpreter and backend directory at runtime.
///
/// Two supported layouts, tried in order:
///
/// 1. Portable (distribution): Real-O-Meter.exe sits next to:
///      Real-O-Meter/python/python.exe
///      Real-O-Meter/backend/server.py
///
/// 2. Dev (source tree): the executable is built in src-tauri/target/...
///    and the backend is at <manifest>/../backend. Python is expected on PATH.
fn resolve_backend() -> Option<(PathBuf, PathBuf)> {
    // Attempt 1: portable mode relative to the running executable
    if let Ok(exe) = std::env::current_exe() {
        let exe_dir = exe.parent().unwrap_or(Path::new(""));
        let backend = exe_dir.join("backend");
        let python = exe_dir.join("python").join("python.exe");
        if backend.join("server.py").exists() && python.exists() {
            println!(
                "[tauri] Portable mode: backend={}, python={}",
                backend.display(),
                python.display()
            );
            return Some((backend, python));
        }
    }

    // Attempt 2: dev mode relative to the cargo manifest directory
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let backend = manifest.join("..").join("backend");
    if backend.join("server.py").exists() {
        println!("[tauri] Dev mode: backend={}", backend.display());
        return Some((backend, PathBuf::from("python")));
    }

    None
}

fn spawn_backend(backend_dir: &Path, python_cmd: &Path) -> Result<Child, String> {
    StdCommand::new(python_cmd)
        .args([
            "-m",
            "uvicorn",
            "server:app",
            "--host",
            "127.0.0.1",
            "--port",
            "8765",
            "--log-level",
            "warning",
            "--no-access-log",
        ])
        .current_dir(backend_dir)
        // IMPORTANT: do NOT use Stdio::piped() here. server.py already writes its
        // application logs to backend/server.log via a FileHandler. If stdout/stderr
        // are piped but never drained, the OS pipe buffer (4-64 KB on Windows) fills
        // up and every child write() blocks forever — freezing the uvicorn event loop
        // and killing health checks / progress polling. Use null() to discard these
        // streams safely.
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| {
            format!(
                "Failed to start Python backend (command {:?}). Error: {e}",
                python_cmd
            )
        })
}

fn wait_for_backend_ready(timeout: Duration) -> bool {
    let deadline = std::time::Instant::now() + timeout;
    let probe_interval = Duration::from_millis(150);
    while std::time::Instant::now() < deadline {
        if TcpStream::connect("127.0.0.1:8765").is_ok() {
            return true;
        }
        thread::sleep(probe_interval);
    }
    false
}

fn kill_backend(handle: &BackendHandle) {
    if let Ok(mut child_opt) = handle.child.lock() {
        if let Some(ref mut child) = *child_opt {
            let _ = Child::kill(child);
            let _ = child.wait();
        }
        *child_opt = None;
    }
    handle.running.store(false, Ordering::SeqCst);
}

#[tauri::command]
async fn backend_status(state: tauri::State<'_, BackendHandle>) -> Result<bool, String> {
    if !state.running.load(Ordering::SeqCst) {
        return Ok(false);
    }
    Ok(TcpStream::connect("127.0.0.1:8765").is_ok())
}

#[tauri::command]
fn minimize_window(window: tauri::WebviewWindow) {
    let _ = window.minimize();
}

#[tauri::command]
fn toggle_maximize_window(window: tauri::WebviewWindow) {
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    } else {
        let _ = window.maximize();
    }
}

#[tauri::command]
fn close_window(window: tauri::WebviewWindow) {
    let _ = window.close();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(move |app| {
            let (backend_dir, python_cmd) = match resolve_backend() {
                Some(pair) => pair,
                None => {
                    eprintln!(
                        "[tauri] Could not locate backend/server.py in portable (exe_dir/backend) \
                         or dev (src-tauri/../backend) layout. Ensure the bundle contains \
                         python/python.exe and backend/server.py next to the executable."
                    );
                    app.manage(BackendHandle {
                        child: Mutex::new(None),
                        running: AtomicBool::new(false),
                    });
                    return Ok(());
                }
            };

            let backend_dir_full = backend_dir.canonicalize().unwrap_or(backend_dir.clone());

            let child = match spawn_backend(&backend_dir_full, &python_cmd) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("[tauri] {e}");
                    app.manage(BackendHandle {
                        child: Mutex::new(None),
                        running: AtomicBool::new(false),
                    });
                    return Ok(());
                }
            };

            app.manage(BackendHandle {
                child: Mutex::new(Some(child)),
                running: AtomicBool::new(true),
            });

            let wry_app = app.handle().clone();
            thread::spawn(move || {
                if wait_for_backend_ready(Duration::from_secs(15)) {
                    println!("[tauri] Python backend ready at http://localhost:8765");
                } else {
                    eprintln!("[tauri] Python backend did not become ready within 15s");
                    if let Some(state) = wry_app.try_state::<BackendHandle>() {
                        kill_backend(&state);
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            backend_status,
            minimize_window,
            toggle_maximize_window,
            close_window
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(state) = app_handle.try_state::<BackendHandle>() {
                kill_backend(&state);
                println!("[tauri] Python backend stopped");
            }
        }
    });
}
