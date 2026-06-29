import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// ===== 类型定义（与后端 Rust 结构体对应，使用 camelCase）=====

export type DnsProviderKind = "dnspodCn" | "dnspodCom" | "aliyun";

export interface DnsCredential {
  id: string;
  name: string;
  provider: DnsProviderKind;
  /** DNSPod.cn: SecretId；Aliyun: AccessKeyId */
  secretId?: string;
  /** DNSPod.cn: SecretKey；Aliyun: AccessKeySecret */
  secretKey?: string;
  /** DNSPod.com: 格式 "ID,Token" */
  token?: string;
}

export interface TunnelTarget {
  tunnelName: string;
  cnameValue: string;
  note?: string;
}

export interface DnsMonitorTask {
  id: string;
  name: string;
  enabled: boolean;
  /** 用户 token（前端自动填入当前登录账户的 usertoken，不需用户手动输入） */
  userToken: string;
  /** DNS 凭证 ID */
  credentialId: string;
  /** 主域名（如 example.com） */
  domain: string;
  /** 子域名前缀（如 www） */
  subdomain: string;
  /** 主隧道 */
  primaryTunnel: TunnelTarget;
  /** 备用隧道列表（按优先级排序） */
  backupTunnels: TunnelTarget[];
  /** 主隧道连续失败多少次后自动切换（默认 2） */
  failThreshold: number;
  /** 主隧道恢复连续多少次后自动回切（默认 2） */
  recoverThreshold: number;
  /** 轮询间隔（秒），默认 60，范围 10-3600 */
  pollIntervalSecs: number;
}

export interface TaskRuntime {
  primaryFailCount: number;
  primarySuccessCount: number;
  activeTunnelName: string;
  failedOver: boolean;
  lastCheck: string;
  lastResult: string;
  /** 下次应检查的 unix 时间戳（0 表示立即检查） */
  nextCheckAt: number;
}

export interface DnsSwitchLog {
  id: string;
  taskId: string;
  taskName: string;
  /** failover | recover */
  kind: string;
  fromTunnel: string;
  toTunnel: string;
  cnameValue: string;
  success: boolean;
  message: string;
  time: string;
}

export interface DnsMonitorEvent {
  taskId: string;
  runtime: TaskRuntime;
}

// ===== 服务类 =====

export class DnsFailoverService {
  // ===== 凭证管理 =====
  async listCredentials(): Promise<DnsCredential[]> {
    return invoke<DnsCredential[]>("list_dns_credentials");
  }

  async saveCredential(credential: DnsCredential): Promise<DnsCredential> {
    return invoke<DnsCredential>("save_dns_credential", { credential });
  }

  async deleteCredential(id: string): Promise<void> {
    await invoke("delete_dns_credential", { id });
  }

  // ===== 任务管理 =====
  async listTasks(): Promise<DnsMonitorTask[]> {
    return invoke<DnsMonitorTask[]>("list_dns_tasks");
  }

  async saveTask(task: DnsMonitorTask): Promise<DnsMonitorTask> {
    return invoke<DnsMonitorTask>("save_dns_task", { task });
  }

  async deleteTask(id: string): Promise<void> {
    await invoke("delete_dns_task", { id });
  }

  // ===== 运行时状态 =====
  async listRuntime(): Promise<Record<string, TaskRuntime>> {
    return invoke<Record<string, TaskRuntime>>("list_dns_runtime");
  }

  /** 手动触发一次检查（不等下一个 60s 周期） */
  async triggerCheck(): Promise<void> {
    await invoke("trigger_dns_check");
  }

  // ===== 日志 =====
  async listLogs(): Promise<DnsSwitchLog[]> {
    return invoke<DnsSwitchLog[]>("list_dns_logs");
  }

  async clearLogs(): Promise<void> {
    await invoke("clear_dns_logs");
  }

  // ===== 事件监听 =====
  /** 监听后端推送的 dns-monitor-event */
  onMonitorEvent(callback: (event: DnsMonitorEvent) => void): Promise<UnlistenFn> {
    return listen<DnsMonitorEvent>("dns-monitor-event", (e) => {
      callback(e.payload);
    });
  }

  // ===== 工具方法 =====
  /** 生成简易 ID（前端临时使用，后端会再生成） */
  genId(): string {
    return Date.now().toString(16) + Math.random().toString(16).slice(2, 8);
  }

  /** 服务商显示名 */
  providerLabel(kind: DnsProviderKind): string {
    switch (kind) {
      case "dnspodCn":
        return "DNSPod.cn（腾讯云）";
      case "dnspodCom":
        return "DNSPod.com（国际）";
      case "aliyun":
        return "Aliyun（阿里云）";
    }
  }
}

export const dnsFailoverService = new DnsFailoverService();
