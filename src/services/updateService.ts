import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";

// 后端返回的应用更新信息
export interface AppUpdateInfo {
  version: string;
  releaseDate: string;
  releaseNotes: string;
  mandatory: boolean;
  downloadUrl: string;
  downloadSize: number;
  sha256: string;
  format: string;
  currentVersion: string;
}

// 前端展示用的更新信息
export interface UpdateInfo {
  version: string;
  date?: string;
  body?: string;
  mandatory?: boolean;
}

// 下载进度事件载荷
interface DownloadProgressPayload {
  downloaded: number;
  total: number;
  percentage: number;
}

export class UpdateService {
  // 缓存最近一次检查到的更新信息，供下载安装使用
  private lastUpdateInfo: AppUpdateInfo | null = null;

  /**
   * 检查应用更新
   * 请求后端接口对比版本，若有新版本则缓存信息并返回
   */
  async checkUpdate(): Promise<{
    available: boolean;
    version?: string;
    date?: string;
    body?: string;
    mandatory?: boolean;
  }> {
    try {
      const result = await invoke<AppUpdateInfo | null>("check_app_update");
      this.lastUpdateInfo = result;

      if (result) {
        return {
          available: true,
          version: result.version,
          date: result.releaseDate,
          body: result.releaseNotes,
          mandatory: result.mandatory,
        };
      }

      return { available: false };
    } catch (error) {
      console.error("检查更新失败:", error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`检查更新失败: ${errorMsg}`);
    }
  }

  /**
   * 仅下载更新安装包，不退出应用
   * @param onProgress 下载进度回调，参数为 0-100 的百分比
   * @returns 下载完成的安装包路径
   */
  async downloadUpdate(onProgress?: (progress: number) => void): Promise<string> {
    // 优先使用缓存的更新信息，没有则重新检查
    let updateInfo = this.lastUpdateInfo;
    if (!updateInfo) {
      const checkResult = await invoke<AppUpdateInfo | null>("check_app_update");
      if (!checkResult) {
        throw new Error("没有可用的更新，请手动下载最新版本");
      }
      updateInfo = checkResult;
      this.lastUpdateInfo = checkResult;
    }

    // 监听下载进度事件
    let unlisten: UnlistenFn | undefined;
    if (onProgress) {
      unlisten = await listen<DownloadProgressPayload>(
        "app-update-progress",
        (event) => {
          onProgress(event.payload.percentage);
        },
      );
    }

    try {
      // 下载安装包到临时目录，返回文件路径
      const filePath = await invoke<string>("download_app_update", {
        url: updateInfo.downloadUrl,
        sha256: updateInfo.sha256,
      });
      return filePath;
    } finally {
      unlisten?.();
    }
  }

  /**
   * 运行安装包并退出当前应用以完成更新
   * 仅在用户确认后调用
   * @param filePath 下载完成的安装包路径
   */
  async installUpdate(filePath: string): Promise<void> {
    await invoke("install_app_update", { filePath });
  }

  /**
   * 查询是否有已下载完成、待安装的更新
   * 用于应用启动时恢复"立即更新"状态
   */
  async getPendingInstaller(): Promise<string | null> {
    try {
      return await invoke<string | null>("get_pending_installer");
    } catch {
      return null;
    }
  }

  /**
   * 清除待安装记录（用户取消或安装包失效时调用）
   */
  async clearPendingInstaller(): Promise<void> {
    try {
      await invoke("clear_pending_installer");
    } catch {
      // 忽略清除失败
    }
  }

  /** 是否启动时自动检查更新 */
  getAutoCheckEnabled(): boolean {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem("autoCheckUpdate");
    return stored !== "false";
  }

  setAutoCheckEnabled(enabled: boolean): void {
    if (typeof window === "undefined") return;
    localStorage.setItem("autoCheckUpdate", enabled ? "true" : "false");
  }

  /** 获取当前应用版本 */
  async getCurrentVersion(): Promise<string> {
    try {
      return await getVersion();
    } catch (error) {
      console.error("获取版本失败:", error);
      return "未知";
    }
  }

  /** 手动下载页面地址 */
  getReleaseUrl(): string {
    return "https://github.com/zhengddzz/ChmlFrp-Community-Toolbox/releases/latest";
  }
}

export const updateService = new UpdateService();
