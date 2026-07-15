// DNS 容灾监控调度器
// 60s 轮询 /tunnel 接口，按 tunnelName 匹配主隧道
// 判定：tunnelState=false 或 nodestate=offline 计为失败
// 主隧道连续 2 次失败 → 切换到备用隧道（按优先级）
// 主隧道恢复连续 2 次 → 回切到主隧道
// CNAME 值取所选隧道的 ip 字段
use super::dns_config::{self, DnsRuntimeState, DnsSwitchLog, DnsMonitorTask, TaskRuntime, TunnelTarget, UserTokenState};
use super::dns_provider::{self, DnsCredential};
use chrono::{Local, Utc};
use serde::{Deserialize, Deserializer};
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tokio::sync::Mutex as TokioMutex;

/// 调度器基础 tick（秒）：每隔此时长检查一次各任务是否到达轮询时间
const SCHEDULER_TICK_SECS: u64 = 10;
const TUNNEL_API_BASE: &str = "https://cf-v2.uapis.cn";

/// 将 API 可能返回的多种 tunnelState 格式统一解析为 Option<bool>
fn parse_bool_value(raw: &Option<serde_json::Value>) -> Option<bool> {
    match raw {
        None => None,
        Some(serde_json::Value::Bool(b)) => Some(*b),
        Some(serde_json::Value::Number(n)) => n.as_f64().map(|f| f != 0.0),
        Some(serde_json::Value::String(s)) => match s.to_lowercase().as_str() {
            "true" | "1" => Some(true),
            "false" | "0" => Some(false),
            _ => None,
        },
        Some(serde_json::Value::Null) => None,
        _ => None,
    }
}

fn deserialize_tunnel_state<'de, D>(deserializer: D) -> Result<Option<bool>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    Ok(parse_bool_value(&value))
}

/// /tunnel 接口单条隧道响应
/// tunnelState 使用自定义反序列化兼容布尔/整数/字符串/空值格式
#[derive(Deserialize, Debug, Clone)]
struct TunnelInfo {
    /// API 可能返回 name 或 tunnelName
    #[serde(alias = "tunnelName")]
    name: String,
    #[serde(default)]
    node: String,
    /// API 可能返回 nodestate 或 nodeState
    #[serde(default, alias = "nodeState")]
    nodestate: String,
    #[serde(default)]
    ip: String,
    /// API 返回的隧道状态字段，可能是 state / tunnelState / tunnel_state，值为字符串 "true"/"false"
    #[serde(default, alias = "state", alias = "tunnel_state", deserialize_with = "deserialize_tunnel_state")]
    tunnelState: Option<bool>,
}

/// 调度器全局句柄（用于启动/停止）
pub struct DnsMonitorHandle {
    stop_flag: Arc<TokioMutex<bool>>,
}

impl DnsMonitorHandle {
    pub fn new() -> Self {
        Self {
            stop_flag: Arc::new(TokioMutex::new(false)),
        }
    }
}

/// 应用启动时调用：常驻监控调度任务，应用关闭时随进程退出
/// 使用 tauri::async_runtime::spawn，可在 setup 同步上下文中启动异步任务
/// 调度器以 SCHEDULER_TICK_SECS 为基础 tick，每个任务按自身 poll_interval_secs 独立轮询
pub fn start_monitor(app_handle: tauri::AppHandle) {
    let handle = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        log::info!("[DNS-Monitor] 容灾监控调度器启动，基础 tick {}s", SCHEDULER_TICK_SECS);
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(SCHEDULER_TICK_SECS));
        // 跳过首次立即触发，等下个 tick
        interval.tick().await;
        loop {
            interval.tick().await;
            if let Err(e) = run_once(&handle).await {
                log::warn!("[DNS-Monitor] 本轮检查失败: {}", e);
            }
        }
    });
}

/// 单轮检查：遍历所有启用的任务，调用 /tunnel 接口判定并切换
async fn run_once(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let tasks: Vec<DnsMonitorTask> = {
        let path = dns_config_path(app_handle, "dns-tasks.json")?;
        read_json(&path, Vec::new())
    };
    if tasks.is_empty() {
        return Ok(());
    }

    // 任务可能使用不同的 user_token，按 token 分组拉取一次隧道列表
    // 同时缓存失败结果，避免同一 token 重复请求
    use std::collections::HashMap;
    let mut cache: HashMap<String, Vec<TunnelInfo>> = HashMap::new();
    let mut error_cache: HashMap<String, String> = HashMap::new();

    for task in tasks.iter().filter(|t| t.enabled) {
        // 按任务自身轮询周期判定是否到检查时间（next_check_at=0 表示首次立即检查）
        let now_ts = Utc::now().timestamp();
        let rt = get_runtime(app_handle, &task.id, &task.primary_tunnel);
        if rt.next_check_at > 0 && now_ts < rt.next_check_at {
            continue;
        }

        // 拉取隧道列表（按 token 缓存，失败也缓存错误信息）
        let (tunnels, fetch_error): (Vec<TunnelInfo>, Option<String>) = if let Some(t) = cache.get(&task.user_token) {
            (t.clone(), None)
        } else if let Some(err) = error_cache.get(&task.user_token) {
            (Vec::new(), Some(err.clone()))
        } else {
            match fetch_tunnels(app_handle, &task.user_token).await {
                Ok(fetched) => {
                    cache.insert(task.user_token.clone(), fetched.clone());
                    (fetched, None)
                }
                Err(e) => {
                    log::warn!("[DNS-Monitor] 任务「{}」: 获取隧道列表失败: {}", task.name, e);
                    error_cache.insert(task.user_token.clone(), e.clone());
                    (Vec::new(), Some(e))
                }
            }
        };

        // 执行单任务检查（传入可能的错误信息，确保 last_check/last_result 更新）
        check_single_task(app_handle, task, &tunnels, fetch_error.as_deref()).await?;
    }
    Ok(())
}

/// 检查单个任务（忽略轮询周期，立即执行）
/// fetch_error: 获取隧道列表时的错误信息（如 token 无效、网络错误）
async fn check_single_task(
    app_handle: &tauri::AppHandle,
    task: &DnsMonitorTask,
    tunnels: &[TunnelInfo],
    fetch_error: Option<&str>,
) -> Result<(), String> {
    let mut rt = get_runtime(app_handle, &task.id, &task.primary_tunnel);

    // 更新下次检查时间
    let now_ts = Utc::now().timestamp();
    let interval_secs = task.poll_interval_secs.max(10) as i64;
    rt.next_check_at = now_ts + interval_secs;

    // 先更新 last_check（无论后续是否成功，前端都能看到"上次检查时间"）
    rt.last_check = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    // 获取隧道列表失败：记录错误，不累计失败次数，等待下轮重试
    if let Some(err) = fetch_error {
        log::warn!("[DNS-Monitor] 任务「{}」: 获取隧道失败: {}", task.name, err);
        rt.last_result = format!("获取隧道失败: {}", err);
        save_runtime(app_handle, &task.id, &rt);
        let _ = app_handle.emit("dns-monitor-event", serde_json::json!({
            "taskId": task.id,
            "runtime": rt,
        }));
        return Ok(());
    }

    // 判定主隧道状态
    let primary = find_tunnel(tunnels, &task.primary_tunnel.tunnel_name);
    let primary_ok = primary.map(|t| is_tunnel_healthy(t)).unwrap_or(false);

    // 隧道列表为空（token 无效或 API 故障），跳过本轮，不累计失败
    if tunnels.is_empty() && primary.is_none() {
        log::warn!(
            "[DNS-Monitor] 任务「{}」: 隧道列表为空，跳过本轮（等待有效 token）",
            task.name
        );
        rt.last_result = "隧道列表为空，等待有效 token".to_string();
        save_runtime(app_handle, &task.id, &rt);
        let _ = app_handle.emit("dns-monitor-event", serde_json::json!({
            "taskId": task.id,
            "runtime": rt,
        }));
        return Ok(());
    }

    // 调试日志：输出隧道匹配和健康状态
    log::info!(
        "[DNS-Monitor] 任务「{}」: 隧道总数={}, 主隧道={} 匹配={} tunnelState={:?} 健康={}",
        task.name,
        tunnels.len(),
        task.primary_tunnel.tunnel_name,
        primary.is_some(),
        primary.map(|t| t.tunnelState).flatten(),
        primary_ok
    );
    for b in &task.backup_tunnels {
        let found = find_tunnel(tunnels, &b.tunnel_name);
        log::info!(
            "[DNS-Monitor] 备用隧道「{}」: 匹配={} tunnelState={:?} 健康={}",
            b.tunnel_name,
            found.is_some(),
            found.map(|t| t.tunnelState).flatten(),
            found.map(|t| is_tunnel_healthy(t)).unwrap_or(false)
        );
    }

    if !rt.failed_over {
        // 当前为主隧道

        // 始终检查备用隧道状态，提前预警
        let backup_healthy = count_healthy_backups(tunnels, &task.backup_tunnels);
        let backup_total = task.backup_tunnels.len();
        let backup_note = if backup_total > 0 {
            format!("，备用 {}/{} 可用", backup_healthy, backup_total)
        } else {
            String::new()
        };

        if primary_ok {
            rt.primary_fail_count = 0;
            rt.primary_success_count = 0;
            rt.last_result = format!("主隧道正常{}", backup_note);
        } else {
            rt.primary_fail_count += 1;
            rt.last_result = format!("主隧道异常 ({}/{}){}", rt.primary_fail_count, task.fail_threshold, backup_note);
            if rt.primary_fail_count >= task.fail_threshold {
                // 触发切换：打印详细调试日志
                log::warn!(
                    "[DNS-Monitor] 任务「{}」触发切换！主隧道已失败 {}/{} 次",
                    task.name,
                    rt.primary_fail_count,
                    task.fail_threshold
                );
                log::info!(
                    "[DNS-Monitor] 备用隧道配置: {:?}",
                    task.backup_tunnels.iter().map(|b| &b.tunnel_name).collect::<Vec<_>>()
                );
                log::info!(
                    "[DNS-Monitor] API 返回的隧道名称: {:?}",
                    tunnels.iter().map(|t| &t.name).collect::<Vec<_>>()
                );
                for b in &task.backup_tunnels {
                    let found = find_tunnel(tunnels, &b.tunnel_name);
                    if let Some(t) = found {
                        log::info!(
                            "[DNS-Monitor] 备用「{}」: 已匹配, tunnelState={:?}, nodestate={}, 健康={}",
                            b.tunnel_name,
                            t.tunnelState,
                            t.nodestate,
                            is_tunnel_healthy(t)
                        );
                    } else {
                        log::warn!(
                            "[DNS-Monitor] 备用「{}」: 未匹配到！请检查隧道名称是否一致",
                            b.tunnel_name
                        );
                    }
                }
                if let Some(backup) = pick_backup_tunnel(tunnels, &task.backup_tunnels) {
                    log::info!("[DNS-Monitor] pick_backup_tunnel 选中: {}", backup.tunnel_name);
                    let cname_value = backup.cname_value.clone();
                    let to_name = backup.tunnel_name.clone();
                    let from_name = rt.active_tunnel_name.clone();
                    let (success, message) = match do_switch(app_handle, task, &from_name, &to_name, &cname_value).await {
                        Ok(_) => {
                            rt.active_tunnel_name = to_name.clone();
                            rt.failed_over = true;
                            rt.primary_success_count = 0;
                            (true, "切换成功".to_string())
                        }
                        Err(e) => (false, e),
                    };
                    write_log(app_handle, task, "failover", &from_name, &to_name, &cname_value, success, &message);
                } else {
                    log::error!("[DNS-Monitor] pick_backup_tunnel 返回 None！所有备用隧道都不可用");
                    rt.last_result = "无可用备用隧道".to_string();
                }
            }
        }
    } else {
        // 当前为备用隧道：等待主隧道恢复后回切
        if primary_ok {
            rt.primary_success_count += 1;
            rt.last_result = format!("主隧道恢复中 ({}/{})", rt.primary_success_count, task.recover_threshold);
            if rt.primary_success_count >= task.recover_threshold {
                let to_name = task.primary_tunnel.tunnel_name.clone();
                let cname_value = task.primary_tunnel.cname_value.clone();
                let from_name = rt.active_tunnel_name.clone();
                let (success, message) = match do_switch(app_handle, task, &from_name, &to_name, &cname_value).await {
                    Ok(_) => {
                        rt.active_tunnel_name = to_name.clone();
                        rt.failed_over = false;
                        rt.primary_fail_count = 0;
                        (true, "回切成功".to_string())
                    }
                    Err(e) => (false, e),
                };
                write_log(app_handle, task, "recover", &from_name, &to_name, &cname_value, success, &message);
            }
        } else {
            rt.primary_success_count = 0;
            rt.last_result = "主隧道仍未恢复".to_string();
        }
    }

    // 写回运行时
    save_runtime(app_handle, &task.id, &rt);
    // 推送前端事件
    let _ = app_handle.emit("dns-monitor-event", serde_json::json!({
        "taskId": task.id,
        "runtime": rt,
    }));
    Ok(())
}

async fn fetch_tunnels(app_handle: &tauri::AppHandle, user_token: &str) -> Result<Vec<TunnelInfo>, String> {
    // 优先使用前端推送的 accessToken（OAuth token），其次回退到任务里存的 user_token
    let (effective_token, token_source): (String, &'static str) = {
        if let Some(state) = app_handle.try_state::<UserTokenState>() {
            if let Ok(guard) = state.0.lock() {
                if let Some(t) = guard.as_ref() {
                    (t.clone(), "UserTokenState(accessToken)")
                } else {
                    (user_token.to_string(), "task.user_token(legacy)")
                }
            } else {
                (user_token.to_string(), "task.user_token(legacy)")
            }
        } else {
            (user_token.to_string(), "task.user_token(legacy)")
        }
    };

    // 仅在 token 来源为 legacy（可能无效）时打印警告
    if token_source == "task.user_token(legacy)" {
        log::warn!("[DNS-Monitor] 使用 legacy token，可能无效，请确认前端已推送 accessToken");
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent("ChmlFrpCommunityToolbox/1.3")
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let resp = client
        .get(format!("{}/tunnel", TUNNEL_API_BASE))
        .header("Authorization", format!("Bearer {}", effective_token))
        .query(&[("token", &effective_token)])
        .send()
        .await
        .map_err(|e| format!("请求隧道列表失败: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        return Err(format!("隧道接口 HTTP {}", status));
    }

    #[derive(Deserialize)]
    struct TunnelApiResponse {
        #[serde(default)]
        data: Vec<TunnelInfo>,
    }

    let parsed: TunnelApiResponse = resp.json().await
        .map_err(|e| format!("解析隧道响应失败: {}", e))?;

    log::info!("[DNS-Monitor] 获取到 {} 条隧道", parsed.data.len());
    Ok(parsed.data)
}

fn find_tunnel<'a>(tunnels: &'a [TunnelInfo], name: &str) -> Option<&'a TunnelInfo> {
    tunnels.iter().find(|t| t.name == name)
}

/// 健康判定：tunnelState 不为 false 且 nodestate 非 "offline"
fn is_tunnel_healthy(t: &TunnelInfo) -> bool {
    let ts_unhealthy = t.tunnelState == Some(false);
    let node_offline = t.nodestate.eq_ignore_ascii_case("offline");
    let healthy = !ts_unhealthy && !node_offline;
    if !healthy {
        log::info!(
            "[DNS-Monitor] 隧道「{}」不健康: tunnelState={:?}, nodestate={}",
            t.name, t.tunnelState, t.nodestate
        );
    }
    healthy
}

/// 从备用隧道列表中选取第一个健康的隧道
fn pick_backup_tunnel<'a>(tunnels: &'a [TunnelInfo], backups: &'a [TunnelTarget]) -> Option<&'a TunnelTarget> {
    backups.iter().find(|b| {
        find_tunnel(tunnels, &b.tunnel_name).map(is_tunnel_healthy).unwrap_or(false)
    })
}

/// 统计备用隧道中健康可用的数量
fn count_healthy_backups(tunnels: &[TunnelInfo], backups: &[TunnelTarget]) -> usize {
    backups
        .iter()
        .filter(|b| find_tunnel(tunnels, &b.tunnel_name).map(is_tunnel_healthy).unwrap_or(false))
        .count()
}

async fn do_switch(
    app_handle: &tauri::AppHandle,
    task: &DnsMonitorTask,
    from_tunnel: &str,
    to_tunnel: &str,
    cname_value: &str,
) -> Result<(), String> {
    // 取凭证
    let credential = find_credential(app_handle, &task.credential_id)?;
    // 调用 DNS 服务商接口切换 CNAME
    dns_provider::upsert_cname(&credential, &task.domain, &task.subdomain, cname_value).await?;
    log::info!(
        "[DNS-Monitor] 任务 {} 切换 CNAME {}.{} -> {}（隧道: {} -> {}）",
        task.name, task.subdomain, task.domain, cname_value, from_tunnel, to_tunnel
    );
    Ok(())
}

fn find_credential(app_handle: &tauri::AppHandle, id: &str) -> Result<DnsCredential, String> {
    let path = dns_config_path(app_handle, "dns-credentials.json")?;
    let list: Vec<DnsCredential> = read_json(&path, Vec::new());
    list.into_iter().find(|c| c.id == id).ok_or_else(|| format!("未找到凭证: {}", id))
}

fn get_runtime(app_handle: &tauri::AppHandle, task_id: &str, primary: &TunnelTarget) -> TaskRuntime {
    if let Some(state) = app_handle.try_state::<DnsRuntimeState>() {
        if let Ok(guard) = state.0.lock() {
            if let Some(rt) = guard.get(task_id) {
                return rt.clone();
            }
        }
    }
    TaskRuntime {
        active_tunnel_name: primary.tunnel_name.clone(),
        ..Default::default()
    }
}

fn save_runtime(app_handle: &tauri::AppHandle, task_id: &str, rt: &TaskRuntime) {
    if let Some(state) = app_handle.try_state::<DnsRuntimeState>() {
        if let Ok(mut guard) = state.0.lock() {
            guard.insert(task_id.to_string(), rt.clone());
        }
    }
}

fn write_log(
    app_handle: &tauri::AppHandle,
    task: &DnsMonitorTask,
    kind: &str,
    from_tunnel: &str,
    to_tunnel: &str,
    cname_value: &str,
    success: bool,
    message: &str,
) {
    let log = DnsSwitchLog {
        id: dns_config::gen_id(),
        task_id: task.id.clone(),
        task_name: task.name.clone(),
        kind: kind.to_string(),
        from_tunnel: from_tunnel.to_string(),
        to_tunnel: to_tunnel.to_string(),
        cname_value: cname_value.to_string(),
        success,
        message: message.to_string(),
        time: Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
    };
    dns_config::append_log(app_handle, log);
}

// 工具：读取本地 DNS 配置文件路径
fn dns_config_path(app_handle: &tauri::AppHandle, file: &str) -> Result<std::path::PathBuf, String> {
    let base = crate::utils::get_app_data_dir(app_handle)?;
    let dir = base.join("dns-failover");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建 DNS 配置目录失败: {}", e))?;
    Ok(dir.join(file))
}

fn read_json<T: for<'de> serde::Deserialize<'de>>(path: &std::path::PathBuf, default: T) -> T {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(default)
}

/// 手动触发一次检查（前端"立即检查"按钮调用）
#[tauri::command]
pub async fn trigger_dns_check(app_handle: tauri::AppHandle) -> Result<(), String> {
    run_once(&app_handle).await
}

/// 手动检查单个任务（前端任务卡片"立即检查"按钮调用）
#[tauri::command]
pub async fn trigger_dns_check_task(
    app_handle: tauri::AppHandle,
    task_id: String,
) -> Result<(), String> {
    let tasks: Vec<DnsMonitorTask> = {
        let path = dns_config_path(&app_handle, "dns-tasks.json")?;
        read_json(&path, Vec::new())
    };
    let task = tasks
        .into_iter()
        .find(|t| t.id == task_id)
        .ok_or_else(|| format!("未找到任务: {}", task_id))?;
    // 即使获取隧道失败，也更新 last_check/last_result，让前端看到状态变化
    let (tunnels, fetch_error) = match fetch_tunnels(&app_handle, &task.user_token).await {
        Ok(t) => (t, None),
        Err(e) => (Vec::new(), Some(e)),
    };
    check_single_task(&app_handle, &task, &tunnels, fetch_error.as_deref()).await
}
