import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollText, Trash2, RefreshCw, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { dnsFailoverService, type DnsSwitchLog } from "@/services/dnsFailoverService";

export function LogsTab() {
  const [list, setList] = useState<DnsSwitchLog[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setList(await dnsFailoverService.listLogs());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "加载日志失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleClear = async () => {
    if (!confirm("确认清空所有切换日志？")) return;
    try {
      await dnsFailoverService.clearLogs();
      toast.success("已清空");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "清空失败");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">切换日志</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            记录每次自动切换 / 回切的事件（最多保留 500 条）
          </p>
        </div>
        <div className="flex gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={load}
            disabled={loading}
            className="gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            刷新
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleClear}
            disabled={list.length === 0}
            className="gap-1.5 text-destructive hover:text-destructive"
          >
            <Trash2 className="w-3.5 h-3.5" />
            清空
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">加载中...</div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-12 h-12 rounded-2xl bg-muted/40 flex items-center justify-center mb-3">
            <ScrollText className="w-6 h-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">暂无切换日志</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {list.map((log) => (
            <div
              key={log.id}
              className="flex items-start gap-3 p-3 rounded-xl border border-border/60 bg-card/50"
            >
              <div
                className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${
                  log.success ? "bg-emerald-500" : "bg-destructive"
                }`}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-foreground">
                    {log.taskName}
                  </span>
                  <Badge
                    variant={log.kind === "failover" ? "destructive" : "secondary"}
                    className="text-[10px] h-4 px-1"
                  >
                    {log.kind === "failover" ? "切换" : "回切"}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground">
                    {log.time}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
                  <span className="truncate">{log.fromTunnel || "—"}</span>
                  <ArrowRight className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate text-foreground font-medium">
                    {log.toTunnel}
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  CNAME → <span className="font-mono">{log.cnameValue}</span>
                  {!log.success && (
                    <span className="text-destructive ml-2">{log.message}</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
