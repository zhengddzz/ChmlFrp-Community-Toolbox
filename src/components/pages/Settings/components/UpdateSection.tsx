import { Sparkles, Download, Check, AlertCircle, RotateCcw } from "lucide-react";
import {
  Item,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemActions,
} from "@/components/ui/item";
import type { UpdateInfo } from "@/services/updateService";

interface UpdateSectionProps {
  checkingUpdate: boolean;
  currentVersion: string;
  onCheckUpdate: () => void;
  updateInfo: UpdateInfo | null;
  onUpdate: () => void;
  /** 下载完成后点击"立即重启更新"运行安装包 */
  onInstall: () => void;
  isDownloading: boolean;
  /** 安装包是否已下载完成，等待用户确认重启 */
  downloaded: boolean;
  downloadProgress: number;
  autoCheckEnabled: boolean;
  onAutoCheckChange: (enabled: boolean) => void;
}

export function UpdateSection({
  checkingUpdate,
  currentVersion,
  onCheckUpdate,
  updateInfo,
  onUpdate,
  onInstall,
  isDownloading,
  downloaded,
  downloadProgress,
  autoCheckEnabled,
  onAutoCheckChange,
}: UpdateSectionProps) {
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Sparkles className="w-4 h-4" />
        <span>更新</span>
      </div>
      <div className="rounded-lg bg-card overflow-hidden">
        <Item
          variant="outline"
          className="border-0 border-b border-border/60 last:border-0"
        >
          <ItemContent>
            <ItemTitle>启动时自动检查更新</ItemTitle>
            <ItemDescription className="text-xs">
              应用启动时自动检查是否有新版本
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={autoCheckEnabled}
                onChange={(e) => onAutoCheckChange(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-muted rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
            </label>
          </ItemActions>
        </Item>

        <Item
          variant="outline"
          className="border-0 border-b border-border/60 last:border-0"
        >
          <ItemContent>
            <ItemTitle>应用更新</ItemTitle>
            <ItemDescription className="text-xs">
              {currentVersion && (
                <span>当前版本: v{currentVersion}</span>
              )}
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <button
              onClick={onCheckUpdate}
              disabled={checkingUpdate || isDownloading}
              className={`px-3 py-1.5 text-xs rounded transition-colors ${
                checkingUpdate || isDownloading
                  ? "bg-muted text-muted-foreground cursor-not-allowed"
                  : "bg-foreground text-background hover:opacity-90"
              }`}
            >
              {checkingUpdate ? "检查中..." : "检测更新"}
            </button>
          </ItemActions>
        </Item>

        {updateInfo && (
          <Item variant="outline" className="border-0 border-b border-border/60">
            <ItemContent>
              <div className="flex items-center gap-2">
                {updateInfo.version ? (
                  <>
                    <AlertCircle className="w-4 h-4 text-yellow-500" />
                    <ItemTitle className="text-yellow-500">
                      {downloaded ? "更新已下载完成" : "发现新版本"}
                    </ItemTitle>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 text-green-500" />
                    <ItemTitle className="text-green-500">已是最新版本</ItemTitle>
                  </>
                )}
              </div>
              <ItemDescription className="text-xs">
                {updateInfo.version ? (
                  <span>
                    最新版本: v{updateInfo.version}
                    {updateInfo.date && (
                      <span className="ml-2 text-muted-foreground">
                        ({formatDate(updateInfo.date)})
                      </span>
                    )}
                    {downloaded && (
                      <span className="ml-2 text-green-500">· 已就绪，等待重启安装</span>
                    )}
                  </span>
                ) : (
                  <span>v{currentVersion}</span>
                )}
              </ItemDescription>
            </ItemContent>
            {updateInfo.version && (
              <ItemActions>
                {downloaded ? (
                  <button
                    onClick={onInstall}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" />
                    立即重启更新
                  </button>
                ) : (
                  <button
                    onClick={onUpdate}
                    disabled={isDownloading}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 transition-colors disabled:opacity-50"
                  >
                    <Download className="w-3 h-3" />
                    {isDownloading ? `${downloadProgress.toFixed(0)}%` : "立即更新"}
                  </button>
                )}
              </ItemActions>
            )}
          </Item>
        )}

        {isDownloading && (
          <Item variant="outline" className="border-0">
            <ItemContent>
              <div className="w-full">
                <div className="flex items-center justify-between text-xs mb-2">
                  <span className="text-muted-foreground">正在下载更新...</span>
                  <span className="text-foreground font-mono">{downloadProgress.toFixed(0)}%</span>
                </div>
                <div className="w-full bg-muted/50 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-primary to-primary/80 h-full rounded-full transition-all duration-300"
                    style={{ width: `${downloadProgress}%` }}
                  />
                </div>
              </div>
            </ItemContent>
          </Item>
        )}
      </div>
    </div>
  );
}
