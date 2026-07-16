use std::fs;
use std::path::PathBuf;

fn main() {
    // 发布版 include_bytes 依赖这两个文件；变更时重新编译
    println!("cargo:rerun-if-changed=resources/dealmaker-backend.exe");
    println!("cargo:rerun-if-changed=resources/officecli.exe");

    // 单一版本源：仓库根 VERSION
    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let version_file = manifest_dir
        .join("..")
        .join("..")
        .join("VERSION");
    println!("cargo:rerun-if-changed={}", version_file.display());

    let version = fs::read_to_string(&version_file)
        .unwrap_or_else(|_| env!("CARGO_PKG_VERSION").to_string())
        .trim()
        .to_string();
    if version.is_empty() {
        panic!("VERSION file is empty: {}", version_file.display());
    }
    println!("cargo:rustc-env=DEALMAKER_VERSION={version}");

    tauri_build::build()
}
