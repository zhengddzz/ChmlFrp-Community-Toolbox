import {
  createTunnel,
  deleteTunnel,
  fetchTunnels,
  fetchNodeInfo,
  type Tunnel,
  type CreateTunnelParams,
  getStoredUser,
} from "./api";

export interface TempTunnelInfo {
  tunnelId: number;
  tunnelName: string;
  localPort: number;
  remotePort: number;
  nodeName: string;
  nodeIp: string;
  nodeToken: string;
  serverPort: number;
}

function parsePortRange(rport: string): number[] {
  if (!rport) {
    return [20000, 40000];
  }

  if (rport.includes("-")) {
    const [start, end] = rport.split("-").map((s) => parseInt(s.trim(), 10));
    if (!isNaN(start) && !isNaN(end)) {
      return [start, end];
    }
  }

  const singlePort = parseInt(rport, 10);
  if (!isNaN(singlePort)) {
    return [singlePort, singlePort];
  }

  return [20000, 40000];
}

function getRandomPort(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export class TunnelService {
  private tempTunnel: TempTunnelInfo | null = null;

  async createTempTunnel(
    localPort: number,
    nodeName: string,
  ): Promise<TempTunnelInfo> {
    const user = getStoredUser();
    if (!user) {
      throw new Error("请先登录");
    }

    const nodeInfo = await fetchNodeInfo(nodeName);
    const [minPort, maxPort] = parsePortRange(nodeInfo.rport || "");
    const remotePort = getRandomPort(minPort, maxPort);

    const tunnelName = `speedtest_${Date.now()}`;

    const params: CreateTunnelParams = {
      tunnelname: tunnelName,
      node: nodeName,
      localip: "127.0.0.1",
      porttype: "tcp",
      localport: localPort,
      remoteport: remotePort,
      encryption: false,
      compression: false,
      extraparams: "",
    };

    await createTunnel(params);

    const tunnels = await fetchTunnels();
    const newTunnel = tunnels.find((t: Tunnel) => t.name === tunnelName);

    if (!newTunnel) {
      throw new Error("创建隧道失败：未找到新创建的隧道");
    }

    console.log("[TunnelService] Created tunnel:", {
      name: newTunnel.name,
      dorp: newTunnel.dorp,
      server_port: newTunnel.server_port,
      ip: newTunnel.ip,
      node_ip: newTunnel.node_ip,
    });

    const parsedRemotePort = parseInt(newTunnel.dorp, 10);
    const finalRemotePort = parsedRemotePort > 0 ? parsedRemotePort : remotePort;

    console.log("[TunnelService] Remote port:", {
      dorp: newTunnel.dorp,
      parsedRemotePort,
      fallbackRemotePort: remotePort,
      finalRemotePort,
    });

    console.log("[TunnelService] Node info:", {
      name: nodeInfo.name,
      ip: nodeInfo.ip,
      realIp: nodeInfo.realIp,
      real_IP: nodeInfo.real_IP,
      nodetoken: nodeInfo.nodetoken ? "(exists)" : "(missing)",
    });

    const nodeIp = nodeInfo.ip || nodeInfo.realIp || nodeInfo.real_IP || newTunnel.node_ip;
    if (!nodeIp) {
      throw new Error("无法获取节点IP地址");
    }

    const serverPort = newTunnel.server_port || nodeInfo.port || 7000;

    console.log("[TunnelService] Using node IP:", nodeIp);
    console.log("[TunnelService] Using server port:", serverPort);

    this.tempTunnel = {
      tunnelId: newTunnel.id,
      tunnelName: tunnelName,
      localPort: localPort,
      remotePort: finalRemotePort,
      nodeName: nodeName,
      nodeIp: nodeIp,
      nodeToken: nodeInfo.nodetoken || newTunnel.node_token,
      serverPort: serverPort,
    };

    return this.tempTunnel;
  }

  async deleteTempTunnel(): Promise<void> {
    if (!this.tempTunnel) {
      return;
    }

    try {
      await deleteTunnel(this.tempTunnel.tunnelId);
    } finally {
      this.tempTunnel = null;
    }
  }

  /**
   * 彻底清理所有遗留的临时隧道（speedtest_ 前缀）
   * 用于测速结束兜底，避免异常退出/记录丢失导致隧道残留
   * 宁可多调用 API 也不放过任何一个
   * @returns 实际删除的隧道数量
   */
  async cleanupAllTempTunnels(): Promise<number> {
    const TEMP_TUNNEL_PREFIX = "speedtest";
    try {
      const tunnels = await fetchTunnels();
      const tempTunnels = tunnels.filter((t) =>
        t.name?.toLowerCase().startsWith(TEMP_TUNNEL_PREFIX),
      );
      if (tempTunnels.length === 0) return 0;

      const results = await Promise.allSettled(
        tempTunnels.map((t) => deleteTunnel(t.id)),
      );
      const succeeded = results.filter(
        (r) => r.status === "fulfilled",
      ).length;

      // 清理完成后重置内部记录，避免后续 deleteTempTunnel 重复调用已删除的隧道
      this.tempTunnel = null;
      return succeeded;
    } catch {
      // 拉取列表失败时不阻塞主流程
      return 0;
    }
  }

  getTempTunnel(): TempTunnelInfo | null {
    return this.tempTunnel;
  }

  async getTunnelInfo(tunnelId: number): Promise<Tunnel | null> {
    const tunnels = await fetchTunnels();
    return tunnels.find((t: Tunnel) => t.id === tunnelId) || null;
  }
}

export const tunnelService = new TunnelService();
