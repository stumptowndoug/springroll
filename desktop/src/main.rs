use fs2::FileExt;
use std::{
    fs::{self, File, OpenOptions},
    io::{BufRead, BufReader},
    net::TcpListener,
    os::unix::process::CommandExt,
    process::{Child, Command, Stdio},
    sync::{mpsc, Mutex},
    time::{Duration, Instant},
};
use tauri::{Manager, WebviewWindowBuilder};

#[derive(Default)]
struct Runtime(Mutex<Vec<Child>>);

#[derive(Default)]
struct RuntimeOrigin(Mutex<Option<tauri::Url>>);

fn allowed_navigation(url: &tauri::Url, runtime: Option<&tauri::Url>) -> bool {
    (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || runtime.is_some_and(|runtime| url.origin() == runtime.origin())
}

fn oauth_return_url(path: &str, runtime: &tauri::Url) -> Option<tauri::Url> {
    if !path.starts_with('/') || path.starts_with("//") {
        return None;
    }
    let url = runtime.join(path).ok()?;
    if url.origin() != runtime.origin()
        || !(url.path() == "/integrations"
            || url.path().starts_with("/chat/")
            || url.path().starts_with("/inbox/"))
    {
        return None;
    }
    Some(url)
}

impl Runtime {
    fn stop(&self) {
        for mut child in self.0.lock().unwrap().drain(..).rev() {
            let group = -(child.id() as i32);
            // Stop the application before its explicitly owned scheduler.
            unsafe {
                libc::kill(group, libc::SIGTERM);
            }
            let deadline = Instant::now() + Duration::from_secs(10);
            while Instant::now() < deadline {
                if child.try_wait().ok().flatten().is_some() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            unsafe {
                libc::kill(group, libc::SIGKILL);
            }
            let _ = child.wait();
        }
    }
}

fn launch(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let resources = app.path().resource_dir()?.join("runtime");
    let data = if cfg!(debug_assertions) {
        std::env::var_os("SPRINGROLL_DESKTOP_TEST_DATA_DIR")
            .map(std::path::PathBuf::from)
            .unwrap_or(app.path().app_data_dir()?)
    } else {
        app.path().app_data_dir()?
    };
    if !data.is_absolute() {
        return Err("Desktop data directory must be absolute".into());
    }
    fs::create_dir_all(&data)?;
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(data.join("desktop.lock"))?;
    lock.try_lock_exclusive()
        .map_err(|_| "Springroll is already running. Switch to its existing window.")?;
    app.manage(lock);
    let log = File::create(data.join("runtime.log"))?;
    let engine_port = (18000..19000)
        .step_by(20)
        .find(|port| {
            [0, 1, 10]
                .iter()
                .all(|offset| TcpListener::bind(("127.0.0.1", port + offset)).is_ok())
        })
        .ok_or("No local scheduler ports are available")?;
    let engine = Command::new(resources.join("bin/rivet-engine"))
        .arg("start")
        .env("RIVET__GUARD__HOST", "127.0.0.1")
        .env("RIVET__GUARD__PORT", engine_port.to_string())
        .env("RIVET__API_PEER__HOST", "127.0.0.1")
        .env("RIVET__API_PEER__PORT", (engine_port + 1).to_string())
        .env("RIVET__METRICS__HOST", "127.0.0.1")
        .env("RIVET__METRICS__PORT", (engine_port + 10).to_string())
        .env("RIVET__FILE_SYSTEM__PATH", data.join("desktop-engine"))
        .env("RIVET__TELEMETRY__ENABLED", "false")
        .stdin(Stdio::null())
        .stdout(log.try_clone()?)
        .stderr(log.try_clone()?)
        .process_group(0)
        .spawn()?;
    app.state::<Runtime>().0.lock().unwrap().push(engine);
    let deadline = Instant::now() + Duration::from_secs(20);
    while std::net::TcpStream::connect(("127.0.0.1", engine_port)).is_err() {
        if Instant::now() > deadline {
            return Err("Local scheduler did not become ready".into());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    let oauth_path = resources.join("oauth-clients.json");
    let oauth: std::collections::HashMap<String, String> = if oauth_path.exists() {
        serde_json::from_slice(&fs::read(oauth_path)?)?
    } else {
        std::collections::HashMap::new()
    };
    let oauth = oauth.into_iter().filter(|(key, _)| matches!(key.as_str(),
        "SPRINGROLL_GOOGLE_OAUTH_CLIENT_ID" | "SPRINGROLL_GOOGLE_OAUTH_CLIENT_SECRET" |
        "SPRINGROLL_MICROSOFT_OAUTH_CLIENT_ID"));
    let mut child = Command::new(resources.join("bin/bun"))
        .envs(oauth)
        .arg("--no-env-file")
        .arg(resources.join("app/src/main.ts"))
        .current_dir(&data)
        .env("SPRINGROLL_DATA_DIR", &data)
        .env("SPRINGROLL_DESKTOP", "1")
        .env("SPRINGROLL_RESOURCES_DIR", &resources)
        .env(
            "SPRINGROLL_KEYCHAIN_SERVICE",
            format!("{}.credentials", app.config().identifier),
        )
        .env_remove("SPRINGROLL_DB_PATH")
        .env_remove("SPRINGROLL_MODEL_CATALOG_PATH")
        .env_remove("SPRINGROLL_MCP_TOKEN")
        .env("PORT", "0")
        .env("RIVET_RUN_ENGINE_PORT", engine_port.to_string())
        .env("RIVET_RUN_ENGINE_HOST", "127.0.0.1")
        .env("RIVET_ENDPOINT", format!("http://127.0.0.1:{engine_port}"))
        .env("RIVETKIT_STORAGE_PATH", data.join("rivet-engine"))
        .env(
            "RIVET_ENGINE_BINARY_PATH",
            resources.join("bin/rivet-engine"),
        )
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(log.try_clone()?)
        .process_group(0)
        .spawn()?;
    let stdout = child.stdout.take().ok_or("Runtime stdout missing")?;
    app.state::<Runtime>().0.lock().unwrap().push(child);
    let (sender, receiver) = mpsc::channel();
    let oauth_app = app.clone();
    std::thread::spawn(move || {
        use std::io::Write;
        let mut log = log;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(value) = line.strip_prefix("Springroll desktop OAuth result: ") {
                if let Ok(path) = serde_json::from_str::<String>(value) {
                    let origin = oauth_app.state::<RuntimeOrigin>().0.lock().unwrap().clone();
                    if let Some(url) = origin
                        .as_ref()
                        .and_then(|origin| oauth_return_url(&path, origin))
                    {
                        if let Some(window) = oauth_app.get_webview_window("main") {
                            let _ = window.navigate(url);
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                }
                // Callback details belong in the app, not persisted in runtime logs.
                continue;
            }
            if let Some(url) = line.strip_prefix("Springroll is ready at ") {
                let _ = sender.send(url.to_owned());
            }
            let _ = writeln!(log, "{line}");
        }
    });
    let url: tauri::Url = receiver.recv_timeout(Duration::from_secs(60))
        .map_err(|_| "Local runtime did not become ready. See runtime.log in the app’s Application Support directory.")?.parse()?;
    if url.scheme() != "http" || url.host_str() != Some("127.0.0.1") {
        return Err("Runtime returned an unexpected address".into());
    }
    app.add_capability(serde_json::json!({
        "identifier": "native-header",
        "windows": ["main"],
        "local": false,
        "remote": { "urls": [format!("{}/*", url.origin().ascii_serialization())] },
        "permissions": ["core:window:allow-start-dragging", "core:window:allow-internal-toggle-maximize"]
    }).to_string())?;
    *app.state::<RuntimeOrigin>().0.lock().unwrap() = Some(url.clone());
    app.get_webview_window("main")
        .ok_or("Window missing")?
        .navigate(url)?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(Runtime::default())
        .manage(RuntimeOrigin::default())
        .setup(|app| {
            let signal_app = app.handle().clone();
            ctrlc::set_handler(move || signal_app.exit(0))?;
            let navigation_app = app.handle().clone();
            let window_config = tauri::utils::config::WindowConfig {
                label: "main".into(),
                traffic_light_position: Some(tauri::utils::config::LogicalPosition { x: 20.0, y: 20.0 }),
                ..Default::default()
            };
            WebviewWindowBuilder::from_config(app, &window_config)?
                .title(app.config().product_name.as_deref().unwrap_or("Springroll"))
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true)
                .traffic_light_position(tauri::LogicalPosition::new(20.0, 20.0))
                .initialization_script("document.addEventListener('DOMContentLoaded', () => { document.documentElement.dataset.desktop = 'true'; });")
                .inner_size(1180.0, 820.0)
                .min_inner_size(720.0, 540.0)
                .on_navigation(move |url| {
                    if url.scheme() == "https" {
                        let _ = Command::new("/usr/bin/open").arg(url.as_str()).spawn();
                        return false;
                    }
                    allowed_navigation(
                        url,
                        navigation_app
                            .state::<RuntimeOrigin>()
                            .0
                            .lock()
                            .unwrap()
                            .as_ref(),
                    )
                })
                .on_new_window(|url, _| {
                    if url.scheme() == "https" {
                        let _ = Command::new("/usr/bin/open").arg(url.as_str()).spawn();
                    }
                    tauri::webview::NewWindowResponse::Deny
                })
                .build()?;
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                if let Err(error) = launch(&handle) {
                    handle.state::<Runtime>().stop();
                    if let Some(window) = handle.get_webview_window("main") {
                        let text = serde_json::to_string(&error.to_string()).unwrap();
                        let _ = window.eval(&format!(
                            "document.getElementById('status').textContent = {text}"
                        ));
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Could not initialize Springroll")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                app.state::<Runtime>().stop();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oauth_returns_only_to_local_app_pages() {
        let runtime: tauri::Url = "http://127.0.0.1:50000/".parse().unwrap();
        for path in [
            "/integrations?oauth=connected",
            "/chat/123?oauthError=failed",
            "/inbox/123",
        ] {
            assert!(oauth_return_url(path, &runtime).is_some());
        }
        for path in [
            "//example.com",
            "/\\example.com",
            "https://example.com",
            "/api/tasks",
            "/settings",
        ] {
            assert!(oauth_return_url(path, &runtime).is_none());
        }
    }

    #[test]
    fn webview_stays_on_its_own_runtime_origin() {
        let runtime: tauri::Url = "http://127.0.0.1:50000/".parse().unwrap();
        for url in [
            "http://127.0.0.1:4117/",
            "https://example.com",
            "file:///etc/passwd",
            "http://localhost:50000/",
        ] {
            assert!(!allowed_navigation(&url.parse().unwrap(), Some(&runtime)));
        }
        assert!(allowed_navigation(
            &"http://127.0.0.1:50000/settings".parse().unwrap(),
            Some(&runtime)
        ));
        assert!(allowed_navigation(
            &"tauri://localhost/index.html".parse().unwrap(),
            None
        ));
    }
}
