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

export interface SettingsProps {
  /** 是否正在下载更新 */
  isDownloading: boolean;
  /** 下载进度 0-100 */
  downloadProgress: number;
  /** 安装包是否已下载完成 */
  downloaded: boolean;
  /** 下载完成的安装包路径 */
  installerPath: string | null;
  /** 下载更新（由 App 层统一管理） */
  onUpdate: () => void;
  /** 安装更新（由 App 层统一管理） */
  onInstall: () => void;
}

export function Settings({
  isDownloading,
  downloadProgress,
  downloaded,
  installerPath,
  onUpdate,
  onInstall,
}: SettingsProps) {
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
  const [autoCheckEnabled, setAutoCheckEnabled] = useState(() =>
    updateService.getAutoCheckEnabled(),
  );

  useEffect(() => {
    updateService.getCurrentVersion().then(setCurrentVersion);
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

  const handleAutoCheckChange = useCallback((enabled: boolean) => {
    setAutoCheckEnabled(enabled);
    updateService.setAutoCheckEnabled(enabled);
  }, []);

  // 关闭更新对话框：仅关闭弹窗，保留 downloaded 状态以便侧边栏/UpdateSection 继续显示"立即更新"
  const handleCloseUpdateDialog = useCallback(() => {
    setUpdateInfo(null);
  }, []);

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-medium text-foreground">设置</h1>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto visible-scrollbar space-y-6">
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
          onUpdate={onUpdate}
          onInstall={onInstall}
          isDownloading={isDownloading}
          downloaded={downloaded}
          downloadProgress={downloadProgress}
          autoCheckEnabled={autoCheckEnabled}
          onAutoCheckChange={handleAutoCheckChange}
        />

      <GeneralSection />

      <MaintenanceSection />
      </div>

      <UpdateDialog
        isOpen={updateInfo !== null}
        onClose={handleCloseUpdateDialog}
        onUpdate={onUpdate}
        onInstall={onInstall}
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
