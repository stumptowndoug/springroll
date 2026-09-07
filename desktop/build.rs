fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["reset_info", "reset_springroll"]),
    ))
    .expect("Could not build desktop permissions")
}
