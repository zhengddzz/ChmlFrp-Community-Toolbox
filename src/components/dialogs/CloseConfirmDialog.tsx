import { useState, useEffect, useCallback } from "react";
import { ShieldAlert, Minimize2, LogOut } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { invoke } from "@tauri-apps/api/core";
import { dnsFailoverService } from "@/services/dnsFailoverService";
import { setCloseAction, type CloseAction } from "@/lib/settings-utils";
import { toast } from "sonner";

interface CloseConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CloseConfirmDialog({ isOpen, onClose }: CloseConfirmDialogProps) {
  const [enabledTasks, setEnabledTasks] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [remember, setRemember] = useState(false);

  // 对话框打开时检查是否有正在运行的容灾任务，并重置"记住选择"复选框
  useEffect(() => {
    if (!isOpen) return;
    setRemember(false);
    setLoading(true);
    dnsFailoverService
      .listTasks()
      .then((tasks) => {
        setEnabledTasks(
          tasks.filter((t) => t.enabled).map((t) => t.name),
        );
      })
      .catch(() => {
        // 获取失败时不阻塞关闭流程
        setEnabledTasks([]);
      })
      .finally(() => setLoading(false));
  }, [isOpen]);

  // 用户勾选"记住"时，把所选行为存为默认，下次关闭直接执行不再弹窗
  const persistIfRemembered = useCallback((action: CloseAction) => {
    if (remember) {
      setCloseAction(action);
      toast.success(`已记住本次选择，下次关闭将自动${action === "minimize" ? "最小化到托盘" : "退出程序"}（可在设置中修改）`);
    }
  }, [remember]);

  const handleMinimizeToTray = useCallback(async () => {
    persistIfRemembered("minimize");
    try {
      await invoke("minimize_to_tray");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "最小化失败");
    }
  }, [onClose, persistIfRemembered]);

  const handleExitApp = useCallback(async () => {
    persistIfRemembered("exit");
    try {
      await invoke("exit_app");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "退出失败");
    }
  }, [persistIfRemembered]);

  const hasRunningTasks = enabledTasks.length > 0;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {hasRunningTasks ? (
              <ShieldAlert className="h-5 w-5 text-amber-500" />
            ) : null}
            {hasRunningTasks ? "容灾任务正在运行" : "关闭窗口"}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="text-sm text-muted-foreground space-y-2">
              {loading ? (
                <p>正在检查容灾任务状态...</p>
              ) : hasRunningTasks ? (
                <>
                  <p>
                    当前有 <strong className="text-foreground">{enabledTasks.length}</strong> 个 DNS 容灾任务正在运行，退出程序后将停止监控，域名无法自动切换。
                  </p>
                  <p>
                    如需保持容灾监控持续运行，请选择「最小化到托盘」，程序将驻留后台继续工作。
                  </p>
                  <ScrollArea className="max-h-24 rounded-md border border-border/50 p-2">
                    <ul className="text-xs space-y-1">
                      {enabledTasks.map((name, i) => (
                        <li key={i} className="flex items-center gap-1.5">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                          {name}
                        </li>
                      ))}
                    </ul>
                  </ScrollArea>
                </>
              ) : (
                <p>确定要关闭窗口吗？可选择最小化到系统托盘或直接退出程序。</p>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>

        {/* 记住选择复选框：勾选后本次点击的行为会成为下次默认，不再弹窗 */}
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="rounded border-border"
          />
          记住我的选择（下次不再询问，可在设置中修改）
        </label>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={handleMinimizeToTray}
            className="w-full sm:w-auto"
          >
            <Minimize2 className="h-4 w-4 mr-1.5" />
            最小化到托盘
          </Button>
          <Button
            variant={hasRunningTasks ? "destructive" : "default"}
            onClick={handleExitApp}
            className="w-full sm:w-auto"
          >
            <LogOut className="h-4 w-4 mr-1.5" />
            退出程序
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
