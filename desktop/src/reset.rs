use sha2::{Digest, Sha256};
use std::{
    fs, io,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

#[derive(Clone)]
pub struct ResetScope {
    pub data: PathBuf,
    pub service: String,
    pub environment: String,
}

pub fn keychain_service(identifier: &str, test_data: Option<&Path>) -> String {
    match test_data {
        Some(path) => format!(
            "{identifier}.credentials.test.{:x}",
            Sha256::digest(path.as_os_str().as_encoded_bytes())
        ),
        None => format!("{identifier}.credentials"),
    }
}

// Keep the lock file/inode and unrelated files. Never follow a top-level symlink.
const OWNED_PATHS: &[&str] = &[
    "springroll.sqlite",
    "springroll.sqlite-wal",
    "springroll.sqlite-shm",
    "model-catalog.sqlite",
    "model-catalog.sqlite-wal",
    "model-catalog.sqlite-shm",
    "artifacts",
    "codex",
    "claude",
    "subscription-runtimes",
    "desktop-engine",
    "rivet-engine",
    "runtime.log",
];

pub fn clear_owned_data(data: &Path) -> io::Result<()> {
    if fs::canonicalize(data)? != data {
        return Err(io::Error::other(
            "Workspace location changed; reset stopped",
        ));
    }
    for name in OWNED_PATHS {
        let path = data.join(name);
        let info = match fs::symlink_metadata(&path) {
            Ok(info) => info,
            Err(e) if e.kind() == io::ErrorKind::NotFound => continue,
            Err(e) => return Err(e),
        };
        if info.is_dir() && !info.file_type().is_symlink() {
            fs::remove_dir_all(path)?;
        } else {
            fs::remove_file(path)?;
        }
    }
    Ok(())
}

pub fn clear_keychain(service: &str) -> Result<(), String> {
    // Service-only deletion removes one matching entry per call, including
    // orphaned credentials whose database connection has already been deleted.
    for _ in 0..10_000 {
        let result = Command::new("/usr/bin/security")
            .args(["delete-generic-password", "-s", service])
            .stdin(Stdio::null())
            .output()
            .map_err(|e| e.to_string())?;
        match result.status.code() {
            Some(0) => continue,
            Some(44) => return Ok(()), // errSecItemNotFound
            _ => return Err("Could not clear this workspace's Keychain credentials. Unlock Keychain and retry reset.".into()),
        }
    }
    Err("Keychain cleanup did not finish; retry reset.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;
    #[test]
    fn environments_have_distinct_stable_services() {
        let prod = keychain_service("com.springroll.desktop", None);
        assert_eq!(prod, "com.springroll.desktop.credentials");
        let dev = keychain_service("com.springroll.desktop.prototype", None);
        let a = keychain_service(
            "com.springroll.desktop.prototype",
            Some(Path::new("/tmp/a")),
        );
        assert_ne!(prod, dev);
        assert_ne!(a, dev);
        assert_ne!(
            a,
            keychain_service(
                "com.springroll.desktop.prototype",
                Some(Path::new("/tmp/b"))
            )
        );
        assert_eq!(
            a,
            keychain_service(
                "com.springroll.desktop.prototype",
                Some(Path::new("/tmp/a"))
            )
        );
    }
    #[test]
    fn reset_removes_only_owned_paths_and_does_not_follow_links() {
        let base = std::env::temp_dir().join(format!("springroll-reset-{}", std::process::id()));
        fs::create_dir_all(&base).unwrap();
        let base = fs::canonicalize(base).unwrap();
        let data = base.join("workspace");
        let other = base.join("other");
        fs::create_dir_all(&data).unwrap();
        fs::create_dir_all(&other).unwrap();
        fs::write(other.join("keep"), "other environment").unwrap();
        fs::write(data.join("springroll.sqlite"), "fixture").unwrap();
        fs::write(data.join("springroll.sqlite-wal"), "fixture").unwrap();
        fs::write(data.join("desktop.lock"), "lock").unwrap();
        fs::write(data.join("unrelated"), "keep").unwrap();
        symlink(&other, data.join("artifacts")).unwrap();
        fs::create_dir(data.join("codex")).unwrap();
        symlink(&other, data.join("codex/linked")).unwrap();
        clear_owned_data(&data).unwrap();
        assert!(!data.join("springroll.sqlite").exists());
        assert!(!data.join("springroll.sqlite-wal").exists());
        assert!(data.join("desktop.lock").exists());
        assert!(data.join("unrelated").exists());
        assert!(other.join("keep").exists());
        clear_owned_data(&data).unwrap();
        fs::remove_dir_all(base).unwrap();
    }
}
