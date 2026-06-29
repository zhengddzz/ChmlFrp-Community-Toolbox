// 窗口与系统托盘相关命令
use tauri::Manager;

/// 最小化到系统托盘（隐藏主窗口，应用继续运行）
#[tauri::command]
pub fn minimize_to_tray(app_handle: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app_handle.get_webview_window("main") {
        window.hide().map_err(|e| format!("隐藏窗口失败: {}", e))?;
    }
    Ok(())
}

/// 退出应用（会触发 ExitRequested 事件以处理待安装更新）
#[tauri::command]
pub fn exit_app(app_handle: tauri::AppHandle) {
    app_handle.exit(0);
}
