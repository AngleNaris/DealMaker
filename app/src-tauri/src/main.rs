#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::Value;
use std::path::PathBuf;
use std::process::{Command, Stdio};

/// 项目根目录：开发时为 app/ 的上一级，打包后为 exe 同级
fn project_root() -> PathBuf {
    if let Ok(p) = std::env::var("DEALMAKER_ROOT") {
        return PathBuf::from(p);
    }
    // CARGO_MANIFEST_DIR = .../app/src-tauri
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    // .../app/src-tauri -> .../DealMaker
    manifest
        .parent() // app
        .and_then(|p| p.parent()) // project root
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."))
}

fn python_cmd() -> String {
    std::env::var("DEALMAKER_PYTHON").unwrap_or_else(|_| "python".into())
}

#[tauri::command]
fn backend_call(action: String, payload: Value) -> Result<Value, String> {
    let root = project_root();
    let payload_str =
        serde_json::to_string(&payload).map_err(|e| format!("payload 序列化失败: {e}"))?;

    let output = Command::new(python_cmd())
        .current_dir(&root)
        .args(["-m", "backend.cli", &action, &payload_str])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| {
            format!(
                "无法启动 Python 后端（{}）: {}。请确认已安装 Python 与 python-docx。",
                python_cmd(),
                e
            )
        })?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if stdout.is_empty() {
        return Err(if stderr.is_empty() {
            "后端无输出".into()
        } else {
            stderr
        });
    }

    // 取最后一行 JSON（避免警告污染）
    let json_line = stdout.lines().last().unwrap_or(&stdout);
    serde_json::from_str(json_line).map_err(|e| {
        format!(
            "后端 JSON 解析失败: {e}\nstdout: {stdout}\nstderr: {stderr}"
        )
    })
}

/// kind: file | dir | docx | image
#[tauri::command]
fn pick_path(kind: String) -> Result<Option<String>, String> {
    let ps = match kind.as_str() {
        "dir" => {
            "Add-Type -AssemblyName System.Windows.Forms; \
             $d = New-Object System.Windows.Forms.FolderBrowserDialog; \
             $d.Description = '选择文件夹'; \
             if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $d.SelectedPath }"
                .to_string()
        }
        "docx" => {
            "Add-Type -AssemblyName System.Windows.Forms; \
             $d = New-Object System.Windows.Forms.OpenFileDialog; \
             $d.Filter = 'Word 文档 (*.docx)|*.docx|所有文件 (*.*)|*.*'; \
             $d.Multiselect = $false; \
             if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $d.FileName }"
                .to_string()
        }
        "image" => {
            "Add-Type -AssemblyName System.Windows.Forms; \
             $d = New-Object System.Windows.Forms.OpenFileDialog; \
             $d.Filter = '图片 (*.png;*.jpg;*.jpeg;*.bmp;*.gif)|*.png;*.jpg;*.jpeg;*.bmp;*.gif|所有文件 (*.*)|*.*'; \
             $d.Multiselect = $false; \
             if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $d.FileName }"
                .to_string()
        }
        _ => {
            "Add-Type -AssemblyName System.Windows.Forms; \
             $d = New-Object System.Windows.Forms.OpenFileDialog; \
             $d.Multiselect = $false; \
             if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $d.FileName }"
                .to_string()
        }
    };

    let out = Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            &ps,
        ])
        .output()
        .map_err(|e| format!("无法打开选择对话框: {e}"))?;
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        Ok(None)
    } else {
        Ok(Some(s))
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![backend_call, pick_path])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
