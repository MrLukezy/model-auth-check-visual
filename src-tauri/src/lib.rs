use std::net::TcpStream;
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

fn spawn_backend(backend_dir: &std::path::Path) -> Result<Child, String> {
    StdCommand::new("python")
        .args([
            "-m",
            "uvicorn",
            "server:app",
            "--host",
            "127.0.0.1",
            "--port",
            "8765",
        ])
        .current_dir(backend_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| {
            format!(
                "Failed to start Python backend. Make sure Python is installed and on PATH. Error: {e}"
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(move |app| {
            let manifest = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
            let backend_dir = manifest.join("..").join("backend");
            let backend_dir = backend_dir.canonicalize().unwrap_or(backend_dir);

            if !backend_dir.join("server.py").exists() {
                eprintln!(
                    "[tauri] server.py not found at {}",
                    backend_dir.display()
                );
                app.manage(BackendHandle {
                    child: Mutex::new(None),
                    running: AtomicBool::new(false),
                });
                return Ok(());
            }

            let child = match spawn_backend(&backend_dir) {
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
        .invoke_handler(tauri::generate_handler![backend_status])
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
