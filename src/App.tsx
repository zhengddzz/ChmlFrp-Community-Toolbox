import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Sidebar } from "@/components/Sidebar";
import { TitleBar, WindowControls } from "@/components/TitleBar";
import { NodeTest } from "@/components/pages/NodeTest";
import { Settings } from "@/components/pages/Settings";
import { DnsFailover } from "@/components/pages/DnsFailover";
import { getStoredUser, clearStoredUser, fetchUserInfo, type StoredUser } from "@/services/api";
import { useAppTheme } from "@/components/App/hooks/useAppTheme";
import { useTitleBar } from "@/components/App/hooks/useTitleBar";
import { useBackground } from "@/components/App/hooks/useBackground";
import { useUpdateCheck } from "@/components/App/hooks/useUpdateCheck";
import { BackgroundLayer } from "@/components/App/components/BackgroundLayer";
import { UpdateDialog } from "@/components/dialogs/UpdateDialog";
import { CloseConfirmDialog } from "@/components/dialogs/CloseConfirmDialog";
import { getInitialSidebarMode, getCloseAction, type SidebarMode } from "@/lib/settings-utils";
import { updateService } from "@/services/updateService";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";

function App() {
  const [activeTab, setActiveTab] = useState("node-test");
  const [user, setUser] = useState<StoredUser | null>(() => getStoredUser());
  const initialSidebarMode = getInitialSidebarMode();
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() =>
    initialSidebarMode !== "classic",
  );
  const [isTesting, setIsTesting] = useState(false);
  const isMacOS =
    typeof navigator !== "undefined" &&
    navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const isWindows =
    typeof navigator !== "undefined" &&
    navigator.platform.toUpperCase().indexOf("WIN") >= 0;

  useAppTheme();
  const { showTitleBar } = useTitleBar();
  const { updateInfo, setUpdateInfo } = useUpdateCheck();
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  // 安装包是否已下载完成，等待用户确认重启
  const [downloaded, setDownloaded] = useState(false);
  // 下载完成的安装包路径，供用户确认后调用安装
  const [installerPath, setInstallerPath] = useState<string | null>(null);
  // 关闭确认对话框（由后端 window-close-requested 事件触发）
  const [showCloseDialog, setShowCloseDialog] = useState(false);

  const shouldShowTitleBar = isMacOS
    ? showTitleBar
    : isWindows
      ? showTitleBar
      : true;
  const isTitleBarHidden = (isMacOS || isWindows) && !showTitleBar;
  const shouldPadTop = shouldShowTitleBar || (isWindows && !showTitleBar);
  const SIDEBAR_LEFT = isMacOS && !showTitleBar ? 10 : 15;
  const SIDEBAR_COLLAPSED_WIDTH = Math.round(((20 * 5) / 3) * 2);
  const appContainerRef = useRef<HTMLDivElement>(null);
  const {
    backgroundImage,
    imageSrc,
    overlayOpacity,
    blur,
    effectType,
    videoLoadError,
    videoRef,
    videoStartSound,
    videoVolume,
    videoSrc,
    backgroundType,
    getBackgroundColorWithOpacity,
  } = useBackground();

  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(() =>
    initialSidebarMode,
  );

  const handleTestingChange = useCallback((testing: boolean) => {
    setIsTesting(testing);
  }, []);

  useEffect(() => {
    const handleSidebarModeChange = () => {
      const nextMode = getInitialSidebarMode();
      setSidebarMode(nextMode);
      setSidebarCollapsed(nextMode !== "classic");
    };
    window.addEventListener("sidebarModeChanged", handleSidebarModeChange);
    return () =>
      window.removeEventListener("sidebarModeChanged", handleSidebarModeChange);
  }, []);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
  };

  const backgroundStyle = useMemo(() => {
    if (!backgroundImage) {
      return { backgroundColor: getBackgroundColorWithOpacity(100) };
    }
    return {};
  }, [backgroundImage, getBackgroundColorWithOpacity]);

  const handleVideoError = () => {};

  const handleVideoLoadedData = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.volume = videoVolume / 100;
      videoRef.current.play().catch(() => {});
    }
  }, [videoRef, videoVolume]);

  const handleUpdate = useCallback(async () => {
    // 关闭更新提示对话框，下载进度改由设置页 UpdateSection 显示
    setUpdateInfo(null);
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
      toast.success("更新已下载完成，可随时重启安装");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "下载更新失败");
    } finally {
      setIsDownloading(false);
    }
  }, [setUpdateInfo]);

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

  const content = useMemo(() => {
    switch (activeTab) {
      case "node-test":
        return <NodeTest user={user} onTestingChange={handleTestingChange} />;
      case "dns-failover":
        return <DnsFailover user={user} />;
      case "settings":
        return (
          <Settings
            isDownloading={isDownloading}
            downloadProgress={downloadProgress}
            downloaded={downloaded}
            installerPath={installerPath}
            onUpdate={handleUpdate}
            onInstall={handleInstall}
          />
        );
      default:
        return <NodeTest user={user} onTestingChange={handleTestingChange} />;
    }
  }, [activeTab, user, handleTestingChange, isDownloading, downloadProgress, downloaded, installerPath, handleUpdate, handleInstall]);

  const handleCloseUpdateDialog = useCallback(() => {
    setUpdateInfo(null);
    // 仅关闭弹窗，保留 downloaded 状态以便侧边栏"立即更新"按钮继续显示
  }, [setUpdateInfo]);

  // 应用启动时检查是否有未完成的待安装更新（上次下载完成但未安装）
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

  // 监听后端窗口关闭请求事件
  // 根据用户记忆的关闭行为决定：直接执行（minimize/exit）或弹出确认对话框（ask）
  useEffect(() => {
    let unlistenFn: (() => void) | null = null;
    const setupListener = async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlistenFn = await listen("window-close-requested", () => {
        const action = getCloseAction();
        if (action === "minimize") {
          invoke("minimize_to_tray").catch((e) =>
            toast.error(e instanceof Error ? e.message : "最小化失败"),
          );
        } else if (action === "exit") {
          invoke("exit_app").catch((e) =>
            toast.error(e instanceof Error ? e.message : "退出失败"),
          );
        } else {
          // ask: 每次询问，弹出确认对话框
          setShowCloseDialog(true);
        }
      });
    };
    setupListener();
    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, []);

  // 登录状态变化时，推送 accessToken 给后端（DNS 容灾调度器请求 /tunnel 时使用）
  useEffect(() => {
    if (user?.accessToken) {
      invoke("set_user_token", { token: user.accessToken }).catch(() => {});
    }
  }, [user]);

  // 定期检查登录状态，避免 token 过期或服务端踢下线后用户无感知
  // 每 1 分钟调用一次 /userinfo 接口验证；失败时清除登录并提示
  // 同时把最新 accessToken 推送给后端（DNS 容灾调度器使用）
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const CHECK_INTERVAL_MS = 60 * 1000;

    const checkLogin = async () => {
      try {
        await fetchUserInfo();
        // 静默成功：token 仍有效，不提示避免打扰
        // 推送最新 token 给后端（fetchUserInfo 内部可能已刷新 token 并写入 localStorage）
        const latest = getStoredUser();
        if (latest?.accessToken) {
          invoke("set_user_token", { token: latest.accessToken }).catch(() => {});
        }
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        // 仅在明确是认证类错误时清除登录，避免网络抖动误清除
        if (/登录|过期|token|认证|unauthorized|401/i.test(msg)) {
          clearStoredUser();
          setUser(null);
          toast.error("登录状态已失效，请重新登录");
        }
      }
    };

    const timer = window.setInterval(checkLogin, CHECK_INTERVAL_MS);
    // 启动时立即执行一次，确保后端尽快拿到有效 token
    checkLogin();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [user]);

  return (
    <>
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
      <CloseConfirmDialog
        isOpen={showCloseDialog}
        onClose={() => setShowCloseDialog(false)}
      />
      <div
        ref={appContainerRef}
        className={`flex flex-col h-screen w-screen overflow-hidden text-foreground ${
          backgroundImage && effectType === "frosted"
            ? "frosted-glass-enabled"
            : ""
        } ${
          backgroundImage && effectType === "translucent"
            ? "translucent-enabled"
            : ""
        }`}
        style={{
          ...backgroundStyle,
          borderRadius: "0",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <BackgroundLayer
          backgroundImage={backgroundImage}
          imageSrc={imageSrc}
          backgroundType={backgroundType}
          videoSrc={videoSrc}
          videoLoadError={videoLoadError}
          videoRef={videoRef}
          videoStartSound={videoStartSound}
          overlayOpacity={overlayOpacity}
          blur={blur}
          getBackgroundColorWithOpacity={getBackgroundColorWithOpacity}
          appContainerRef={appContainerRef}
          onVideoError={handleVideoError}
          onVideoLoadedData={handleVideoLoadedData}
        />
        {shouldShowTitleBar && (
          <div className="relative z-50">
            <TitleBar />
          </div>
        )}
        {isWindows && !showTitleBar ? (
          <div
            data-tauri-drag-region
            className="absolute top-0 right-0 left-0 z-50 h-9 flex items-center justify-end pr-2"
          >
            <WindowControls />
          </div>
        ) : null}
        {sidebarMode === "floating" || sidebarMode === "floating_fixed" ? (
          <>
            <div
              className="absolute z-50"
              style={{
                left: `${SIDEBAR_LEFT}px`,
                top: isTitleBarHidden
                  ? isMacOS
                    ? "10px"
                    : "12px"
                  : "48px",
                bottom: "12px",
              }}
            >
              <Sidebar
                activeTab={activeTab}
                onTabChange={handleTabChange}
                user={user}
                onUserChange={setUser}
                collapsed={sidebarCollapsed}
                onCollapseChange={setSidebarCollapsed}
                collapsedWidth={SIDEBAR_COLLAPSED_WIDTH}
                mode={sidebarMode}
                disabled={isTesting}
                hasPendingUpdate={downloaded}
                onInstallUpdate={handleInstall}
              />
            </div>

            <div
              className="absolute z-40 overflow-hidden rounded-b-[12px]"
              style={{
                left: `${SIDEBAR_LEFT + SIDEBAR_COLLAPSED_WIDTH}px`,
                right: "0",
                top: shouldPadTop ? "36px" : "0",
                bottom: "0",
              }}
            >
              {isMacOS && !showTitleBar ? (
                <div
                  data-tauri-drag-region
                  className="absolute top-0 left-0 right-0 h-8 z-10"
                />
              ) : null}
              <div className="h-full overflow-auto px-6 pt-4 pb-6 md:px-8 md:pt-6 md:pb-8">
                <div className="max-w-6xl mx-auto w-full h-full">
                  <div className="h-full flex flex-col">{content}</div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="relative flex flex-1 overflow-hidden">
            <Sidebar
              activeTab={activeTab}
              onTabChange={handleTabChange}
              user={user}
              onUserChange={setUser}
              mode="classic"
              disabled={isTesting}
              hasPendingUpdate={downloaded}
              onInstallUpdate={handleInstall}
            />
            <div className="flex-1 flex flex-col overflow-hidden relative">
              {isMacOS && !showTitleBar ? (
                <div
                  data-tauri-drag-region
                  className="h-8 flex-shrink-0 w-full"
                />
              ) : null}
              <div
                className={`flex-1 overflow-auto px-6 pb-6 md:px-8 md:pb-8 ${shouldPadTop ? "pt-4 md:pt-6" : "pt-0"}`}
              >
                <div className="max-w-6xl mx-auto w-full h-full">
                  <div className="h-full flex flex-col">{content}</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default App;
