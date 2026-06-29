use std::path::PathBuf;
use tauri::Manager;

pub fn frpc_file_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "frpc.exe"
    } else {
        "frpc"
    }
}

pub fn get_app_data_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    // 统一使用 Tauri 标准 app_data_dir，确保前端 fs 插件（作用域为 $APPDATA）可正常读取
    // 旧版本曾使用 <exe_dir>/data，但该路径不在 fs 插件授权范围内，导致背景图/视频加载失败
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {}", e))?;
    std::fs::create_dir_all(&app_data).map_err(|e| format!("创建数据目录失败: {}", e))?;
    Ok(app_data)
}

pub fn app_data_frpc_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = get_app_data_dir(app_handle)?;
    Ok(data_dir.join(frpc_file_name()))
}

pub fn resolve_frpc_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_path = app_data_frpc_path(app_handle)?;
    if app_path.exists() {
        return Ok(app_path);
    }

    let bundled_path = bundled_frpc_candidates(app_handle)
        .into_iter()
        .find(|path| path.exists());
    let Some(bundled_path) = bundled_path else {
        return Ok(app_path);
    };

    if let Some(parent) = app_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    if std::fs::copy(&bundled_path, &app_path).is_ok() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(metadata) = std::fs::metadata(&app_path) {
                let mut perms = metadata.permissions();
                if perms.mode() & 0o111 == 0 {
                    perms.set_mode(0o755);
                    let _ = std::fs::set_permissions(&app_path, perms);
                }
            }
        }
        return Ok(app_path);
    }

    Ok(bundled_path)
}

fn bundled_frpc_candidates(app_handle: &tauri::AppHandle) -> Vec<PathBuf> {
    let file_name = frpc_file_name();
    let mut candidates = Vec::new();

    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        candidates.push(resource_dir.join(file_name));
        candidates.push(resource_dir.join("frp-binaries").join(platform_dir()).join(file_name));
    }

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidates.push(exe_dir.join("resources").join(file_name));
            candidates.push(exe_dir.join(file_name));
            candidates.push(exe_dir.join("frp-binaries").join(platform_dir()).join(file_name));
        }
    }

    candidates
}

fn platform_dir() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        #[cfg(target_arch = "x86_64")]
        return "windows/x64";
        #[cfg(target_arch = "x86")]
        return "windows/x86";
        #[cfg(target_arch = "aarch64")]
        return "windows/arm64";
    }
    #[cfg(target_os = "macos")]
    {
        #[cfg(target_arch = "x86_64")]
        return "macos/x64";
        #[cfg(target_arch = "aarch64")]
        return "macos/arm64";
    }
    #[cfg(target_os = "linux")]
    {
        #[cfg(target_arch = "x86_64")]
        return "linux/amd64";
        #[cfg(target_arch = "x86")]
        return "linux/386";
        #[cfg(target_arch = "arm")]
        return "linux/arm";
        #[cfg(target_arch = "aarch64")]
        return "linux/arm64";
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    return "unknown";
}
