import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
  EmptyContent,
} from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Network, RefreshCw, CheckCircle2, XCircle, Clock, Filter, History, Globe, Users, ArrowUpDown, ArrowUp, ArrowDown, Search, CheckSquare, Square, SquareX, Download, Zap, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { fetchNodes, type Node, type StoredUser } from "@/services/api";
import { getInitialEffectType, type EffectType } from "@/lib/settings-utils";
import { SpeedTestDialog, getBatchTestState, subscribeBatchTestState, requestStopBatchTest, requestForceStopBatchTest, requestCancelStopBatchTest } from "@/components/dialogs/BatchSpeedTestDialog";
import { BatchTestFloatingWidget } from "@/components/dialogs/BatchTestFloatingWidget";
import { NodeHistoryDialog } from "@/components/dialogs/NodeHistoryDialog";
import { addTestHistory } from "@/services/testHistoryService";

interface NodeTestProps {
  user: StoredUser | null;
  onTestingChange?: (testing: boolean) => void;
}

interface NodeWithTest extends Node {
  testStatus?: "idle" | "testing" | "success" | "failed";
  latency?: number;
  downloadSpeed?: number;
  error?: string;
  lastTested?: number;
}

interface SavedTestResult {
  id: number;
  testStatus: "idle" | "testing" | "success" | "failed";
  latency?: number;
  downloadSpeed?: number;
  error?: string;
  lastTested?: number;
}

interface TestHistory {
  id: string;
  nodeId: number;
  nodeName: string;
  area: string;
  nodegroup: string;
  china: string;
  success: boolean;
  latency?: number;
  error?: string;
  timestamp: number;
}

type UserTypeFilter = "all" | "vip" | "normal";
type RegionFilter = "all" | "domestic" | "foreign";

const regionOptions = [
  { value: "all", label: "全部" },
  { value: "domestic", label: "国内" },
  { value: "foreign", label: "国外" },
];

const userTypeOptions = [
  { value: "all", label: "全部" },
  { value: "vip", label: "VIP" },
  { value: "normal", label: "普通" },
];

export function NodeTest({ user, onTestingChange }: NodeTestProps) {
  // 初始化时尝试从缓存加载节点列表，避免切换页面回来时短暂空白
  const [nodes, setNodes] = useState<NodeWithTest[]>(() => {
    try {
      const cachedNodes = localStorage.getItem("node_list_cache");
      const savedResults = localStorage.getItem("node_test_results");
      if (cachedNodes && savedResults) {
        const parsedNodes = JSON.parse(cachedNodes) as Node[];
        const parsedResults: SavedTestResult[] = JSON.parse(savedResults);
        const resultsMap = new Map<number, SavedTestResult>(parsedResults.map((r) => [r.id, r]));
        return parsedNodes.map((node) => {
          const savedResult = resultsMap.get(node.id);
          if (savedResult) {
            return {
              ...node,
              testStatus: savedResult.testStatus,
              latency: savedResult.latency,
              downloadSpeed: savedResult.downloadSpeed,
              error: savedResult.error,
              lastTested: savedResult.lastTested,
            };
          }
          return { ...node, testStatus: "idle" as const };
        });
      }
    } catch {
      // 缓存解析失败，返回空数组
    }
    return [];
  });
  const [loading, setLoading] = useState(false);
  const [testingAll, setTestingAll] = useState(false);
  const [testHistory, setTestHistory] = useState<TestHistory[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [userTypeFilter, setUserTypeFilter] = useState<UserTypeFilter>("all");
  const [regionFilter, setRegionFilter] = useState<RegionFilter>("all");
  const [effectType, setEffectType] = useState<EffectType>(() =>
    getInitialEffectType(),
  );
  const [sortField, setSortField] = useState<string | null>("id");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<number>>(new Set());
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [batchTestNodes, setBatchTestNodes] = useState<NodeWithTest[] | null>(null);
  const [showBatchTestDialog, setShowBatchTestDialog] = useState(false);
  const [historyNode, setHistoryNode] = useState<{ node: NodeWithTest; type: "latency" | "speed" } | null>(null);
  // 批量测试是否处于软停止中（用于顶栏显示"取消停止"和"强制停止"按钮）
  const [isBatchStopping, setIsBatchStopping] = useState(false);

  // 使用 ref 保存最新的 testingAll 值，避免订阅频繁取消和重注册导致丢失通知
  const testingAllRef = useRef(testingAll);
  useEffect(() => {
    testingAllRef.current = testingAll;
  }, [testingAll]);

  useEffect(() => {
    return subscribeBatchTestState(() => {
      const state = getBatchTestState();
      // 测试开始时同步 testingAll 为 true，让顶部显示"测试中..."和"停止"按钮
      if (state.isRunning && !testingAllRef.current) {
        setTestingAll(true);
      }
      // 测试结束时同步 testingAll 为 false
      if (!state.isRunning && testingAllRef.current) {
        setTestingAll(false);
      }
      // 同步软停止状态
      setIsBatchStopping(state.isStopping);
    });
  }, []);

  const saveTestResults = useCallback((nodesToSave: NodeWithTest[]) => {
    const results = nodesToSave
      .filter((n) => n.testStatus !== "idle")
      .map((n) => ({
        id: n.id,
        testStatus: n.testStatus,
        latency: n.latency,
        downloadSpeed: n.downloadSpeed,
        error: n.error,
        lastTested: n.lastTested,
      }));
    localStorage.setItem("node_test_results", JSON.stringify(results));
  }, []);

  const loadTestResults = useCallback((): SavedTestResult[] => {
    const saved = localStorage.getItem("node_test_results");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return [];
      }
    }
    return [];
  }, []);

  useEffect(() => {
    const handleEffectTypeChange = () => {
      const stored = localStorage.getItem("effectType");
      if (
        stored === "frosted" ||
        stored === "translucent" ||
        stored === "none"
      ) {
        setEffectType(stored);
      }
    };

    window.addEventListener("effectTypeChanged", handleEffectTypeChange);
    return () => {
      window.removeEventListener("effectTypeChanged", handleEffectTypeChange);
    };
  }, []);

  const loadNodes = useCallback(async () => {
    if (!user) return;

    try {
      setLoading(true);
      const fetchedNodes = await fetchNodes();
      const savedResults = loadTestResults();
      const resultsMap = new Map<number, SavedTestResult>(savedResults.map((r) => [r.id, r]));

      const nodesWithResults: NodeWithTest[] = fetchedNodes.map((node) => {
        const savedResult = resultsMap.get(node.id);
        if (savedResult) {
          return {
            ...node,
            testStatus: savedResult.testStatus,
            latency: savedResult.latency,
            downloadSpeed: savedResult.downloadSpeed,
            error: savedResult.error,
            lastTested: savedResult.lastTested,
          };
        }
        return { ...node, testStatus: "idle" as const };
      });

      setNodes(nodesWithResults);
      // 缓存节点列表，用于 API 请求失败时恢复
      localStorage.setItem("node_list_cache", JSON.stringify(fetchedNodes));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "获取节点列表失败";
      // API 请求失败时，尝试从缓存恢复节点列表和测试结果
      const cachedNodes = localStorage.getItem("node_list_cache");
      if (cachedNodes) {
        try {
          const parsedNodes = JSON.parse(cachedNodes) as Node[];
          const savedResults = loadTestResults();
          const resultsMap = new Map<number, SavedTestResult>(savedResults.map((r) => [r.id, r]));

          const nodesWithResults: NodeWithTest[] = parsedNodes.map((node) => {
            const savedResult = resultsMap.get(node.id);
            if (savedResult) {
              return {
                ...node,
                testStatus: savedResult.testStatus,
                latency: savedResult.latency,
                downloadSpeed: savedResult.downloadSpeed,
                error: savedResult.error,
                lastTested: savedResult.lastTested,
              };
            }
            return { ...node, testStatus: "idle" as const };
          });

          setNodes(nodesWithResults);
          toast.warning("网络请求失败，已加载缓存的节点数据");
        } catch {
          toast.error(message);
        }
      } else {
        toast.error(message);
      }
    } finally {
      setLoading(false);
    }
  }, [user, loadTestResults]);

  const loadHistory = useCallback(() => {
    setHistoryLoading(true);
    const saved = localStorage.getItem("node_test_history");
    if (saved) {
      try {
        setTestHistory(JSON.parse(saved));
      } catch {
        setTestHistory([]);
      }
    }
    setHistoryLoading(false);
  }, []);

  const nodesRef = useRef(nodes);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    onTestingChange?.(testingAll);
  }, [testingAll, onTestingChange]);

  useEffect(() => {
    return () => {
      // 组件卸载时保存测试结果，但仅在已有节点数据时才保存，避免覆盖之前的数据
      if (nodesRef.current.length > 0) {
        saveTestResults(nodesRef.current);
      }
    };
  }, [saveTestResults]);

  const stopTesting = useCallback(() => {
    // 通过全局停止处理器通知 SpeedTestDialog 停止测试
    // SpeedTestDialog 会在当前节点测试完成后停止，不立即中断
    requestStopBatchTest();
    toast.info("将在当前节点测试完成后停止");
  }, []);

  const forceStopTesting = useCallback(() => {
    // 强制停止：立即中断当前节点测试
    requestForceStopBatchTest();
    toast.warning("正在强制停止测试...");
  }, []);

  const cancelStopTesting = useCallback(() => {
    // 取消软停止，继续测试
    requestCancelStopBatchTest();
    toast.info("已取消停止，继续测试");
  }, []);

  useEffect(() => {
    if (user) {
      void loadNodes();
      loadHistory();
    }
  }, [user, loadNodes, loadHistory]);

  const handleSort = useCallback((field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  }, [sortField, sortDirection]);

  const toggleSelectNode = useCallback((nodeId: number) => {
    setSelectedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  const highlightText = useCallback((text: string, query: string) => {
    if (!query) return text;
    const parts = text.split(new RegExp(`(${query})`, "gi"));
    return (
      <>
        {parts.map((part, i) =>
          part.toLowerCase() === query.toLowerCase() ? (
            <span key={i} className="bg-yellow-200 dark:bg-yellow-800 rounded px-0.5">
              {part}
            </span>
          ) : (
            <span key={i}>{part}</span>
          ),
        )}
      </>
    );
  }, []);

  const filteredNodes = useMemo(() => {
    let result = nodes.filter((node) => {
      let matchesSearch = true;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        matchesSearch =
          node.name.toLowerCase().includes(q) ||
          node.area.toLowerCase().includes(q) ||
          node.nodegroup.toLowerCase().includes(q);
      }
      
      let matchesRegion = true;
      if (regionFilter === "domestic") {
        matchesRegion = node.china === "yes";
      } else if (regionFilter === "foreign") {
        matchesRegion = node.china === "no";
      }
      
      let matchesUserType = true;
      if (userTypeFilter === "vip") {
        matchesUserType = node.nodegroup === "vip";
      } else if (userTypeFilter === "normal") {
        matchesUserType = node.nodegroup !== "vip";
      }
      
      return matchesSearch && matchesRegion && matchesUserType;
    });
    
    if (sortField) {
  result = [...result].sort((a, b) => {
    if (sortField === "id") {
      return sortDirection === "asc" ? a.id - b.id : b.id - a.id;
    } else if (sortField === "latency") {
      const aLatency = a.latency ?? Infinity;
      const bLatency = b.latency ?? Infinity;
      return sortDirection === "asc" ? aLatency - bLatency : bLatency - aLatency;
    } else if (sortField === "downloadSpeed") {
      const aSpeed = a.downloadSpeed ?? (sortDirection === "asc" ? Infinity : -1);
      const bSpeed = b.downloadSpeed ?? (sortDirection === "asc" ? Infinity : -1);
      return sortDirection === "asc" ? aSpeed - bSpeed : bSpeed - aSpeed;
    }
    return 0;
  });
}
    
    return result;
  }, [nodes, regionFilter, userTypeFilter, sortField, sortDirection, searchQuery]);

  // 计算当前可见节点中的选中数量
  const visibleSelectedCount = useMemo(() => {
    return filteredNodes.filter(n => selectedNodeIds.has(n.id)).length;
  }, [filteredNodes, selectedNodeIds]);

  const toggleSelectAll = useCallback(() => {
    if (visibleSelectedCount === filteredNodes.length) {
      setSelectedNodeIds(new Set());
    } else {
      setSelectedNodeIds(new Set(filteredNodes.map((n) => n.id)));
    }
  }, [filteredNodes, visibleSelectedCount]);

  const handleRowClick = useCallback(
    (e: React.MouseEvent, nodeId: number, index: number) => {
      if (e.shiftKey && lastClickedIndex !== null) {
        const start = Math.min(lastClickedIndex, index);
        const end = Math.max(lastClickedIndex, index);
        const rangeIds = filteredNodes.slice(start, end + 1).map((n) => n.id);
        setSelectedNodeIds(new Set(rangeIds));
      } else {
        toggleSelectNode(nodeId);
      }
      setLastClickedIndex(index);
    },
    [filteredNodes, lastClickedIndex, toggleSelectNode],
  );

  const filteredHistory = useMemo(() => {
    return testHistory.filter((record) => {
      const matchesRegion = regionFilter === "all" || 
        (regionFilter === "domestic" && record.china === "yes") ||
        (regionFilter === "foreign" && record.china === "no");
      
      return matchesRegion;
    }).sort((a, b) => b.timestamp - a.timestamp);
  }, [testHistory, regionFilter, userTypeFilter]);

  const openBatchSpeedTestWithNodes = useCallback(() => {
    const nodesToTest = visibleSelectedCount > 0 
      ? filteredNodes.filter((n) => selectedNodeIds.has(n.id))
      : filteredNodes;
    
    if (nodesToTest.length === 0) {
      toast.error("没有可测试的节点");
      return;
    }
    
    setBatchTestNodes(nodesToTest);
    setShowBatchTestDialog(true);
  }, [filteredNodes, selectedNodeIds, visibleSelectedCount]);

  const getStatusBadge = (node: NodeWithTest) => {
    switch (node.testStatus) {
      case "testing":
        return (
          <Badge variant="outline" className="flex items-center gap-1">
            <RefreshCw className="w-3 h-3 animate-spin" />
            测试中
          </Badge>
        );
      case "success":
        return (
          <Badge className="bg-green-500/20 text-green-600 hover:bg-green-500/30 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            成功
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="destructive" className="flex items-center gap-1">
            <XCircle className="w-3 h-3" />
            失败
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="text-muted-foreground">
            未测试
          </Badge>
        );
    }
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString("zh-CN");
  };

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-medium text-foreground">节点测试</h1>
          {!loading && filteredNodes.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {filteredNodes.length} 个节点
            </span>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowHistory(!showHistory)}
            className="h-8 px-3 text-xs"
          >
            <History className="h-3.5 w-3.5 mr-1.5" />
            {showHistory ? "返回列表" : "测试历史"}
          </Button>
          <Button
            size="sm"
            onClick={() => void loadNodes()}
            disabled={loading}
            className="h-8 px-3 text-xs"
          >
            {loading ? (
              <>
                <RefreshCw className="animate-spin h-3.5 w-3.5 mr-1.5" />
                加载中...
              </>
            ) : (
              <>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                刷新列表
              </>
            )}
          </Button>
          {!showHistory && (
            testingAll ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowBatchTestDialog(true)}
                  className="h-8 px-3 text-xs"
                >
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  测试中...
                </Button>
                {isBatchStopping ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={cancelStopTesting}
                      className="h-8 px-3 text-xs"
                    >
                      取消停止
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={forceStopTesting}
                      className="h-8 px-3 text-xs"
                    >
                      <SquareX className="h-3.5 w-3.5 mr-1.5" />
                      强制停止
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={stopTesting}
                    className="h-8 px-3 text-xs"
                  >
                    <SquareX className="h-3.5 w-3.5 mr-1.5" />
                    停止
                  </Button>
                )}
              </>
            ) : (
              <Button
                size="sm"
                onClick={openBatchSpeedTestWithNodes}
                disabled={loading || (visibleSelectedCount === 0 && filteredNodes.length === 0)}
                className="h-8 px-3 text-xs"
              >
                <Zap className="h-3.5 w-3.5 mr-1.5" />
                {visibleSelectedCount > 0 ? `节点测试 (${visibleSelectedCount})` : "全部测试"}
              </Button>
            )
          )}
        </div>
      </div>

      <div className={cn(
        "flex flex-wrap items-center gap-4 rounded-lg border bg-card px-3 py-2",
        effectType === "frosted" && "backdrop-blur-md",
        effectType === "translucent" && "bg-card/80",
      )}>
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索节点名称、区域、节点组..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 bg-transparent"
          />
          {searchQuery && (
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {filteredNodes.length} 结果
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">筛选：</span>
        </div>
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-muted-foreground" />
          <Select
            options={regionOptions}
            value={regionFilter}
            onChange={(v) => setRegionFilter(v as RegionFilter)}
            placeholder="地域"
            size="sm"
            className="w-[120px]"
          />
        </div>
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <Select
            options={userTypeOptions}
            value={userTypeFilter}
            onChange={(v) => setUserTypeFilter(v as UserTypeFilter)}
            placeholder="用户类型"
            size="sm"
            className="w-[120px]"
          />
        </div>
      </div>

      {!user ? (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Network className="size-6" />
            </EmptyMedia>
            <EmptyTitle>请先登录</EmptyTitle>
            <EmptyDescription>
              登录后才能查看和测试节点
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : loading ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          加载中...
        </div>
      ) : showHistory ? (
        <div className={cn(
          "flex-1 min-h-0 rounded-md border bg-card overflow-y-auto visible-scrollbar",
          effectType === "frosted" && "backdrop-blur-md bg-card/80",
          effectType === "translucent" && "bg-card/80",
        )}>
          {historyLoading ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              加载中...
            </div>
          ) : filteredHistory.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <History className="size-6" />
                </EmptyMedia>
                <EmptyTitle>暂无测试记录</EmptyTitle>
                <EmptyDescription>
                  还没有进行过节点测试
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table className="w-full">
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[48px] w-12">状态</TableHead>
                  <TableHead className="min-w-[80px] max-w-[180px]">节点名称</TableHead>
                  <TableHead className="min-w-[60px] max-w-[140px]">区域</TableHead>
                  <TableHead className="min-w-[60px]">延迟</TableHead>
                  <TableHead className="min-w-[120px]">时间</TableHead>
                  <TableHead className="min-w-[60px]">错误</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredHistory.map((record) => (
                  <TableRow key={`${record.id}-${record.timestamp}`}>
                    <TableCell>
                      {record.success ? (
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-500" />
                      )}
                    </TableCell>
                    <TableCell className="font-medium min-w-[80px] max-w-[180px]">
                      <span className="block truncate" title={record.nodeName}>{record.nodeName}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground min-w-[60px] max-w-[140px]">
                      <span className="block truncate">{record.area}</span>
                    </TableCell>
                    <TableCell>
                      {record.latency != null ? (
                        <span className={record.latency < 100 ? "text-green-600" : record.latency < 300 ? "text-yellow-600" : "text-red-600"}>
                          {record.latency.toFixed(0)}ms
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                      {formatTime(record.timestamp)}
                    </TableCell>
                    <TableCell className="text-destructive text-xs max-w-[200px]">
                      {record.error ? (
                        <span className="block truncate" title={record.error}>{record.error}</span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      ) : filteredNodes.length === 0 ? (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Network className="size-6" />
            </EmptyMedia>
            <EmptyTitle>暂无节点</EmptyTitle>
            <EmptyDescription>
              未找到可用的节点，请稍后再试
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadNodes()}
            >
              刷新
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="flex-1 min-h-0">
          <div className={cn(
            "h-full max-h-full rounded-md border bg-card overflow-x-auto overflow-y-auto visible-scrollbar",
            effectType === "frosted" && "backdrop-blur-md bg-card/80",
            effectType === "translucent" && "bg-card/80",
          )}>
            <Table className="w-full">
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[48px] w-12">
                    <button
                      onClick={toggleSelectAll}
                      className="flex items-center justify-center"
                    >
                      {selectedNodeIds.size === filteredNodes.length && filteredNodes.length > 0 ? (
                        <CheckSquare className="w-4 h-4" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                    </button>
                  </TableHead>
                  <TableHead className="min-w-[64px] w-16">
                    <button
                      onClick={() => handleSort("id")}
                      className="flex items-center gap-1 hover:text-foreground transition-colors"
                    >
                      编号
                      {sortField === "id" ? (
                        sortDirection === "asc" ? (
                          <ArrowUp className="w-3 h-3" />
                        ) : (
                          <ArrowDown className="w-3 h-3" />
                        )
                      ) : (
                        <ArrowUpDown className="w-3 h-3 opacity-50" />
                      )}
                    </button>
                  </TableHead>
                  <TableHead className="min-w-[80px] max-w-[180px]">节点名称</TableHead>
                  <TableHead className="min-w-[60px] max-w-[140px]">区域</TableHead>
                  <TableHead className="min-w-[80px] w-20">节点组</TableHead>
                  <TableHead className="min-w-[80px] w-20">地域</TableHead>
                  <TableHead className="min-w-[96px] w-24">状态</TableHead>
                  <TableHead className="min-w-[60px]">
                    <button
                      onClick={() => handleSort("latency")}
                      className="flex items-center gap-1 hover:text-foreground transition-colors"
                    >
                      延迟
                      {sortField === "latency" ? (
                        sortDirection === "asc" ? (
                          <ArrowUp className="w-3 h-3" />
                        ) : (
                          <ArrowDown className="w-3 h-3" />
                        )
                      ) : (
                        <ArrowUpDown className="w-3 h-3 opacity-50" />
                      )}
                    </button>
        </TableHead>
        <TableHead>
          <button
            onClick={() => handleSort("downloadSpeed")}
            className="flex items-center gap-1 hover:text-foreground transition-colors"
          >
            带宽速度
            {sortField === "downloadSpeed" ? (
              sortDirection === "asc" ? (
                <ArrowUp className="w-3 h-3" />
              ) : (
                <ArrowDown className="w-3 h-3" />
              )
            ) : (
              <ArrowUpDown className="w-3 h-3 opacity-50" />
            )}
          </button>
        </TableHead>
        {/* 操作列已注释：节点右侧测试按钮与顶部测试组件存在显示差异，暂时隐藏
        <TableHead className="text-right">操作</TableHead>
        */}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredNodes.map((node, index) => (
                  <TableRow 
                    key={node.id} 
                    className={cn(selectedNodeIds.has(node.id) && "bg-accent/50")}
                  >
                    <TableCell className="min-w-[48px] w-12">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRowClick(e, node.id, index);
                        }}
                        className="flex items-center justify-center"
                      >
                        {selectedNodeIds.has(node.id) ? (
                          <CheckSquare className="w-4 h-4" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                    </TableCell>
                    <TableCell className="min-w-[64px] text-muted-foreground">{node.id}</TableCell>
                    <TableCell className="font-medium min-w-[80px] max-w-[180px]">
                      <span className="block truncate" title={node.name}>{highlightText(node.name, searchQuery)}</span>
                    </TableCell>
                    <TableCell className="min-w-[60px] max-w-[140px]">
                      <span className="block truncate" title={node.area}>{highlightText(node.area, searchQuery)}</span>
                    </TableCell>
                    <TableCell className="min-w-[80px]">
                      <Badge variant={node.nodegroup === "vip" ? "default" : "outline"} className="text-xs">
                        {node.nodegroup === "vip" ? "VIP" : "普通"}
                      </Badge>
                    </TableCell>
                    <TableCell className="min-w-[80px]">
                      <Badge variant="outline" className="text-xs">
                        {node.china === "yes" ? "国内" : "国外"}
                      </Badge>
                    </TableCell>
                    <TableCell className="min-w-[96px]">{getStatusBadge(node)}</TableCell>
                    <TableCell className="min-w-[60px]">
                      {node.latency != null ? (
                        <span 
                          className="flex items-center gap-1 cursor-pointer hover:text-primary transition-colors"
                          onClick={() => setHistoryNode({ node, type: "latency" })}
                          title="点击查看延迟历史"
                        >
                          <Clock className="w-3 h-3 text-muted-foreground" />
                          {node.latency.toFixed(0)}ms
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {node.downloadSpeed != null ? (
                        <span 
                          className="flex items-center gap-1 cursor-pointer hover:text-primary transition-colors"
                          onClick={() => setHistoryNode({ node, type: "speed" })}
                          title="点击查看速度历史"
                        >
                          <Download className="w-3 h-3 text-muted-foreground" />
                          {node.downloadSpeed >= 1000
                            ? `${(node.downloadSpeed / 1000).toFixed(1)} Gbps`
                            : `${node.downloadSpeed.toFixed(0)} Mbps`}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    {/* 节点右侧测试按钮已注释：与顶部测试组件存在显示差异（条形图/折线图不显示），暂时隐藏
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setBatchTestNodes([node]);
                          setShowBatchTestDialog(true);
                        }}
                        disabled={node.testStatus === "testing"}
                        className="h-7 px-2 text-xs"
                        title="速度测试"
                      >
                        <Gauge className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                    */}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <SpeedTestDialog
        isOpen={showBatchTestDialog && batchTestNodes !== null}
        onClose={(isMinimized?: boolean) => {
          setShowBatchTestDialog(false);
          if (!isMinimized) {
            setBatchTestNodes(null);
          }
        }}
        nodeNames={batchTestNodes?.map(n => n.name) || []}
        onTestComplete={(results) => {
          let updatedNodes = [...nodesRef.current];
          let hasFailure = false;
          results.forEach((result, nodeName) => {
            const nodeIndex = updatedNodes.findIndex(n => n.name === nodeName);
            if (nodeIndex !== -1) {
              const node = updatedNodes[nodeIndex];
              // 合并新旧测试结果：仅更新本次测试包含的字段，保留上次测试的另一项结果
              const mergedLatency = result.latency ?? node.latency;
              const mergedSpeed = result.downloadSpeed ?? node.downloadSpeed;
              addTestHistory({
                nodeName: node.name,
                nodeId: node.id,
                timestamp: Date.now(),
                latency: mergedLatency,
                downloadSpeed: mergedSpeed,
                success: !result.error,
                error: result.error,
              });
              updatedNodes[nodeIndex] = {
                ...node,
                testStatus: result.error ? "failed" as const : "success" as const,
                latency: mergedLatency,
                downloadSpeed: mergedSpeed,
                error: result.error,
                lastTested: Date.now(),
              };
              if (result.error) hasFailure = true;
            }
          });
          setNodes(updatedNodes);
          saveTestResults(updatedNodes);
          // 测试有失败时不关闭弹窗，让用户看完日志
          if (!hasFailure) {
            setBatchTestNodes(null);
          }
        }}
      />

      <BatchTestFloatingWidget 
        onExpand={() => setShowBatchTestDialog(true)} 
        isDialogOpen={showBatchTestDialog && batchTestNodes !== null}
      />

      <NodeHistoryDialog
        isOpen={historyNode !== null}
        onClose={() => setHistoryNode(null)}
        nodeName={historyNode?.node.name || ""}
        nodeId={historyNode?.node.id || 0}
        type={historyNode?.type || "latency"}
      />
    </div>
  );
}
