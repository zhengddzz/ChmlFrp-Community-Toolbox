mod commands;
mod models;
mod utils;

use commands::dns_config::DnsRuntimeState;
use commands::dns_monitor;
use commands::update::{launch_installer_silent, take_pending_installer, PendingInstaller};
use models::FrpcProcesses;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
                let _ = window.unminimize();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(FrpcProcesses::new())
        .manage(PendingInstaller::new())
        .manage(DnsRuntimeState::new())
        // 拦截窗口关闭事件：阻止直接关闭，通知前端弹出关闭确认对话框
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.app_handle().emit("window-close-requested", ());
            }
        })
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                #[cfg(target_os = "macos")]
                {
                    if let Err(e) = window.set_title("") {
                        eprintln!("Failed to set window title: {:?}", e);
                    }
                }

                #[cfg(target_os = "windows")]
                {
                    if let Err(e) = window.set_decorations(false) {
                        eprintln!("Failed to set decorations: {:?}", e);
                    }
                }
            }

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // 创建系统托盘图标及菜单
            let show_item = MenuItem::with_id(app, "tray-show", "显示主窗口", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "tray-quit", "退出程序", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let mut tray_builder = TrayIconBuilder::with_id("main-tray")
                .tooltip("ChmlFrp社区工具箱")
                .menu(&menu)
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "tray-show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                                let _ = window.unminimize();
                            }
                        }
                        "tray-quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    // 左键单击托盘图标时显示主窗口
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.unminimize();
                        }
                    }
                });

            // 使用应用默认窗口图标作为托盘图标
            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            tray_builder.build(app)?;

            // 启动 DNS 容灾监控常驻任务
            dns_monitor::start_monitor(app.handle().clone());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::http_request,
            commands::http_request_raw,
            commands::tcping_host,
            commands::ping_host,
            commands::start_tcp_speed_server,
            commands::stop_tcp_speed_server,
            commands::check_tcp_speed_server,
            commands::tcp_speed_test,
            commands::copy_background_image,
            commands::copy_background_video,
            commands::get_background_video_path,
            commands::start_file_server,
            commands::stop_file_server,
            commands::get_file_server_port,
            commands::is_file_server_running,
            commands::start_frpc,
            commands::stop_frpc,
            commands::stop_all_frpc,
            commands::is_frpc_running,
            commands::check_frpc_exists,
            commands::get_frpc_download_url,
            commands::download_frpc,
            commands::check_app_update,
            commands::download_app_update,
            commands::install_app_update,
            commands::get_pending_installer,
            commands::clear_pending_installer,
            // DNS 容灾相关命令
            commands::list_dns_credentials,
            commands::save_dns_credential,
            commands::delete_dns_credential,
            commands::list_dns_tasks,
            commands::save_dns_task,
            commands::delete_dns_task,
            commands::list_dns_logs,
            commands::clear_dns_logs,
            commands::list_dns_runtime,
            commands::trigger_dns_check,
            commands::trigger_dns_check_task,
            // 窗口与托盘相关命令
            commands::minimize_to_tray,
            commands::exit_app,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => {
                if let Some(window) = app_handle.get_webview_window("main") {
                    if !window.is_visible().unwrap_or(true) {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
            // 应用退出时：若有已下载完成的待安装更新，自动启动安装程序
            tauri::RunEvent::ExitRequested { .. } => {
                if let Some(installer_path) = take_pending_installer(app_handle) {
                    log::info!("检测到待安装更新，退出时自动启动安装程序");
                    launch_installer_silent(app_handle, &installer_path);
                }
            }
            _ => {
                #[cfg(not(target_os = "macos"))]
                let _ = app_handle;
            }
        });
}
