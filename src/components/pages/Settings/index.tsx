import { useState, useEffect, useCallback } from "react";
import { useTheme } from "./hooks/useTheme";
import { useBackgroundImage } from "./hooks/useBackgroundImage";
import {
  getInitialShowTitleBar,
  getInitialEffectType,
  getInitialVideoStartSound,
  getInitialVideoVolume,
  getInitialSidebarMode,
  type EffectType,
  type SidebarMode,
} from "./utils";
import { AppearanceSection } from "./components/AppearanceSection";
import { UpdateSection } from "./components/UpdateSection";
import { GeneralSection } from "./components/GeneralSection";
import { MaintenanceSection } from "./components/MaintenanceSection";
import { UpdateDialog } from "@/components/dialogs/UpdateDialog";
import { updateService, type UpdateInfo } from "@/services/updateService";
import { toast } from "sonner";
import { openUrl } from "@tauri-apps/plugin-opener";

export function Settings() {
  const isMacOS =
    typeof navigator !== "undefined" &&
    navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const isWindows =
    typeof navigator !== "undefined" &&
    navigator.platform.toUpperCase().indexOf("WIN") >= 0;

  const {
    followSystem,
    setFollowSystem,
    theme,
    setTheme,
    isViewTransitionRef,
  } = useTheme();

  const {
    backgroundImage,
    isSelectingImage,
    overlayOpacity,
    setOverlayOpacity,
    blur,
    setBlur,
    handleSelectBackgroundImage,
    handleClearBackgroundImage,
  } = useBackgroundImage();

  const [showTitleBar, setShowTitleBar] = useState<boolean>(() =>
    getInitialShowTitleBar(),
  );
  const [effectType, setEffectType] = useState<EffectType>(() =>
    getInitialEffectType(),
  );
  const [videoStartSound, setVideoStartSound] = useState<boolean>(() =>
    getInitialVideoStartSound(),
  );
  const [videoVolume, setVideoVolume] = useState<number>(() =>
    getInitialVideoVolume(),
  );
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(() =>
    getInitialSidebarMode(),
  );

  const [currentVersion, setCurrentVersion] = useState<string>("");
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  // 安装包是否已下载完成，等待用户确认重启
  const [downloaded, setDownloaded] = useState(false);
  // 下载完成的安装包路径，供用户确认后调用安装
  const [installerPath, setInstallerPath] = useState<string | null>(null);
  const [autoCheckEnabled, setAutoCheckEnabled] = useState(() =>
    updateService.getAutoCheckEnabled(),
  );

  useEffect(() => {
    updateService.getCurrentVersion().then(setCurrentVersion);
  }, []);

  // 启动时检查是否有未完成的待安装更新（上次下载完成但未安装）
  useEffect(() => {
    const restorePendingInstaller = async () => {
      const pendingPath = await updateService.getPendingInstaller();
      if (pendingPath) {
        setInstallerPath(pendingPath);
        setDownloaded(true);
      }
    };
    restorePendingInstaller();
  }, []);

  useEffect(() => {
    localStorage.setItem("showTitleBar", showTitleBar.toString());
    window.dispatchEvent(new Event("titleBarVisibilityChanged"));
  }, [showTitleBar]);

  useEffect(() => {
    localStorage.setItem("effectType", effectType);
    window.dispatchEvent(new Event("effectTypeChanged"));
  }, [effectType]);

  useEffect(() => {
    localStorage.setItem("videoStartSound", videoStartSound.toString());
    window.dispatchEvent(new Event("videoStartSoundChanged"));
  }, [videoStartSound]);

  useEffect(() => {
    localStorage.setItem("videoVolume", videoVolume.toString());
    window.dispatchEvent(new Event("videoVolumeChanged"));
  }, [videoVolume]);

  const handleSidebarModeChange = useCallback(
    (newMode: SidebarMode) => {
      setSidebarMode(newMode);
      localStorage.setItem("sidebarMode", newMode);
      window.dispatchEvent(new Event("sidebarModeChanged"));

      if (
        (newMode === "floating" || newMode === "floating_fixed") &&
        !showTitleBar
      ) {
        setShowTitleBar(true);
        localStorage.setItem("showTitleBar", "true");
        window.dispatchEvent(new Event("titleBarVisibilityChanged"));
      }
    },
    [showTitleBar],
  );

  useEffect(() => {
    localStorage.setItem("sidebarMode", sidebarMode);
    window.dispatchEvent(new Event("sidebarModeChanged"));
  }, [sidebarMode]);

  const handleCheckUpdate = useCallback(async () => {
    setCheckingUpdate(true);
    try {
      const result = await updateService.checkUpdate();
      if (result.available) {
        // 发现新版本：设置 updateInfo 触发 UpdateDialog 弹出，不显示 toast
        setUpdateInfo({
          version: result.version || "",
          date: result.date,
          body: result.body,
          mandatory: result.mandatory,
        });
      } else {
        setUpdateInfo(null);
        toast.success("当前已是最新版本");
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "检查更新失败";
      toast.error(errorMsg, {
        action: {
          label: "手动检查",
          onClick: () => {
            void openUrl(updateService.getReleaseUrl());
          },
        },
      });
    } finally {
      setCheckingUpdate(false);
    }
  }, []);

  const handleUpdate = useCallback(async () => {
    setIsDownloading(true);
    setDownloadProgress(0);
    setDownloaded(false);
    setInstallerPath(null);
    try {
      // 仅下载安装包，不自动重启
      const filePath = await updateService.downloadUpdate((progress) => {
        setDownloadProgress(progress);
      });
      setInstallerPath(filePath);
      setDownloaded(true);
      // 通知 App 层同步下载完成状态，使侧边栏"立即更新"按钮显示
      window.dispatchEvent(
        new CustomEvent("update-downloaded", { detail: { installerPath: filePath } }),
      );
      toast.success("更新已下载完成，可随时重启安装");
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "下载更新失败";
      toast.error(errorMsg, {
        action: {
          label: "手动下载",
          onClick: () => {
            void openUrl(updateService.getReleaseUrl());
          },
        },
      });
    } finally {
      setIsDownloading(false);
    }
  }, []);

  // 用户确认后运行安装包并退出当前应用
  const handleInstall = useCallback(async () => {
    if (!installerPath) {
      toast.error("安装包路径丢失，请重新下载");
      setDownloaded(false);
      return;
    }
    try {
      await updateService.installUpdate(installerPath);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "启动安装失败";
      toast.error(errorMsg, {
        action: {
          label: "手动下载",
          onClick: () => {
            void openUrl(updateService.getReleaseUrl());
          },
        },
      });
    }
  }, [installerPath]);

  const handleAutoCheckChange = useCallback((enabled: boolean) => {
    setAutoCheckEnabled(enabled);
    updateService.setAutoCheckEnabled(enabled);
  }, []);

  // 关闭更新对话框：仅关闭弹窗，保留 downloaded 状态以便侧边栏/UpdateSection 继续显示"立即更新"
  const handleCloseUpdateDialog = useCallback(() => {
    setUpdateInfo(null);
  }, []);

  // 监听 App 层弹窗触发的下载事件，同步设置页下载状态
  useEffect(() => {
    const handleDownloadStart = () => {
      setIsDownloading(true);
      setDownloadProgress(0);
      setDownloaded(false);
      setInstallerPath(null);
    };
    const handleDownloadProgress = (e: Event) => {
      const detail = (e as CustomEvent<{ progress: number }>).detail;
      if (detail?.progress != null) {
        setDownloadProgress(detail.progress);
      }
    };
    const handleUpdateDownloaded = (e: Event) => {
      const detail = (e as CustomEvent<{ installerPath: string }>).detail;
      if (detail?.installerPath) {
        setInstallerPath(detail.installerPath);
      }
      setDownloaded(true);
    };
    const handleDownloadEnd = () => {
      setIsDownloading(false);
    };
    window.addEventListener("update-download-start", handleDownloadStart);
    window.addEventListener("update-download-progress", handleDownloadProgress);
    window.addEventListener("update-downloaded", handleUpdateDownloaded);
    window.addEventListener("update-download-end", handleDownloadEnd);
    return () => {
      window.removeEventListener("update-download-start", handleDownloadStart);
      window.removeEventListener("update-download-progress", handleDownloadProgress);
      window.removeEventListener("update-downloaded", handleUpdateDownloaded);
      window.removeEventListener("update-download-end", handleDownloadEnd);
    };
  }, []);

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-medium text-foreground">设置</h1>
      </div>

      <div className="flex-1 overflow-auto space-y-6">
        <AppearanceSection
        isMacOS={isMacOS}
        isWindows={isWindows}
        followSystem={followSystem}
        setFollowSystem={setFollowSystem}
        theme={theme}
        setTheme={setTheme}
        isViewTransitionRef={isViewTransitionRef}
        showTitleBar={showTitleBar}
        setShowTitleBar={setShowTitleBar}
        backgroundImage={backgroundImage}
        isSelectingImage={isSelectingImage}
        overlayOpacity={overlayOpacity}
        setOverlayOpacity={setOverlayOpacity}
        blur={blur}
        setBlur={setBlur}
        effectType={effectType}
        setEffectType={setEffectType}
        videoStartSound={videoStartSound}
        setVideoStartSound={setVideoStartSound}
        videoVolume={videoVolume}
        setVideoVolume={setVideoVolume}
        sidebarMode={sidebarMode}
        setSidebarMode={handleSidebarModeChange}
        onSelectBackgroundImage={handleSelectBackgroundImage}
        onClearBackgroundImage={handleClearBackgroundImage}
      />

      <UpdateSection
          checkingUpdate={checkingUpdate}
          currentVersion={currentVersion}
          onCheckUpdate={handleCheckUpdate}
          updateInfo={updateInfo}
          onUpdate={handleUpdate}
          onInstall={handleInstall}
          isDownloading={isDownloading}
          downloaded={downloaded}
          downloadProgress={downloadProgress}
          autoCheckEnabled={autoCheckEnabled}
          onAutoCheckChange={handleAutoCheckChange}
        />

      <GeneralSection />

      <MaintenanceSection />
    </div>

      {/* 更新对话框：手动检查发现新版本时弹出 */}
      <UpdateDialog
        isOpen={updateInfo !== null}
        onClose={handleCloseUpdateDialog}
        onUpdate={handleUpdate}
        onInstall={handleInstall}
        version={updateInfo?.version || ""}
        date={updateInfo?.date}
        body={updateInfo?.body}
        isDownloading={isDownloading}
        downloaded={downloaded}
        downloadProgress={downloadProgress}
      />
    </div>
  );
}
