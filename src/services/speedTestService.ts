import { invoke } from "@tauri-apps/api/core";
import { tunnelService, type TempTunnelInfo } from "./tunnelService";
import { frpcService } from "./frpcService";
import { getStoredUser, fetchNodeInfo } from "./api";

export interface SpeedTestResult {
  success: boolean;
  latency?: number;
  downloadSpeed?: number;
  error?: string;
}

export interface LogEntry {
  timestamp: number;
  message: string;
  type: "info" | "error" | "success" | "warning";
}

export interface SpeedTestProgress {
  stage: "idle" | "checking_frpc" | "downloading_frpc" | "starting_tcp_server" | "creating_tunnel" | "starting_frpc" | "testing_latency" | "testing_speed" | "cleaning_up" | "completed" | "error";
  message: string;
  progress?: number;
  logs: LogEntry[];
}

export type SpeedTestCallback = (progress: SpeedTestProgress) => void;

export interface SpeedTestOptions {
  testLatency?: boolean;
  testSpeed?: boolean;
  speedTestSize?: number;
}

export class SpeedTestService {
  private abortController: AbortController | null = null;
  private logs: LogEntry[] = [];
  private currentTunnelInfo: TempTunnelInfo | null = null;
  private currentFrpcStarted: boolean = false;
  private currentTcpServerPort: number = 0;

  private addLog(message: string, type: LogEntry["type"] = "info"): void {
    const entry: LogEntry = {
      timestamp: Date.now(),
      message,
      type,
    };
    this.logs.push(entry);
    console.log(`[SpeedTest][${type.toUpperCase()}] ${message}`);
  }

  private updateProgress(
    onProgress: SpeedTestCallback,
    stage: SpeedTestProgress["stage"],
    message: string,
    progress?: number
  ): void {
    onProgress({
      stage,
      message,
      progress,
      logs: [...this.logs],
    });
  }

  async runSpeedTest(
    nodeName: string,
    onProgress: SpeedTestCallback,
    options: SpeedTestOptions = {},
  ): Promise<SpeedTestResult> {
    const { testLatency = true, testSpeed = true, speedTestSize = 10 } = options;
    
    this.abortController = new AbortController();
    this.logs = [];
    this.currentTunnelInfo = null;
    this.currentFrpcStarted = false;
    this.currentTcpServerPort = 0;
    let tcpServerPort = 0;
    let tunnelInfo: TempTunnelInfo | null = null;
    let frpcStarted = false;
    let latency: number | undefined;
    let downloadSpeed: number | undefined;

    try {
      const user = getStoredUser();
      if (!user) {
        throw new Error("请先登录");
      }

      if (testLatency && !testSpeed) {
        return await this.runLatencyOnlyTest(nodeName, onProgress);
      }

      this.addLog("开始节点速度测试", "info");
      this.addLog(`目标节点: ${nodeName}`, "info");

      this.updateProgress(onProgress, "checking_frpc", "正在检查 frpc...");

      const frpcExists = await frpcService.checkFrpcExists();
      if (!frpcExists) {
        this.addLog("frpc 不存在，开始下载", "warning");
        this.updateProgress(onProgress, "downloading_frpc", "正在下载 frpc...", 0);

        await frpcService.downloadFrpc((progress) => {
          this.updateProgress(onProgress, "downloading_frpc", "正在下载 frpc...", progress.percentage);
        });
        this.addLog("frpc 下载完成", "success");
      } else {
        this.addLog("frpc 已存在", "success");
      }

      if (this.abortController?.signal.aborted) {
        throw new Error("测试已取消");
      }

      this.updateProgress(onProgress, "starting_tcp_server", "正在启动 TCP 服务器...");

      tcpServerPort = await invoke<number>("start_tcp_speed_server");
      this.currentTcpServerPort = tcpServerPort;
      this.addLog(`TCP 服务器已启动，端口: ${tcpServerPort}`, "success");

      this.addLog("正在自检 TCP 服务器...", "info");
      this.updateProgress(onProgress, "starting_tcp_server", "正在自检 TCP 服务器...");

      const serverOk = await invoke<boolean>("check_tcp_speed_server", { port: tcpServerPort });
      if (!serverOk) {
        this.addLog("TCP 服务器自检失败，尝试重启...", "warning");
        await invoke("stop_tcp_speed_server");
        await new Promise((resolve) => setTimeout(resolve, 500));
        tcpServerPort = await invoke<number>("start_tcp_speed_server");
        this.addLog(`TCP 服务器已重启，端口: ${tcpServerPort}`, "info");

        const recheckOk = await invoke<boolean>("check_tcp_speed_server", { port: tcpServerPort });
        if (!recheckOk) {
          throw new Error(`TCP 服务器自检失败，本地端口 ${tcpServerPort} 无法连接`);
        }
        this.addLog("TCP 服务器重启后自检通过", "success");
      } else {
        this.addLog("TCP 服务器自检通过", "success");
      }

      if (this.abortController?.signal.aborted) {
        throw new Error("测试已取消");
      }

      this.updateProgress(onProgress, "creating_tunnel", "正在创建隧道...");

      tunnelInfo = await tunnelService.createTempTunnel(tcpServerPort, nodeName);
      this.currentTunnelInfo = tunnelInfo;
      this.addLog(`隧道创建成功`, "success");
      this.addLog(`节点 IP: ${tunnelInfo.nodeIp}`, "info");
      this.addLog(`本地端口: ${tunnelInfo.localPort}`, "info");
      this.addLog(`远程端口: ${tunnelInfo.remotePort}`, "info");

      if (this.abortController?.signal.aborted) {
        throw new Error("测试已取消");
      }

      this.updateProgress(onProgress, "starting_frpc", "正在启动 frpc 客户端...");

      this.addLog(`frpc 配置:`, "info");
      this.addLog(`  服务器: ${tunnelInfo.nodeIp}:${tunnelInfo.serverPort}`, "info");
      this.addLog(`  本地端口: ${tunnelInfo.localPort}`, "info");
      this.addLog(`  远程端口: ${tunnelInfo.remotePort}`, "info");

      await invoke("start_frpc", {
        config: {
          server_addr: tunnelInfo.nodeIp,
          server_port: tunnelInfo.serverPort,
          user: user.usertoken,
          token: tunnelInfo.nodeToken,
          local_ip: "127.0.0.1",
          local_port: tunnelInfo.localPort,
          remote_port: tunnelInfo.remotePort,
          tunnel_name: tunnelInfo.tunnelName,
        },
      });
      frpcStarted = true;
      this.currentFrpcStarted = true;
      this.addLog("frpc 客户端已启动", "success");

      if (this.abortController?.signal.aborted) {
        throw new Error("测试已取消");
      }

      this.updateProgress(onProgress, "starting_frpc", "正在等待隧道连接...");
      this.addLog("等待隧道连接建立...", "info");

      let connected = false;
      const maxWaitTime = 6000;
      const checkInterval = 500;
      const startTime = Date.now();

      while (!connected && Date.now() - startTime < maxWaitTime) {
        if (this.abortController?.signal.aborted) {
          throw new Error("测试已取消");
        }
        
        try {
          const checkResult = await invoke<{ success: boolean; latency?: number }>("tcping_host", {
            host: tunnelInfo.nodeIp,
            port: tunnelInfo.remotePort,
            timeout: 1,
          });
          if (checkResult.success) {
            connected = true;
            this.addLog("隧道连接建立成功", "success");
            break;
          }
        } catch {
          // 连接失败，继续等待
        }
        
        await new Promise((resolve) => setTimeout(resolve, checkInterval));
      }

      if (!connected) {
        this.addLog("隧道连接超时，继续尝试测试...", "warning");
      }

      if (testLatency) {
        this.updateProgress(onProgress, "testing_latency", "正在测试延迟...");
        this.addLog("开始延迟测试", "info");

        latency = await this.testLatency(tunnelInfo.nodeIp, tunnelInfo.remotePort);
        this.addLog(`延迟测试完成: ${latency}ms`, "success");

        if (this.abortController?.signal.aborted) {
          throw new Error("测试已取消");
        }
      }

      if (testSpeed) {
        this.updateProgress(onProgress, "testing_speed", "正在测试下载速度...", 0);
        this.addLog("开始下载速度测试", "info");

        downloadSpeed = await this.testTcpSpeed(
          tunnelInfo.nodeIp,
          tunnelInfo.remotePort,
          speedTestSize,
        );
        this.addLog(`下载速度: ${downloadSpeed.toFixed(2)} Mbps`, "success");
      }

      this.updateProgress(onProgress, "cleaning_up", "正在清理资源...");
      this.addLog("正在清理资源...", "info");

      await this.cleanup(frpcStarted, tunnelInfo, tcpServerPort);
      this.addLog("资源清理完成", "success");

      this.updateProgress(onProgress, "completed", "测试完成");
      this.addLog("测试完成", "success");

      return {
        success: true,
        latency,
        downloadSpeed,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.addLog(`错误: ${errorMessage}`, "error");
      
      this.updateProgress(onProgress, "cleaning_up", "正在清理资源...");
      this.addLog("正在清理资源...", "info");
      await this.cleanup(frpcStarted, tunnelInfo, tcpServerPort);
      this.addLog("资源清理完成", "success");
      
      this.updateProgress(onProgress, "error", errorMessage);

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  async cleanupTunnel(tunnelInfo: TempTunnelInfo): Promise<void> {
    this.addLog("正在手动清理隧道资源...", "info");
    try {
      await invoke("stop_frpc", { tunnelName: tunnelInfo.tunnelName });
      this.addLog("frpc 已停止", "success");
    } catch (error) {
      this.addLog(`停止 frpc 失败: ${error}`, "error");
    }

    try {
      await tunnelService.deleteTempTunnel();
      this.addLog("隧道已删除", "success");
    } catch (error) {
      this.addLog(`删除隧道失败: ${error}`, "error");
    }

    // 兜底：扫描列表清除所有遗留的 speedtest_ 临时隧道，避免异常退出导致残留
    try {
      const cleaned = await tunnelService.cleanupAllTempTunnels();
      if (cleaned > 0) {
        this.addLog(`已额外清理 ${cleaned} 个遗留临时隧道`, "warning");
      }
    } catch (error) {
      this.addLog(`兜底清理失败: ${error}`, "error");
    }

    try {
      await invoke("stop_tcp_speed_server");
      this.addLog("TCP 服务器已停止", "success");
    } catch (error) {
      this.addLog(`停止 TCP 服务器失败: ${error}`, "error");
    }
  }

  private async runLatencyOnlyTest(
    nodeName: string,
    onProgress: SpeedTestCallback,
  ): Promise<SpeedTestResult> {
    try {
      this.addLog("开始延迟测试（直连模式）", "info");
      this.addLog(`目标节点: ${nodeName}`, "info");

      this.updateProgress(onProgress, "testing_latency", "正在获取节点信息...");

      const nodeInfo = await fetchNodeInfo(nodeName);
      const nodeIp = nodeInfo.ip || nodeInfo.realIp || nodeInfo.real_IP;
      if (!nodeIp) {
        throw new Error("无法获取节点IP地址");
      }
      const nodePort = nodeInfo.port || 7000;
      this.addLog(`节点地址: ${nodeIp}:${nodePort}`, "info");

      if (this.abortController?.signal.aborted) {
        throw new Error("测试已取消");
      }

      this.updateProgress(onProgress, "testing_latency", "正在测试延迟...");
      this.addLog("开始延迟测试", "info");

      const latency = await this.testLatency(nodeIp, nodePort);
      this.addLog(`延迟测试完成: ${latency}ms`, "success");

      this.updateProgress(onProgress, "completed", "测试完成");
      this.addLog("延迟测试完成", "success");

      return { success: true, latency };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.addLog(`错误: ${errorMessage}`, "error");
      this.updateProgress(onProgress, "error", errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  private async testLatency(host: string, port: number): Promise<number> {
    console.log("[SpeedTest] testLatency called with:", { host, port });
    const results: number[] = [];
    const testCount = 2;

    for (let i = 0; i < testCount; i++) {
      try {
        console.log(`[SpeedTest] TCPing attempt ${i + 1}/${testCount}`);
        const result = await invoke<{ success: boolean; latency?: number; error?: string }>("tcping_host", {
          host,
          port,
          timeout: 3,
        });
        console.log(`[SpeedTest] TCPing result ${i + 1}:`, result);
        if (result.success && result.latency && result.latency > 0) {
          results.push(result.latency);
        }
      } catch (error) {
        console.error(`[SpeedTest] TCPing attempt ${i + 1} failed:`, error);
      }
    }

    if (results.length > 0) {
      return Math.round(results.reduce((a, b) => a + b, 0) / results.length);
    }

    console.log("[SpeedTest] TCPing failed, falling back to ping...");

    try {
      const pingResult = await invoke<{ success: boolean; latency?: number }>("ping_host", {
        host,
        count: 2,
      });
      console.log("[SpeedTest] Ping result:", pingResult);
      if (pingResult.success && pingResult.latency && pingResult.latency > 0) {
        return Math.round(pingResult.latency);
      }
    } catch (error) {
      console.error("[SpeedTest] Ping also failed:", error);
    }

    throw new Error("无法连接到隧道服务器");
  }

  private async testTcpSpeed(
    host: string,
    port: number,
    sizeMb: number,
  ): Promise<number> {
    console.log("[SpeedTest] Starting TCP speed test:", { host, port, sizeMb });

    try {
      const result = await invoke<{
        success: boolean;
        speed_mbps: number;
        total_bytes: number;
        duration_ms: number;
        error?: string;
      }>("tcp_speed_test", {
        host,
        port,
        sizeMb,
      });

      console.log("[SpeedTest] TCP speed test result:", result);

      if (result.success) {
        return Math.round(result.speed_mbps * 100) / 100;
      }

      throw new Error(result.error || "速度测试失败");
    } catch (error) {
      console.error("[SpeedTest] TCP speed test failed:", error);
      throw error;
    }
  }

  private async cleanup(
    frpcStarted: boolean,
    tunnelInfo: TempTunnelInfo | null,
    tcpServerPort: number,
  ): Promise<void> {
    try {
      if (frpcStarted && tunnelInfo) {
        await invoke("stop_frpc", { tunnelName: tunnelInfo.tunnelName });
      }
    } catch {
      // ignore
    }

    try {
      if (tunnelInfo) {
        await tunnelService.deleteTempTunnel();
      }
    } catch {
      // ignore
    }

    // 兜底：扫描列表清除所有遗留的 speedtest_ 临时隧道
    // 宁可多调用 API 也不放过任何一个残留
    try {
      await tunnelService.cleanupAllTempTunnels();
    } catch {
      // ignore
    }

    try {
      if (tcpServerPort > 0) {
        await invoke("stop_tcp_speed_server");
      }
    } catch {
      // ignore
    }
  }

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  getCurrentState(): {
    tunnelInfo: TempTunnelInfo | null;
    frpcStarted: boolean;
    tcpServerPort: number;
  } {
    return {
      tunnelInfo: this.currentTunnelInfo,
      frpcStarted: this.currentFrpcStarted,
      tcpServerPort: this.currentTcpServerPort,
    };
  }

  async forceCleanup(): Promise<void> {
    this.addLog("正在强制清理资源...", "info");
    await this.cleanup(this.currentFrpcStarted, this.currentTunnelInfo, this.currentTcpServerPort);
    this.currentTunnelInfo = null;
    this.currentFrpcStarted = false;
    this.currentTcpServerPort = 0;
    this.addLog("强制清理完成", "success");
  }
}

export const speedTestService = new SpeedTestService();
