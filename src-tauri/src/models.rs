use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Child;
use std::sync::Mutex;

#[derive(Serialize, Clone)]
pub struct LogMessage {
    pub message: String,
    pub timestamp: String,
}

#[derive(Deserialize)]
pub struct HttpRequestOptions {
    pub url: String,
    pub method: String,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
    pub bypass_proxy: Option<bool>,
}

#[derive(Serialize, Clone)]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: u64,
    pub percentage: f64,
}

#[derive(Deserialize, Debug)]
pub struct FrpcInfoResponse {
    pub msg: String,
    pub state: String,
    pub code: u32,
    pub data: FrpcInfoData,
}

#[derive(Deserialize, Debug)]
pub struct FrpcInfoData {
    pub downloads: Vec<FrpcDownload>,
    pub version: String,
}

#[derive(Deserialize, Debug, Clone)]
pub struct FrpcDownload {
    pub hash: String,
    pub os: String,
    pub hash_type: String,
    pub platform: String,
    pub link: String,
    pub arch: String,
    pub size: u64,
}

pub struct DownloadInfo {
    pub url: String,
    pub hash: String,
    pub size: u64,
}

pub struct FrpcProcesses {
    pub processes: Mutex<HashMap<String, Child>>,
}

impl FrpcProcesses {
    pub fn new() -> Self {
        Self {
            processes: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Deserialize, Debug, Clone)]
pub struct SpeedTestConfig {
    pub server_addr: String,
    pub server_port: u16,
    pub token: String,
    pub user: String,
    pub local_ip: String,
    pub local_port: u16,
    pub remote_port: u16,
    pub tunnel_name: String,
}

// ===== 应用自动更新相关数据结构 =====

/// 更新 API 完整响应
#[derive(Deserialize, Debug)]
pub struct AppUpdateResponse {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(rename = "releaseDate")]
    pub release_date: String,
    #[serde(rename = "releaseNotes")]
    pub release_notes: String,
    pub mandatory: bool,
    pub platforms: AppUpdatePlatforms,
    #[serde(default)]
    pub changelog: Vec<AppUpdateChangelogEntry>,
}

/// 各平台安装包列表
#[derive(Deserialize, Debug)]
pub struct AppUpdatePlatforms {
    #[serde(default)]
    pub windows: Vec<AppUpdatePackage>,
    #[serde(default)]
    pub macos: Vec<AppUpdatePackage>,
    #[serde(default)]
    pub linux: Vec<AppUpdatePackage>,
}

/// 单个安装包信息
#[derive(Deserialize, Debug, Clone)]
pub struct AppUpdatePackage {
    pub version: String,
    pub url: String,
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub sha256: String,
    pub format: String,
    #[serde(rename = "minOS", default)]
    pub min_os: String,
}

/// 历史版本条目
#[derive(Deserialize, Debug)]
pub struct AppUpdateChangelogEntry {
    pub version: String,
    #[serde(rename = "releaseDate")]
    pub release_date: String,
    #[serde(rename = "releaseNotes")]
    pub release_notes: String,
    pub mandatory: bool,
}

/// 返回给前端的更新信息
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateInfo {
    pub version: String,
    pub release_date: String,
    pub release_notes: String,
    pub mandatory: bool,
    pub download_url: String,
    pub download_size: u64,
    pub sha256: String,
    pub format: String,
    pub current_version: String,
}
