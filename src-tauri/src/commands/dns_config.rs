// DNS 容灾配置与日志的本地 JSON 存储
// 文件结构：data/dns-failover/{credentials.json, tasks.json, logs.json}
use crate::utils::get_app_data_dir;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

use super::dns_provider::{DnsCredential, DnsProviderKind};

/// 一个隧道目标（用于匹配监控的隧道与切换目标）
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelTarget {
    /// 隧道名（匹配 /tunnel 返回的 name 字段）
    pub tunnel_name: String,
    /// 隧道 ip 字段，切换时作为 CNAME 值
    pub cname_value: String,
    /// 备注（可选）
    #[serde(default)]
    pub note: String,
}

/// 一条 DNS 监控任务
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsMonitorTask {
    pub id: String,
    /// 任务名称
    pub name: String,
    /// 启用状态
    pub enabled: bool,
    /// 用户 token（调用 /tunnel 时使用，前端自动填入当前登录账户的 usertoken）
    pub user_token: String,
    /// DNS 凭证 ID
    pub credential_id: String,
    /// 主域名（如 example.com）
    pub domain: String,
    /// 子域名前缀（如 www）
    pub subdomain: String,
    /// 主隧道
    pub primary_tunnel: TunnelTarget,
    /// 备用隧道列表（按优先级排序，索引越小越优先）
    pub backup_tunnels: Vec<TunnelTarget>,
    /// 主隧道连续失败多少次后自动切换（默认 2）
    #[serde(default = "default_fail_threshold")]
    pub fail_threshold: u32,
    /// 主隧道恢复连续多少次后自动回切（默认 2）
    #[serde(default = "default_recover_threshold")]
    pub recover_threshold: u32,
    /// 轮询间隔（秒），默认 60，范围 10-3600
    #[serde(default = "default_poll_interval")]
    pub poll_interval_secs: u32,
}

fn default_fail_threshold() -> u32 {
    2
}

fn default_recover_threshold() -> u32 {
    2
}

fn default_poll_interval() -> u32 {
    60
}

/// 任务运行时状态（仅内存）
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRuntime {
    /// 主隧道连续失败次数
    pub primary_fail_count: u32,
    /// 主隧道连续成功次数（用于回切）
    pub primary_success_count: u32,
    /// 当前激活的隧道名（主隧道或某个备用隧道）
    pub active_tunnel_name: String,
    /// 当前是否处于切换到备用隧道的状态
    pub failed_over: bool,
    /// 上次检查时间
    pub last_check: String,
    /// 上次检查结果
    pub last_result: String,
    /// 下次应检查的 unix 时间戳（0 表示立即检查）
    #[serde(default)]
    pub next_check_at: i64,
}

/// 一次切换日志
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsSwitchLog {
    pub id: String,
    pub task_id: String,
    pub task_name: String,
    /// 切换类型：failover（主切备）/ recover（备切回主）
    pub kind: String,
    pub from_tunnel: String,
    pub to_tunnel: String,
    pub cname_value: String,
    pub success: bool,
    pub message: String,
    pub time: String,
}

const CREDENTIALS_FILE: &str = "dns-credentials.json";
const TASKS_FILE: &str = "dns-tasks.json";
const LOGS_FILE: &str = "dns-logs.json";

fn dns_data_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = get_app_data_dir(app_handle)?;
    let dir = base.join("dns-failover");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建 DNS 配置目录失败: {}", e))?;
    Ok(dir)
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &PathBuf, default: T) -> T {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(default)
}

fn write_json<T: Serialize>(path: &PathBuf, data: &T) -> Result<(), String> {
    let content = serde_json::to_string_pretty(data).map_err(|e| format!("序列化失败: {}", e))?;
    std::fs::write(path, content).map_err(|e| format!("写入文件失败: {}", e))
}

// ===== 凭证管理命令 =====

#[tauri::command]
pub async fn list_dns_credentials(app_handle: tauri::AppHandle) -> Result<Vec<DnsCredential>, String> {
    let path = dns_data_dir(&app_handle)?.join(CREDENTIALS_FILE);
    Ok(read_json(&path, Vec::new()))
}

#[tauri::command]
pub async fn save_dns_credential(
    app_handle: tauri::AppHandle,
    credential: DnsCredential,
) -> Result<DnsCredential, String> {
    let path = dns_data_dir(&app_handle)?.join(CREDENTIALS_FILE);
    let mut list: Vec<DnsCredential> = read_json(&path, Vec::new());

    if let Some(idx) = list.iter().position(|c| c.id == credential.id) {
        list[idx] = credential.clone();
    } else {
        list.push(credential.clone());
    }
    write_json(&path, &list)?;
    Ok(credential)
}

#[tauri::command]
pub async fn delete_dns_credential(
    app_handle: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    let path = dns_data_dir(&app_handle)?.join(CREDENTIALS_FILE);
    let mut list: Vec<DnsCredential> = read_json(&path, Vec::new());
    list.retain(|c| c.id != id);
    write_json(&path, &list)
}

// ===== 任务管理命令 =====

#[tauri::command]
pub async fn list_dns_tasks(app_handle: tauri::AppHandle) -> Result<Vec<DnsMonitorTask>, String> {
    let path = dns_data_dir(&app_handle)?.join(TASKS_FILE);
    Ok(read_json(&path, Vec::new()))
}

#[tauri::command]
pub async fn save_dns_task(
    app_handle: tauri::AppHandle,
    task: DnsMonitorTask,
) -> Result<DnsMonitorTask, String> {
    let path = dns_data_dir(&app_handle)?.join(TASKS_FILE);
    let mut list: Vec<DnsMonitorTask> = read_json(&path, Vec::new());
    if let Some(idx) = list.iter().position(|t| t.id == task.id) {
        list[idx] = task.clone();
    } else {
        list.push(task.clone());
    }
    write_json(&path, &list)?;
    Ok(task)
}

#[tauri::command]
pub async fn delete_dns_task(
    app_handle: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    let path = dns_data_dir(&app_handle)?.join(TASKS_FILE);
    let mut list: Vec<DnsMonitorTask> = read_json(&path, Vec::new());
    list.retain(|t| t.id != id);
    write_json(&path, &list)
}

// ===== 日志管理命令 =====

#[tauri::command]
pub async fn list_dns_logs(app_handle: tauri::AppHandle) -> Result<Vec<DnsSwitchLog>, String> {
    let path = dns_data_dir(&app_handle)?.join(LOGS_FILE);
    let mut logs: Vec<DnsSwitchLog> = read_json(&path, Vec::new());
    // 按时间倒序
    logs.sort_by(|a, b| b.time.cmp(&a.time));
    // 最多保留 500 条
    if logs.len() > 500 {
        logs.truncate(500);
    }
    Ok(logs)
}

#[tauri::command]
pub async fn clear_dns_logs(app_handle: tauri::AppHandle) -> Result<(), String> {
    let path = dns_data_dir(&app_handle)?.join(LOGS_FILE);
    write_json(&path, &Vec::<DnsSwitchLog>::new())
}

/// 内部接口：追加一条日志（不导出为 Tauri 命令）
pub fn append_log(app_handle: &tauri::AppHandle, log: DnsSwitchLog) {
    if let Ok(path) = dns_data_dir(app_handle).map(|d| d.join(LOGS_FILE)) {
        let mut logs: Vec<DnsSwitchLog> = read_json(&path, Vec::new());
        logs.push(log);
        // 保留最近 500 条
        if logs.len() > 500 {
            let start = logs.len() - 500;
            logs = logs.split_off(start);
        }
        let _ = write_json(&path, &logs);
    }
}

/// 内部接口：生成简易 ID（时间戳 + 随机后缀）
pub fn gen_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    format!("{:x}", nanos)
}

// ===== 全局运行时状态管理 =====
/// 所有任务的运行时状态（任务 id -> TaskRuntime）
pub struct DnsRuntimeState(pub Mutex<std::collections::HashMap<String, TaskRuntime>>);

impl DnsRuntimeState {
    pub fn new() -> Self {
        Self(Mutex::new(std::collections::HashMap::new()))
    }
}

/// 当前登录用户的有效 access token（前端登录/刷新后推送）
/// 供 DNS 监控调度器请求 /tunnel 接口使用
pub struct UserTokenState(pub Mutex<Option<String>>);

impl UserTokenState {
    pub fn new() -> Self {
        Self(Mutex::new(None))
    }
}

/// 前端推送当前有效的 access token 给后端
#[tauri::command]
pub async fn set_user_token(
    state: tauri::State<'_, UserTokenState>,
    token: String,
) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    *guard = Some(token);
    Ok(())
}

#[tauri::command]
pub async fn list_dns_runtime(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, DnsRuntimeState>,
) -> Result<std::collections::HashMap<String, TaskRuntime>, String> {
    let tasks: Vec<DnsMonitorTask> = {
        let path = dns_data_dir(&app_handle)?.join(TASKS_FILE);
        read_json(&path, Vec::new())
    };
    let guard = state.0.lock().map_err(|e| format!("获取运行时锁失败: {}", e))?;
    let mut result = std::collections::HashMap::new();
    for task in tasks {
        let rt = guard
            .get(&task.id)
            .cloned()
            .unwrap_or_else(|| TaskRuntime {
                active_tunnel_name: task.primary_tunnel.tunnel_name.clone(),
                ..Default::default()
            });
        result.insert(task.id, rt);
    }
    Ok(result)
}
