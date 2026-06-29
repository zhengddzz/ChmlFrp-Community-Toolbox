import { useState } from "react";
import { Trash2, Loader2 } from "lucide-react";
import {
  Item,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemActions,
} from "@/components/ui/item";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { fetchTunnels, deleteTunnel, getStoredUser } from "@/services/api";

// 临时隧道名称前缀（与 tunnelService.createTempTunnel 中保持一致）
const TEMP_TUNNEL_PREFIX = "speedtest";

export function MaintenanceSection() {
  const [cleaning, setCleaning] = useState(false);

  const handleCleanTempTunnels = async () => {
    // 登录态校验：删除隧道需要 usertoken/accessToken
    const user = getStoredUser();
    if (!user) {
      toast.error("请先登录账户");
      return;
    }

    if (cleaning) return;
    setCleaning(true);

    try {
      // 拉取隧道列表并筛选以 speedtest 开头的临时隧道
      const tunnels = await fetchTunnels();
      const tempTunnels = tunnels.filter((t) =>
        t.name?.toLowerCase().startsWith(TEMP_TUNNEL_PREFIX),
      );

      if (tempTunnels.length === 0) {
        toast.success("未发现遗留的临时隧道");
        return;
      }

      // 二次确认，避免误删
      const confirmed = confirm(
        `发现 ${tempTunnels.length} 个临时隧道（前缀 ${TEMP_TUNNEL_PREFIX}_），确认全部删除？`,
      );
      if (!confirmed) return;

      // 并行删除，allSettled 保证单个失败不影响其他
      const results = await Promise.allSettled(
        tempTunnels.map((t) => deleteTunnel(t.id)),
      );
      const succeeded = results.filter(
        (r) => r.status === "fulfilled",
      ).length;
      const failed = results.length - succeeded;

      if (failed === 0) {
        toast.success(`已清除全部 ${succeeded} 个临时隧道`);
      } else {
        toast.warning(
          `已删除 ${succeeded} 个，失败 ${failed} 个，可稍后重试`,
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "清除临时隧道失败");
    } finally {
      setCleaning(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Trash2 className="w-4 h-4" />
        <span>数据维护</span>
      </div>
      <div className="rounded-lg bg-card overflow-hidden">
        <Item variant="outline" className="border-0">
          <ItemContent>
            <ItemTitle>清除临时隧道</ItemTitle>
            <ItemDescription className="text-xs">
              一键删除测速过程中遗留的临时隧道（名称以 {TEMP_TUNNEL_PREFIX}_ 开头）
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button
              size="sm"
              variant="destructive"
              disabled={cleaning}
              onClick={handleCleanTempTunnels}
              className="h-auto px-3 py-1.5 text-xs gap-1.5"
            >
              {cleaning ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  清除中...
                </>
              ) : (
                "清除"
              )}
            </Button>
          </ItemActions>
        </Item>
      </div>
    </div>
  );
}
