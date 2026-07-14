import { useState } from "react";
import { cn } from "@/lib/utils";
import { Shield, KeyRound, ListChecks, ScrollText } from "lucide-react";
import { type StoredUser } from "@/services/api";
import { CredentialsTab } from "./components/CredentialsTab";
import { TasksTab } from "./components/TasksTab";
import { LogsTab } from "./components/LogsTab";

type TabId = "tasks" | "credentials" | "logs";

const TABS: { id: TabId; label: string; icon: typeof Shield }[] = [
  { id: "tasks", label: "监控任务", icon: ListChecks },
  { id: "credentials", label: "DNS 凭证", icon: KeyRound },
  { id: "logs", label: "切换日志", icon: ScrollText },
];

interface DnsFailoverProps {
  user?: StoredUser | null;
}

export function DnsFailover({ user }: DnsFailoverProps) {
  const [activeTab, setActiveTab] = useState<TabId>("tasks");

  return (
    <div className="flex h-full flex-col">
      {/* 顶部标题栏 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/40">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <Shield className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-foreground">DNS 容灾</h1>
            <p className="text-xs text-muted-foreground">监控隧道状态，主隧道异常自动切换 CNAME 到备用隧道</p>
          </div>
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="flex items-center gap-1 px-6 pt-3 border-b border-border/40">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors",
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* 内容区 - 使用统一滚动条样式 */}
      <div className="flex-1 min-h-0 overflow-y-auto visible-scrollbar">
        <div className="p-6">
          {activeTab === "tasks" && <TasksTab user={user} />}
          {activeTab === "credentials" && <CredentialsTab />}
          {activeTab === "logs" && <LogsTab />}
        </div>
      </div>
    </div>
  );
}
