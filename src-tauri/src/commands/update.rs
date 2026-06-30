use crate::models::{AppUpdateInfo, AppUpdatePackage, AppUpdateResponse, DownloadProgress};
use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// 更新 API 地址
const UPDATE_API_URL: &str = "https://u.zdzz.top/api/node-selector.json";
/// 进度事件触发阈值（每下载 100KB 推送一次）
const PROGRESS_EMIT_THRESHOLD: u64 = 100 * 1024;
/// hash 校验缓冲区
const HASH_BUFFER_SIZE: usize = 8192;
/// 下载超时（秒）
const DOWNLOAD_TIMEOUT: u64 = 600;
/// 普通请求超时（秒）
const DEFAULT_TIMEOUT: u64 = 30;

/// 已下载完成、等待安装的安装包路径（全局状态）
/// 用于：1) 前端查询是否有待安装更新 2) 应用退出时自动启动安装
pub struct PendingInstaller(pub Mutex<Option<String>>);

impl PendingInstaller {
    pub fn new() -> Self {
        Self(Mutex::new(None))
    }
}

/// 设置待安装的安装包路径
fn set_pending_installer(app_handle: &tauri::AppHandle, path: String) {
    if let Some(state) = app_handle.try_state::<PendingInstaller>() {
        if let Ok(mut guard) = state.0.lock() {
            *guard = Some(path);
        }
    }
}

/// 获取并清除待安装的安装包路径
pub fn take_pending_installer(app_handle: &tauri::AppHandle) -> Option<String> {
    let state = app_handle.try_state::<PendingInstaller>()?;
    let mut guard = state.0.lock().ok()?;
    guard.take()
}

/// 仅查看不清除
fn peek_pending_installer(app_handle: &tauri::AppHandle) -> Option<String> {
    let state = app_handle.try_state::<PendingInstaller>()?;
    let guard = state.0.lock().ok()?;
    guard.clone()
}

fn build_http_client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .user_agent("ChmlFrpNodeSpeedTest/1.0")
        // 不强制 no_proxy，让 reqwest 使用系统代理配置
        // GitHub releases 在部分地区需要代理才能访问
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))
}

/// 比较语义化版本号，返回 >0 表示 a 更新，<0 表示 b 更新，0 表示相同
fn compare_versions(a: &str, b: &str) -> i32 {
    let a_parts: Vec<i32> = a.split('.').map(|s| s.parse().unwrap_or(0)).collect();
    let b_parts: Vec<i32> = b.split('.').map(|s| s.parse().unwrap_or(0)).collect();
    let max_len = a_parts.len().max(b_parts.len());
    for i in 0..max_len {
        let a_val = a_parts.get(i).copied().unwrap_or(0);
        let b_val = b_parts.get(i).copied().unwrap_or(0);
        if a_val > b_val {
            return 1;
        }
        if a_val < b_val {
            return -1;
        }
    }
    0
}

/// 根据当前平台选择最合适的安装包
fn select_package(
    response: &AppUpdateResponse,
    os: &str,
    _arch: &str,
) -> Option<AppUpdatePackage> {
    let packages = match os {
        "windows" => &response.platforms.windows,
        "macos" => &response.platforms.macos,
        "linux" => &response.platforms.linux,
        _ => return None,
    };

    if packages.is_empty() {
        return None;
    }

    // 按平台定义格式优先级
    let preferred_formats: &[&str] = match os {
        "windows" => &["exe", "msi"],
        "macos" => &["dmg", "app.tar.gz"],
        "linux" => &["AppImage", "deb", "rpm"],
        _ => return None,
    };

    for format in preferred_formats {
        if let Some(pkg) = packages.iter().find(|p| p.format == *format) {
            return Some(pkg.clone());
        }
    }

    packages.first().cloned()
}

/// 校验文件 SHA-256
fn verify_sha256(file_path: &Path, expected_hash: &str) -> Result<(), String> {
    let mut file =
        std::fs::File::open(file_path).map_err(|e| format!("无法打开文件进行 hash 验证: {}", e))?;

    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; HASH_BUFFER_SIZE];

    loop {
        let bytes_read = file
            .read(&mut buffer)
            .map_err(|e| format!("读取文件失败: {}", e))?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }

    let computed_hash = hex::encode(hasher.finalize());

    if computed_hash.to_lowercase() != expected_hash.to_lowercase() {
        return Err(format!(
            "文件 hash 验证失败: 预期 {}, 实际 {}",
            expected_hash, computed_hash
        ));
    }

    Ok(())
}

/// 获取更新安装包下载目录
fn get_download_dir() -> Result<PathBuf, String> {
    let temp_dir = std::env::temp_dir();
    let download_dir = temp_dir.join("chmlfrp-node-recommender-updates");
    std::fs::create_dir_all(&download_dir).map_err(|e| format!("创建下载目录失败: {}", e))?;
    Ok(download_dir)
}

/// 从 URL 中提取文件名
fn get_filename_from_url(url: &str) -> String {
    url.rsplit('/')
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or("installer")
        .to_string()
}

/// 格式化下载大小为可读字符串
fn format_size(bytes: u64) -> String {
    if bytes < 1024 {
        format!("{} B", bytes)
    } else if bytes < 1024 * 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    }
}

/// 检查应用更新：请求 API 并对比版本，返回更新信息
#[tauri::command]
pub async fn check_app_update(
    app_handle: tauri::AppHandle,
) -> Result<Option<AppUpdateInfo>, String> {
    let client = build_http_client(DEFAULT_TIMEOUT)?;
    let response = client
        .get(UPDATE_API_URL)
        .send()
        .await
        .map_err(|e| format!("请求更新接口失败: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("更新接口返回错误: {}", response.status()));
    }

    let update_response: AppUpdateResponse = response
        .json()
        .await
        .map_err(|e| format!("解析更新响应失败: {}", e))?;

    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    let current_version = app_handle.package_info().version.to_string();
    let latest_version = &update_response.version;

    // 版本对比：最新版本需大于当前版本才提示更新
    if compare_versions(latest_version, &current_version) <= 0 {
        return Ok(None);
    }

    let package =
        select_package(&update_response, os, arch).ok_or_else(|| {
            format!("未找到适合当前平台的安装包: {} {}", os, arch)
        })?;

    Ok(Some(AppUpdateInfo {
        version: update_response.version.clone(),
        release_date: update_response.release_date.clone(),
        release_notes: update_response.release_notes.clone(),
        mandatory: update_response.mandatory,
        download_url: package.url.clone(),
        download_size: package.size,
        sha256: package.sha256.clone(),
        format: package.format.clone(),
        current_version,
    }))
}

/// 下载应用更新安装包，通过 "app-update-progress" 事件推送进度
#[tauri::command]
pub async fn download_app_update(
    app_handle: tauri::AppHandle,
    url: String,
    sha256: String,
) -> Result<String, String> {
    log::info!("开始下载应用更新: {}", url);

    let client = build_http_client(DOWNLOAD_TIMEOUT)?;
    let download_dir = get_download_dir()?;
    let filename = get_filename_from_url(&url);
    let file_path = download_dir.join(&filename);
    log::info!("下载文件保存路径: {}", file_path.display());

    let response = client
        .get(&url)
        .header("Accept", "application/octet-stream")
        .send()
        .await
        .map_err(|e| {
            log::error!("下载请求失败: {}", e);
            format!("下载请求失败: {}（若网络需代理访问 GitHub，请检查系统代理设置）", e)
        })?;

    let status = response.status();
    if !status.is_success() {
        log::error!("下载失败，HTTP 状态码: {}", status);
        return Err(format!(
            "下载失败，HTTP 状态码: {}（请检查网络或代理设置）",
            status
        ));
    }

    let total_size = response.content_length().unwrap_or(0);
    log::info!("下载开始，总大小: {} 字节", total_size);

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&file_path)
        .map_err(|e| {
            log::error!("无法打开文件进行写入: {}", e);
            format!("无法打开文件进行写入: {}", e)
        })?;

    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut this_chunk_size: u64 = 0;

    while let Some(item) = stream.next().await {
        match item {
            Ok(chunk) => {
                if let Err(e) = file.write_all(&chunk) {
                    return Err(format!("写入文件失败: {}", e));
                }

                let chunk_len = chunk.len() as u64;
                downloaded += chunk_len;
                this_chunk_size += chunk_len;

                let percentage = if total_size > 0 {
                    (downloaded as f64 / total_size as f64) * 100.0
                } else {
                    0.0
                };

                if this_chunk_size >= PROGRESS_EMIT_THRESHOLD {
                    let _ = app_handle.emit(
                        "app-update-progress",
                        DownloadProgress {
                            downloaded,
                            total: total_size,
                            percentage,
                        },
                    );
                    this_chunk_size = 0;
                }
            }
            Err(e) => {
                return Err(format!("下载数据读取失败: {}", e));
            }
        }
    }

    // 推送最终进度
    let _ = app_handle.emit(
        "app-update-progress",
        DownloadProgress {
            downloaded,
            total: total_size,
            percentage: 100.0,
        },
    );

    if downloaded == 0 {
        return Err("下载失败: 没有接收到任何数据".to_string());
    }

    // 仅在提供 sha256 时进行校验
    if !sha256.is_empty() {
        if let Err(e) = verify_sha256(&file_path, &sha256) {
            let _ = std::fs::remove_file(&file_path);
            return Err(e);
        }
    }

    log::info!(
        "应用更新安装包下载完成: {} ({})",
        file_path.display(),
        format_size(downloaded)
    );

    let path_str = file_path.to_string_lossy().to_string();
    // 存入全局状态，供应用退出时自动安装
    set_pending_installer(&app_handle, path_str.clone());

    Ok(path_str)
}

/// 查询当前是否有已下载完成、待安装的更新
/// 前端用于：1) 启动时恢复"立即更新"按钮 2) 侧边栏显示状态
#[tauri::command]
pub async fn get_pending_installer(
    app_handle: tauri::AppHandle,
) -> Result<Option<String>, String> {
    Ok(peek_pending_installer(&app_handle))
}

/// 清除待安装记录（用户取消或安装包失效时调用）
#[tauri::command]
pub async fn clear_pending_installer(
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let _ = take_pending_installer(&app_handle);
    Ok(())
}

/// 启动静默更新后台进程（完全无窗口）
/// 使用 PowerShell 隐藏窗口 + CREATE_NO_WINDOW 标志，用户看不到任何窗口
/// 流程：等待主应用退出 → NSIS /S 静默安装 → Start-Process 启动新应用（无 cmd 窗口）
/// 返回 true 表示后台进程已成功启动
fn launch_silent_update_background(installer_path: &str) -> bool {
    let app_exe = match std::env::current_exe() {
        Ok(p) => p.to_string_lossy().to_string(),
        Err(e) => {
            log::error!("获取应用路径失败: {}", e);
            return false;
        }
    };
    let current_pid = std::process::id();

    // PowerShell 脚本：等待主应用退出 → 强制结束残留 → 静默安装 → 启动新应用
    // -WindowStyle Hidden + CREATE_NO_WINDOW 实现完全无窗口
    // 启动新应用用 ShellExecute，不继承 PowerShell 控制台，避免出现 cmd 窗口
    let script = format!(
        r#"$ErrorActionPreference='SilentlyContinue';
$procId={pid};
$installer='{installer}';
$appExe='{app_exe}';
$elapsed=0;
while((Get-Process -Id $procId -ErrorAction SilentlyContinue) -and $elapsed -lt 30){{Start-Sleep -Milliseconds 500;$elapsed+=0.5}};
Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue;
Start-Sleep -Milliseconds 800;
Start-Process -FilePath $installer -ArgumentList '/S' -Wait;
Start-Sleep -Milliseconds 300;
$shell=New-Object -ComObject Shell.Application;
$shell.ShellExecute($appExe,'','','open',1)"#,
        pid = current_pid,
        installer = installer_path.replace('\'', "''"),
        app_exe = app_exe.replace('\'', "''"),
    );

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW = 0x08000000，确保不出现任何控制台窗口
        match std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", &script])
            .creation_flags(0x08000000)
            .spawn()
        {
            Ok(_) => {
                log::info!("已启动静默更新后台进程: {}", installer_path);
                true
            }
            Err(e) => {
                log::error!("启动静默更新后台进程失败: {}", e);
                false
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = script;
        log::error!("静默更新后台进程仅支持 Windows");
        false
    }
}

/// 仅启动安装程序，不退出当前应用（用于应用退出时的自动安装钩子）
/// 返回 true 表示已成功启动安装程序
pub fn launch_installer_silent(_app_handle: &tauri::AppHandle, file_path: &str) -> bool {
    let path = Path::new(file_path);
    if !path.exists() {
        log::warn!("待安装的安装包不存在: {}", file_path);
        return false;
    }

    // Unix 平台赋予可执行权限
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(mut perms) = std::fs::metadata(path).map(|m| m.permissions()) {
            perms.set_mode(0o755);
            let _ = std::fs::set_permissions(path, perms);
        }
    }

    let os = std::env::consts::OS;
    let result = match os {
        "windows" => {
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            if ext == "msi" {
                std::process::Command::new("msiexec")
                    .args(["/i", file_path, "/quiet", "/norestart"])
                    .spawn()
            } else {
                // NSIS exe：用静默后台进程实现安装 + 自动启动新应用（完全无窗口）
                if launch_silent_update_background(file_path) {
                    return true;
                }
                // 后台进程启动失败则回退到直接运行安装包
                std::process::Command::new(file_path).spawn()
            }
        }
        "macos" => std::process::Command::new("open")
            .arg(file_path)
            .spawn(),
        "linux" => std::process::Command::new(file_path)
            .spawn()
            .or_else(|_| {
                std::process::Command::new("xdg-open")
                    .arg(file_path)
                    .spawn()
            }),
        _ => return false,
    };

    match result {
        Ok(_) => {
            log::info!("已启动安装程序（退出时自动触发）: {}", file_path);
            true
        }
        Err(e) => {
            log::error!("启动安装程序失败: {}", e);
            false
        }
    }
}

/// 运行安装包并退出当前应用
/// Windows 平台：生成 PowerShell 脚本，等待应用退出后静默安装（/S）并自动启动新应用
/// 其他平台：直接启动安装器
#[tauri::command]
pub async fn install_app_update(
    app_handle: tauri::AppHandle,
    file_path: String,
) -> Result<(), String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("安装包不存在: {}", file_path));
    }

    // Unix 平台赋予可执行权限
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(path)
            .map_err(|e| e.to_string())?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(path, perms).map_err(|e| e.to_string())?;
    }

    let os = std::env::consts::OS;

    match os {
        "windows" => {
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();

            if ext == "msi" {
                // msi 使用 msiexec 静默安装
                std::process::Command::new("msiexec")
                    .args(["/i", &file_path, "/quiet", "/norestart"])
                    .spawn()
                    .map_err(|e| format!("启动安装程序失败: {}", e))?;
            } else {
                // NSIS exe：启动静默后台进程完成安装 + 自动启动新应用（完全无窗口）
                // 后台进程是独立进程，不锁定主应用 exe
                if !launch_silent_update_background(&file_path) {
                    return Err("启动静默更新失败，请重试或手动运行安装包".to_string());
                }
            }
        }
        "macos" => {
            // macOS: 使用 open 命令打开 dmg/app
            std::process::Command::new("open")
                .arg(&file_path)
                .spawn()
                .map_err(|e| format!("打开安装文件失败: {}", e))?;
        }
        "linux" => {
            // Linux: AppImage 直接运行，其他尝试 xdg-open
            std::process::Command::new(&file_path)
                .spawn()
                .or_else(|_| {
                    std::process::Command::new("xdg-open")
                        .arg(&file_path)
                        .spawn()
                })
                .map_err(|e| format!("启动安装文件失败: {}", e))?;
        }
        _ => {
            return Err(format!("不支持的平台: {}", os));
        }
    }

    log::info!("已启动安装程序，应用即将退出以完成更新");

    // 清除待安装记录，避免应用退出时 ExitRequested 钩子重复启动安装程序
    let _ = take_pending_installer(&app_handle);

    // 退出当前应用，让安装程序接管
    app_handle.exit(0);

    Ok(())
}
