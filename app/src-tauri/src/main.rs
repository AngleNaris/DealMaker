#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// 发布版内嵌依赖（不含合同模板）。debug 不内嵌，走 Python 源码。
#[cfg(not(debug_assertions))]
const EMBEDDED_BACKEND: &[u8] = include_bytes!("../resources/dealmaker-backend.exe");
#[cfg(not(debug_assertions))]
const EMBEDDED_OFFICECLI: &[u8] = include_bytes!("../resources/officecli.exe");

/// 与仓库根 VERSION 同步（由 build.rs 注入）
const APP_VERSION: &str = env!("DEALMAKER_VERSION");

/// 可执行文件所在目录
fn exe_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
}

/// 用户数据根目录（.contract_tool、可选模板）
/// - 开发：仓库根 DealMaker/
/// - 发布：主程序 exe 同级（便携）
fn project_root() -> PathBuf {
    if let Ok(p) = std::env::var("DEALMAKER_ROOT") {
        let pb = PathBuf::from(p);
        if pb.is_dir() {
            return pb;
        }
    }

    // debug：CARGO_MANIFEST_DIR = .../app/src-tauri → 上两级 = 仓库根
    if cfg!(debug_assertions) {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        if let Some(root) = manifest.parent().and_then(|p| p.parent()) {
            if root.join("backend").is_dir() {
                return root.to_path_buf();
            }
        }
    }

    // 发布：始终 exe 同级（用户数据可随便携目录移动）
    exe_dir()
}

/// 运行时依赖目录：%LOCALAPPDATA%\DealMaker\runtime\
fn local_runtime_dir() -> Result<PathBuf, String> {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local").join("share"))
        })
        .ok_or_else(|| "无法定位 LOCALAPPDATA".to_string())?;
    Ok(base.join("DealMaker").join("runtime"))
}

/// 将内嵌文件写到目标路径（先写 .tmp 再替换，版本升级时覆盖旧文件）
#[cfg(not(debug_assertions))]
fn write_dep_file(path: &Path, data: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败 {}: {e}", parent.display()))?;
    }
    let tmp = path.with_extension("exe.tmp");
    fs::write(&tmp, data).map_err(|e| format!("写入临时文件失败 {}: {e}", tmp.display()))?;
    if path.exists() {
        fs::remove_file(path).map_err(|e| {
            format!(
                "无法覆盖旧依赖 {}（可能仍在运行）: {e}",
                path.display()
            )
        })?;
    }
    fs::rename(&tmp, path).map_err(|e| format!("替换依赖失败 {}: {e}", path.display()))?;
    Ok(())
}

/// 确保 LocalAppData 中有与当前主程序版本匹配的 backend / officecli。
/// 版本变化或文件缺失时自动覆盖。模板不内嵌、不写入此处。
fn ensure_runtime_deps() -> Result<PathBuf, String> {
    let dir = local_runtime_dir()?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建 runtime 目录失败: {e}"))?;

    let ver_path = dir.join(".version");
    let backend = dir.join("dealmaker-backend.exe");
    let officecli = dir.join("officecli.exe");
    let installed = fs::read_to_string(&ver_path)
        .unwrap_or_default()
        .trim()
        .to_string();
    let ready = installed == APP_VERSION && backend.is_file() && officecli.is_file();
    if ready {
        return Ok(dir);
    }

    #[cfg(not(debug_assertions))]
    {
        write_dep_file(&backend, EMBEDDED_BACKEND)?;
        write_dep_file(&officecli, EMBEDDED_OFFICECLI)?;
        fs::write(&ver_path, APP_VERSION).map_err(|e| format!("写入版本标记失败: {e}"))?;
        return Ok(dir);
    }

    #[cfg(debug_assertions)]
    {
        // 开发：不内嵌，尽量从仓库 resources / 根目录复制，便于联调 runtime 路径
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let candidates = [
            manifest.join("resources"),
            manifest
                .parent()
                .and_then(|p| p.parent())
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| manifest.clone()),
        ];
        let find = |name: &str| -> Option<PathBuf> {
            for base in &candidates {
                let p = base.join(name);
                if p.is_file() {
                    return Some(p);
                }
            }
            None
        };
        if let Some(src) = find("dealmaker-backend.exe") {
            fs::copy(&src, &backend).map_err(|e| format!("复制 backend 失败: {e}"))?;
        }
        if let Some(src) = find("officecli.exe") {
            fs::copy(&src, &officecli).map_err(|e| format!("复制 officecli 失败: {e}"))?;
        }
        if backend.is_file() && officecli.is_file() {
            fs::write(&ver_path, APP_VERSION).map_err(|e| format!("写入版本标记失败: {e}"))?;
        }
        Ok(dir)
    }
}

fn hide_console(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW
        cmd.creation_flags(0x0800_0000);
    }
}

/// 启动后端：
/// - debug：优先 python -m backend.cli（源码改动能立刻生效）
/// - release：使用 LocalAppData 中解压的 dealmaker-backend.exe
fn spawn_backend(action: &str) -> Result<std::process::Child, String> {
    let root = project_root();
    let payload_env = root.to_string_lossy().to_string();
    let runtime = ensure_runtime_deps()?;
    let runtime_env = runtime.to_string_lossy().to_string();

    // 发布模式或显式要求用 exe 时，走内置后端
    let force_exe = std::env::var("DEALMAKER_FORCE_EXE").ok().as_deref() == Some("1");
    let prefer_python = cfg!(debug_assertions) && !force_exe;

    if !prefer_python {
        let backend = runtime.join("dealmaker-backend.exe");
        if backend.is_file() {
            let mut cmd = Command::new(&backend);
            cmd.current_dir(&root)
                .env("DEALMAKER_ROOT", &payload_env)
                .env("DEALMAKER_RUNTIME", &runtime_env)
                .env("PYTHONIOENCODING", "utf-8")
                .env("PYTHONUTF8", "1")
                .arg(action)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            hide_console(&mut cmd);
            return cmd
                .spawn()
                .map_err(|e| format!("无法启动内置后端 {}: {}", backend.display(), e));
        }
        return Err(format!(
            "未找到解压后的后端: {}（请检查 LOCALAPPDATA 写权限）",
            backend.display()
        ));
    }

    // 开发模式：从仓库根跑 python -m backend.cli
    let py = std::env::var("DEALMAKER_PYTHON").unwrap_or_else(|_| "python".into());
    let pythonpath = match std::env::var("PYTHONPATH") {
        Ok(existing) if !existing.is_empty() => format!("{};{}", root.display(), existing),
        _ => root.display().to_string(),
    };
    let mut cmd = Command::new(&py);
    cmd.current_dir(&root)
        .env("DEALMAKER_ROOT", &payload_env)
        .env("DEALMAKER_RUNTIME", &runtime_env)
        .env("PYTHONPATH", &pythonpath)
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
        .args(["-m", "backend.cli", action])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console(&mut cmd);
    cmd.spawn().map_err(|e| {
        format!(
            "无法启动 Python 后端（{}，cwd={}）: {}。发布版请使用内置 dealmaker-backend.exe。",
            py,
            root.display(),
            e
        )
    })
}

/// 同步执行一次后端调用（在阻塞线程池中跑，避免卡住 UI）
fn backend_call_sync(action: String, payload: Value) -> Result<Value, String> {
    let payload_str =
        serde_json::to_string(&payload).map_err(|e| format!("payload 序列化失败: {e}"))?;

    let mut child = spawn_backend(&action)?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(payload_str.as_bytes())
            .map_err(|e| format!("写入后端 stdin 失败: {e}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("等待后端退出失败: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if stdout.is_empty() {
        return Err(if stderr.is_empty() {
            "后端无输出".into()
        } else {
            stderr
        });
    }

    let json_line = stdout.lines().last().unwrap_or(&stdout);
    serde_json::from_str(json_line).map_err(|e| {
        format!("后端 JSON 解析失败: {e}\nstdout: {stdout}\nstderr: {stderr}")
    })
}

/// 通过 stdin 传 JSON，避免 Windows 命令行长度限制（os error 206）
#[tauri::command]
async fn backend_call(action: String, payload: Value) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || backend_call_sync(action, payload))
        .await
        .map_err(|e| format!("后端任务失败: {e}"))?
}

fn quotes_dir() -> Result<PathBuf, String> {
    let dir = project_root().join(".contract_tool").join("quotes");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建目录失败: {e}"))?;
    Ok(dir)
}

fn safe_png_name(filename: Option<String>) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    filename
        .filter(|s| !s.trim().is_empty())
        .map(|s| {
            let n = s.replace("..", "");
            let n = std::path::Path::new(&n)
                .file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_else(|| "quote.png".into());
            if n.to_lowercase().ends_with(".png") {
                n
            } else {
                format!("{n}.png")
            }
        })
        .unwrap_or_else(|| {
            let ts = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            format!("报价表_{ts}.png")
        })
}

fn find_chromium() -> Result<PathBuf, String> {
    let candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    ];
    for c in candidates {
        let p = PathBuf::from(c);
        if p.is_file() {
            return Ok(p);
        }
    }
    Err(
        "未找到 Chrome 或 Edge，无法导出报价表图片。Windows 通常自带 Edge；也可安装 Google Chrome。"
            .into(),
    )
}

fn trim_white_png(path: &Path) -> Result<(), String> {
    let img = image::open(path).map_err(|e| format!("打开截图失败: {e}"))?;
    let rgba = img.to_rgba8();
    let (w, h) = (rgba.width(), rgba.height());
    if w == 0 || h == 0 {
        return Ok(());
    }

    let is_white = |x: u32, y: u32| {
        let p = rgba.get_pixel(x, y).0;
        p[0] >= 250 && p[1] >= 250 && p[2] >= 250 && p[3] >= 250
    };

    let mut top = 0u32;
    let mut bottom = h - 1;
    let mut left = 0u32;
    let mut right = w - 1;

    't: for y in 0..h {
        for x in 0..w {
            if !is_white(x, y) {
                top = y;
                break 't;
            }
        }
    }
    'b: for y in (top..h).rev() {
        for x in 0..w {
            if !is_white(x, y) {
                bottom = y;
                break 'b;
            }
        }
    }
    'l: for x in 0..w {
        for y in top..=bottom {
            if !is_white(x, y) {
                left = x;
                break 'l;
            }
        }
    }
    'r: for x in (left..w).rev() {
        for y in top..=bottom {
            if !is_white(x, y) {
                right = x;
                break 'r;
            }
        }
    }

    let tw = right.saturating_sub(left).saturating_add(1);
    let th = bottom.saturating_sub(top).saturating_add(1);
    if tw == 0 || th == 0 {
        return Ok(());
    }
    if top == 0 && left == 0 && tw == w && th == h {
        return Ok(());
    }

    let cropped = image::imageops::crop_imm(&rgba, left, top, tw, th).to_image();
    cropped
        .save(path)
        .map_err(|e| format!("保存裁切图失败: {e}"))?;
    Ok(())
}

#[tauri::command]
fn export_quote_html_png(html: String, filename: Option<String>) -> Result<Value, String> {
    use std::fs;

    let dir = quotes_dir()?;
    let name = safe_png_name(filename);
    let html_path = dir.join("_quote_export.html");
    let png_path = dir.join(&name);

    fs::write(&html_path, html.as_bytes()).map_err(|e| format!("写入临时 HTML 失败: {e}"))?;

    let html_url = {
        let abs = html_path
            .canonicalize()
            .unwrap_or(html_path.clone())
            .to_string_lossy()
            .replace('\\', "/");
        let abs = abs.trim_start_matches("//?/").trim_start_matches("//?/");
        if abs.chars().nth(1) == Some(':') {
            format!("file:///{abs}")
        } else {
            format!("file://{abs}")
        }
    };

    let chrome = find_chromium()?;
    let shot_arg = format!("--screenshot={}", png_path.to_string_lossy());
    let mut cmd = Command::new(&chrome);
    cmd.args([
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        "--default-background-color=ffffffff",
        "--window-size=1200,3200",
        &shot_arg,
        &html_url,
    ]);
    hide_console(&mut cmd);
    let out = cmd
        .output()
        .map_err(|e| format!("启动浏览器失败: {e}"))?;

    if !png_path.is_file() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let stdout = String::from_utf8_lossy(&out.stdout);
        return Err(format!(
            "浏览器未生成截图。exit={:?}\nstderr={stderr}\nstdout={stdout}",
            out.status.code()
        ));
    }

    trim_white_png(&png_path)?;

    let size = fs::metadata(&png_path).map(|m| m.len()).unwrap_or(0);
    let _ = fs::remove_file(&html_path);

    Ok(serde_json::json!({
        "path": png_path.to_string_lossy(),
        "size": size,
        "engine": "chromium",
    }))
}

#[tauri::command]
fn save_quote_image_file(filename: Option<String>, base64_data: String) -> Result<Value, String> {
    use base64::Engine;
    use std::fs;

    let b64 = base64_data
        .split(',')
        .last()
        .unwrap_or(&base64_data)
        .trim();
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| format!("base64 解码失败: {e}"))?;

    let dir = quotes_dir()?;
    let path = dir.join(safe_png_name(filename));
    fs::write(&path, &bytes).map_err(|e| format!("写入图片失败: {e}"))?;

    Ok(serde_json::json!({
        "path": path.to_string_lossy(),
        "size": bytes.len(),
    }))
}

/// kind: file | dir | docx | image
/// 使用 rfd 原生对话框（Windows 宽字符 API），避免 PowerShell 管道 GBK/UTF-8 乱码
#[tauri::command]
fn pick_path(kind: String) -> Result<Option<String>, String> {
    let path = match kind.as_str() {
        "dir" => rfd::FileDialog::new()
            .set_title("选择文件夹")
            .pick_folder(),
        "docx" => rfd::FileDialog::new()
            .set_title("选择合同模板")
            .add_filter("Word 文档", &["docx"])
            .add_filter("所有文件", &["*"])
            .pick_file(),
        "image" => rfd::FileDialog::new()
            .set_title("选择图片")
            .add_filter("图片", &["png", "jpg", "jpeg", "bmp", "gif"])
            .add_filter("所有文件", &["*"])
            .pick_file(),
        _ => rfd::FileDialog::new()
            .set_title("选择文件")
            .pick_file(),
    };
    Ok(path.map(|p| p.to_string_lossy().to_string()))
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            backend_call,
            pick_path,
            save_quote_image_file,
            export_quote_html_png
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
