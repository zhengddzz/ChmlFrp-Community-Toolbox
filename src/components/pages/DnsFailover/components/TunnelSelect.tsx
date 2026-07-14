import { useState, useRef, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, Search, Check, Globe, Server, Network } from "lucide-react";
import type { Tunnel } from "@/services/api";

interface TunnelSelectProps {
  /** 所有可选的隧道列表 */
  tunnels: Tunnel[];
  /** 当前选中的隧道名 */
  value: string;
  /** 选中隧道时回调，返回 tunnelName 和 ip（CNAME 值） */
  onChange: (tunnelName: string, cnameValue: string) => void;
  /** 占位文字 */
  placeholder?: string;
  /** 是否禁用 */
  disabled?: boolean;
  /** 需要排除的隧道名列表（如主隧道不应出现在备用隧道选项中） */
  excludeNames?: string[];
}

/** 模糊匹配：将查询拆分为字符序列，按顺序在目标中查找 */
function fuzzyMatch(text: string, query: string): boolean {
  if (!query) return true;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let qi = 0;
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

/** 高亮匹配的字符：返回 React 节点数组 */
function highlightMatch(text: string, query: string) {
  if (!query) return text;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const result: (string | { char: string; match: boolean })[] = [];
  let qi = 0;

  for (let i = 0; i < text.length; i++) {
    const isMatch = qi < q.length && lower[i] === q[qi];
    if (isMatch) qi++;
    result.push({ char: text[i], match: isMatch });
  }

  // 将连续的匹配/非匹配分组合并
  const nodes: React.ReactNode[] = [];
  let currentText = "";
  let currentMatch = false;
  let key = 0;

  for (const item of result) {
    if (typeof item === "string") {
      currentText += item;
    } else {
      if (item.match !== currentMatch) {
        if (currentText) {
          nodes.push(
            currentMatch ? (
              <mark key={key++} className="bg-primary/30 text-primary rounded px-0.5">
                {currentText}
              </mark>
            ) : (
              <span key={key++}>{currentText}</span>
            ),
          );
          currentText = "";
        }
        currentMatch = item.match;
      }
      currentText += item.char;
    }
  }
  if (currentText) {
    nodes.push(
      currentMatch ? (
        <mark key={key++} className="bg-primary/30 text-primary rounded px-0.5">
          {currentText}
        </mark>
      ) : (
        <span key={key++}>{currentText}</span>
      ),
    );
  }
  return <>{nodes}</>;
}

export function TunnelSelect({
  tunnels,
  value,
  onChange,
  placeholder = "搜索隧道名、节点、类型...",
  disabled = false,
  excludeNames = [],
}: TunnelSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 点击外部关闭下拉
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  // 打开时自动聚焦输入框
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // 模糊搜索过滤（同时排除 excludeNames 中的隧道）
  const filtered = useMemo(() => {
    const excludeSet = new Set(excludeNames);
    const available = excludeSet.size > 0
      ? tunnels.filter((t) => !excludeSet.has(t.name))
      : tunnels;
    if (!query.trim()) return available;
    return available.filter((t) => {
      return (
        fuzzyMatch(t.name, query) ||
        fuzzyMatch(t.node, query) ||
        fuzzyMatch(t.type, query) ||
        fuzzyMatch(t.ip, query)
      );
    });
  }, [tunnels, query, excludeNames]);

  const selectedTunnel = tunnels.find((t) => t.name === value);

  const handleSelect = (tunnel: Tunnel) => {
    onChange(tunnel.name, tunnel.ip);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={containerRef} className="relative">
      {/* 触发按钮 */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-input bg-background hover:bg-accent/50 transition-colors text-left",
          disabled && "opacity-50 cursor-not-allowed",
          !selectedTunnel && "text-muted-foreground",
        )}
      >
        {selectedTunnel ? (
          <>
            <span className="flex-1 truncate font-medium text-foreground">
              {selectedTunnel.name}
            </span>
            <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground flex-shrink-0">
              {selectedTunnel.type && (
                <span className="px-1 py-0.5 rounded bg-primary/10 text-primary font-medium">
                  {selectedTunnel.type.toUpperCase()}
                </span>
              )}
              {selectedTunnel.node && (
                <span className="flex items-center gap-0.5">
                  <Server className="w-2.5 h-2.5" />
                  {selectedTunnel.node}
                </span>
              )}
            </span>
          </>
        ) : (
          <span className="flex-1">{placeholder}</span>
        )}
        <ChevronDown
          className={cn(
            "w-3.5 h-3.5 text-muted-foreground flex-shrink-0 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {/* 下拉面板 */}
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-popover shadow-lg overflow-hidden">
          {/* 搜索框 */}
          <div className="p-2 border-b border-border/50">
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/40">
              <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              <input
                ref={inputRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="输入关键词模糊搜索..."
                    className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
                  />
            </div>
          </div>

          {/* 隧道列表 */}
          <div className="max-h-60 overflow-y-auto visible-scrollbar">
            {filtered.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">
                {tunnels.length === 0 ? "暂无隧道数据" : "未找到匹配的隧道"}
              </div>
            ) : (
              filtered.map((tunnel) => {
                const isSelected = tunnel.name === value;
                return (
                  <button
                    key={tunnel.id}
                    type="button"
                    onClick={() => handleSelect(tunnel)}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent/50 transition-colors border-b border-border/30 last:border-0",
                      isSelected && "bg-primary/5",
                    )}
                  >
                    <Check
                      className={cn(
                        "w-3.5 h-3.5 flex-shrink-0",
                        isSelected ? "text-primary" : "text-transparent",
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      {/* 隧道名 + 高亮 */}
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-foreground truncate">
                          {highlightMatch(tunnel.name, query)}
                        </span>
                      </div>
                      {/* 节点 + 类型 + IP */}
                      <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                        {tunnel.type && (
                          <span className="flex items-center gap-0.5 px-1 py-0.5 rounded bg-muted/60 text-foreground/70 font-medium">
                            <Network className="w-2.5 h-2.5" />
                            {highlightMatch(tunnel.type.toUpperCase(), query)}
                          </span>
                        )}
                        {tunnel.node && (
                          <span className="flex items-center gap-0.5 truncate">
                            <Server className="w-2.5 h-2.5 flex-shrink-0" />
                            {highlightMatch(tunnel.node, query)}
                          </span>
                        )}
                        {tunnel.ip && (
                          <span className="flex items-center gap-0.5 truncate">
                            <Globe className="w-2.5 h-2.5 flex-shrink-0" />
                            {highlightMatch(tunnel.ip, query)}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* 节点状态指示 */}
                    <span
                      className={cn(
                        "w-1.5 h-1.5 rounded-full flex-shrink-0",
                        tunnel.nodestate?.toLowerCase() === "offline"
                          ? "bg-destructive"
                          : "bg-emerald-500",
                      )}
                    />
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
