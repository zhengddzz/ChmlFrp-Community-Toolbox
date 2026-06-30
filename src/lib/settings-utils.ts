export type SidebarMode = "classic" | "floating" | "floating_fixed";

export type EffectType = "frosted" | "translucent" | "none";

// 关闭窗口默认行为
// - ask: 每次询问（弹窗）
// - minimize: 直接最小化到系统托盘
// - exit: 直接退出程序
export type CloseAction = "ask" | "minimize" | "exit";

export const getCloseAction = (): CloseAction => {
  if (typeof window === "undefined") return "ask";
  const stored = localStorage.getItem("closeAction");
  if (stored === "ask" || stored === "minimize" || stored === "exit") {
    return stored;
  }
  return "ask";
};

export const setCloseAction = (action: CloseAction): void => {
  if (typeof window === "undefined") return;
  localStorage.setItem("closeAction", action);
  // 通知其他组件设置已变更（如设置页修改后，关闭弹窗应感知新行为）
  window.dispatchEvent(new Event("closeActionChanged"));
};

export const getInitialEffectType = (): EffectType => {
  if (typeof window === "undefined") return "none";
  const stored = localStorage.getItem("effectType");
  if (stored === "frosted" || stored === "translucent" || stored === "none") {
    return stored;
  }
  return "none";
};

export const getInitialSidebarMode = (): SidebarMode => {
  if (typeof window === "undefined") return "classic";
  const stored = localStorage.getItem("sidebarMode") as SidebarMode | null;
  if (
    stored === "classic" ||
    stored === "floating" ||
    stored === "floating_fixed"
  )
    return stored;
  return "classic";
};

export const getInitialBackgroundImage = (): string | null => {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("backgroundImage");
};

export const getInitialBackgroundOverlayOpacity = (): number => {
  if (typeof window === "undefined") return 80;
  const stored = localStorage.getItem("backgroundOverlayOpacity");
  return stored ? parseInt(stored, 10) : 80;
};

export const getInitialBackgroundBlur = (): number => {
  if (typeof window === "undefined") return 4;
  const stored = localStorage.getItem("backgroundBlur");
  return stored ? parseInt(stored, 10) : 4;
};

export const getMimeType = (filePath: string): string => {
  const ext = filePath.split(".").pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    mp4: "video/mp4",
    webm: "video/webm",
    ogv: "video/ogg",
    mov: "video/quicktime",
  };
  return mimeTypes[ext || ""] || "image/png";
};

export const isVideoFile = (filePath: string): boolean => {
  const ext = filePath.split(".").pop()?.toLowerCase();
  const videoExts = ["mp4", "webm", "ogv", "mov"];
  return videoExts.includes(ext || "");
};

export const isVideoMimeType = (mimeType: string): boolean => {
  return mimeType.startsWith("video/");
};

export const getBackgroundType = (
  dataUrl: string | null,
): "image" | "video" | null => {
  if (!dataUrl) return null;
  if (dataUrl.startsWith("data:video/")) return "video";
  if (dataUrl.startsWith("data:image/")) return "image";
  if (dataUrl.startsWith("app://") || dataUrl.startsWith("file://")) {
    const ext = dataUrl.split(".").pop()?.toLowerCase();
    const videoExts = ["mp4", "webm", "ogv", "mov"];
    if (ext && videoExts.includes(ext)) return "video";
  }
  return "image";
};

export const getInitialVideoStartSound = (): boolean => {
  if (typeof window === "undefined") return false;
  const stored = localStorage.getItem("videoStartSound");
  return stored === "true";
};

export const getInitialVideoVolume = (): number => {
  if (typeof window === "undefined") return 50;
  const stored = localStorage.getItem("videoVolume");
  return stored ? parseInt(stored, 10) : 50;
};

export const getInitialShowTitleBar = (): boolean => {
  if (typeof window === "undefined") return false;
  const isMacOS = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const stored = localStorage.getItem("showTitleBar");
  if (stored === null) return !isMacOS;
  return stored === "true";
};
