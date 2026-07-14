import { useState, useCallback, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertCircle, CheckCircle2, Loader2, Info, AlertTriangle, Zap, Minimize2, SquareX } from "lucide-react";
import { speedTestService, type SpeedTestProgress, type LogEntry } from "@/services/speedTestService";

interface TestConfig {
  testLatency: boolean;
  testSpeed: boolean;
  speedTestSize: number;
}

interface NodeResult {
  nodeName: string;
  latency?: number;
  downloadSpeed?: number;
  error?: string;
  success: boolean;
}

export interface BatchTestState {
  isRunning: boolean;
  isStopping: boolean;
  config: TestConfig;
  nodeNames: string[];
  progress: {
    current: number;
    total: number;
    currentNodeName: string;
    stage: string;
    rawStage: string;
    nodeProgress?: number;
    nodeMessage?: string;
    overallPercent: number;
  } | null;
  results: NodeResult[];
  logs: LogEntry[];
}

let globalState: BatchTestState = {
  isRunning: false,
  isStopping: false,
  config: { testLatency: true, testSpeed: true, speedTestSize: 100 },
  nodeNames: [],
  progress: null,
  results: [],
  logs: [],
};

const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach(l => l());
}

export function subscribeBatchTestState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getBatchTestState(): BatchTestState {
  return globalState;
}

// 全局停止处理器：允许外部（如顶部停止按钮）触发 SpeedTestDialog 内部的停止逻辑
let globalStopHandler: (() => void) | null = null;
// 全局强制停止处理器：立即中断当前节点测试
let globalForceStopHandler: (() => void) | null = null;
// 全局取消停止处理器：取消软停止，继续测试
let globalCancelStopHandler: (() => void) | null = null;

export function requestStopBatchTest(): void {
  if (globalStopHandler) {
    globalStopHandler();
  }
}

export function requestForceStopBatchTest(): void {
  if (globalForceStopHandler) {
    globalForceStopHandler();
  }
}

export function requestCancelStopBatchTest(): void {
  if (globalCancelStopHandler) {
    globalCancelStopHandler();
  }
}

const stageProgress: Record<string, number> = {
  idle: 0,
  checking_frpc: 5,
  downloading_frpc: 15,
  starting_tcp_server: 30,
  creating_tunnel: 40,
  starting_frpc: 50,
  testing_latency: 70,
  testing_speed: 85,
  cleaning_up: 95,
  completed: 100,
  error: 0,
};

const stageLabels: Record<string, string> = {
  idle: "准备中",
  creating_tunnel: "创建隧道",
  starting_frpc: "启动frpc",
  connecting: "等待连接",
  testing_latency: "测试延迟",
  testing_speed: "测试速度",
  cleaning_up: "清理资源",
  completed: "完成",
  error: "错误",
};

function calcNodeOverallPercent(stage: string, nodeProgress?: number): number {
  const stageStart = stageProgress[stage as keyof typeof stageProgress] ?? 0;
  const stageKeys = Object.keys(stageProgress);
  const stageIndex = stageKeys.indexOf(stage);
  const nextStageStart = stageIndex < stageKeys.length - 1 ? stageProgress[stageKeys[stageIndex + 1] as keyof typeof stageProgress] : 100;
  const stageRange = nextStageStart - stageStart;
  if (nodeProgress != null && nodeProgress > 0) {
    return Math.min(100, stageStart + (nodeProgress / 100) * stageRange);
  }
  return stageStart;
}

function LogItem({ log }: { log: LogEntry }) {
  const getIcon = () => {
    switch (log.type) {
      case "success":
        return <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />;
      case "error":
        return <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />;
      case "warning":
        return <AlertTriangle className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0" />;
      default:
        return <Info className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />;
    }
  };

  const getTextColor = () => {
    switch (log.type) {
      case "success":
        return "text-green-600";
      case "error":
        return "text-red-600";
      case "warning":
        return "text-yellow-600";
      default:
        return "text-muted-foreground";
    }
  };

  return (
    <div className={`flex items-start gap-2 text-xs ${getTextColor()}`}>
      {getIcon()}
      <span className="break-all">{log.message}</span>
    </div>
  );
}

interface SpeedTestDialogProps {
  isOpen: boolean;
  onClose: (isMinimized?: boolean) => void;
  nodeNames: string[];
  onTestComplete?: (results: Map<string, { latency?: number; downloadSpeed?: number; error?: string }>) => void;
}

export function SpeedTestDialog({ isOpen, onClose, nodeNames, onTestComplete }: SpeedTestDialogProps) {
  const [config, setConfig] = useState<TestConfig>(globalState.config);
  const [isRunning, setIsRunning] = useState(false);
  const [speedTestSizeInput, setSpeedTestSizeInput] = useState<string>(config.speedTestSize.toString());
  const [progress, setProgress] = useState<BatchTestState["progress"]>(null);
  const [results, setResults] = useState<NodeResult[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const stopRef = useRef(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const onTestCompleteRef = useRef(onTestComplete);

  useEffect(() => {
    onTestCompleteRef.current = onTestComplete;
  }, [onTestComplete]);

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  useEffect(() => {
    if (isOpen) {
      // 打开对话框时，如果测试不在运行中，清除上次的日志和结果（全新开始）
      if (!globalState.isRunning) {
        globalState.logs = [];
        globalState.results = [];
        globalState.progress = null;
      }
      setProgress(globalState.progress);
      setResults(globalState.results);
      setLogs(globalState.logs);
      setIsRunning(globalState.isRunning);
      setConfig(globalState.config);
      stopRef.current = false;
      setIsStopping(false);
      setIsForceStopping(false);
      setIsMinimizing(false);
      setSpeedTestSizeInput(globalState.config.speedTestSize.toString());
    }
  }, [isOpen]);

  useEffect(() => {
    setSpeedTestSizeInput(config.speedTestSize.toString());
  }, [config.speedTestSize]);

  const addLog = useCallback((message: string, type: LogEntry["type"] = "info") => {
    const entry: LogEntry = { timestamp: Date.now(), message, type };
    globalState.logs = [...globalState.logs, entry];
    setLogs(globalState.logs);
    notifyListeners();
  }, []);

  const handleStartTest = useCallback(async () => {
    if (!config.testLatency && !config.testSpeed) {
      return;
    }

    globalState.config = config;
    globalState.isRunning = true;
    globalState.isStopping = false;
    globalState.results = [];
    globalState.logs = [];
    globalState.progress = null;
    notifyListeners();

    setIsRunning(true);
    setResults([]);
    setLogs([]);
    stopRef.current = false;
    setIsStopping(false);

    addLog(`开始测试，共 ${nodeNames.length} 个节点`, "info");
    addLog(`配置: 延迟测试=${config.testLatency ? "是" : "否"}, 速度测试=${config.testSpeed ? "是" : "否"}${config.testSpeed ? `, 大小=${config.speedTestSize}MB` : ""}`, "info");

    const newResults: NodeResult[] = [];
    const total = nodeNames.length;

    for (let i = 0; i < nodeNames.length; i++) {
      if (stopRef.current) {
        addLog("用户取消了测试", "warning");
        break;
      }

      const nodeName = nodeNames[i];
      const nodeOverallPct = calcNodeOverallPercent("idle");
      const overallPercent = ((i + nodeOverallPct / 100) / total) * 100;
      const nodeProgress = { current: i + 1, total, currentNodeName: nodeName, stage: "准备中", rawStage: "idle", overallPercent };
      globalState.progress = nodeProgress;
      setProgress(nodeProgress);
      notifyListeners();

      addLog(`[${i + 1}/${total}] 开始测试节点: ${nodeName}`, "info");

      try {
        const result = await speedTestService.runSpeedTest(
          nodeName,
          (p: SpeedTestProgress) => {
            const stageLabel = stageLabels[p.stage] || p.stage;
            const nodeOverallPct = calcNodeOverallPercent(p.stage, p.progress);
            const completedNodes = i;
            const overallPercent = ((completedNodes + nodeOverallPct / 100) / total) * 100;
            const progressData = {
              current: i + 1,
              total,
              currentNodeName: nodeName,
              stage: stageLabel,
              rawStage: p.stage,
              nodeProgress: p.progress,
              nodeMessage: p.message,
              overallPercent,
            };
            globalState.progress = progressData;
            setProgress(progressData);
            notifyListeners();
          },
          {
            testLatency: config.testLatency,
            testSpeed: config.testSpeed,
            speedTestSize: config.speedTestSize,
          }
        );

        if (result.success) {
          const nodeResult: NodeResult = {
            nodeName,
            latency: result.latency,
            downloadSpeed: result.downloadSpeed,
            success: true,
          };
          newResults.push(nodeResult);

          const latencyStr = result.latency != null ? `${result.latency.toFixed(0)}ms` : "-";
          const speedStr = result.downloadSpeed != null ? `${result.downloadSpeed.toFixed(2)}Mbps` : "-";
          addLog(`[${i + 1}/${total}] ${nodeName} 完成 - 延迟: ${latencyStr}, 速度: ${speedStr}`, "success");
        } else {
          const nodeResult: NodeResult = {
            nodeName,
            error: result.error,
            success: false,
          };
          newResults.push(nodeResult);
          addLog(`[${i + 1}/${total}] ${nodeName} 失败: ${result.error}`, "error");
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "测试失败";
        const nodeResult: NodeResult = {
          nodeName,
          error: errorMsg,
          success: false,
        };
        newResults.push(nodeResult);
        addLog(`[${i + 1}/${total}] ${nodeName} 异常: ${errorMsg}`, "error");
      }

      globalState.results = [...newResults];
      setResults([...newResults]);
      notifyListeners();
    }

    globalState.isRunning = false;
    globalState.isStopping = false;
    globalState.progress = null;
    setIsRunning(false);
    setProgress(null);
    setIsStopping(false);
    setIsForceStopping(false);
    notifyListeners();

    if (onTestCompleteRef.current) {
      const resultMap = new Map<string, { latency?: number; downloadSpeed?: number; error?: string }>();
      newResults.forEach(r => {
        resultMap.set(r.nodeName, {
          latency: r.latency,
          downloadSpeed: r.downloadSpeed,
          error: r.error,
        });
      });
      onTestCompleteRef.current(resultMap);
    }

    const successCount = newResults.filter(r => r.success).length;
    if (stopRef.current) {
      addLog(`测试已停止: 已完成 ${newResults.length}/${total} 个节点，${successCount} 成功`, "warning");
    } else {
      addLog(`测试完成: ${successCount}/${total} 成功`, successCount === total ? "success" : "warning");
    }
  }, [nodeNames, config, addLog]);

  const [isMinimizing, setIsMinimizing] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const isMinimizingRef = useRef(false);
  const [isForceStopping, setIsForceStopping] = useState(false);

  const handleStop = useCallback(() => {
    if (stopRef.current) return; // 防止重复点击
    // 只设置停止标志，不立即中断当前节点测试
    // 当前节点测试完成后，循环将不再开始下一个节点的测试
    stopRef.current = true;
    setIsStopping(true);
    globalState.isStopping = true;
    notifyListeners();
    addLog("将在当前节点测试完成后停止", "warning");
  }, [addLog]);

  const handleCancelStop = useCallback(() => {
    stopRef.current = false;
    setIsStopping(false);
    globalState.isStopping = false;
    notifyListeners();
    addLog("已取消停止，继续测试", "info");
  }, [addLog]);

  const handleForceStop = useCallback(() => {
    // 强制停止：立即中断当前节点测试
    stopRef.current = true;
    setIsStopping(true);
    setIsForceStopping(true);
    globalState.isStopping = true;
    notifyListeners();
    // 调用 speedTestService.cancel() 触发 abortController，中断当前正在进行的测试
    speedTestService.cancel();
    addLog("正在强制停止测试...", "warning");
  }, [addLog]);

  // 注册全局停止处理器，供外部（如顶部停止按钮）调用
  useEffect(() => {
    globalStopHandler = handleStop;
    return () => { globalStopHandler = null; };
  }, [handleStop]);

  // 注册全局强制停止处理器
  useEffect(() => {
    globalForceStopHandler = handleForceStop;
    return () => { globalForceStopHandler = null; };
  }, [handleForceStop]);

  // 注册全局取消停止处理器
  useEffect(() => {
    globalCancelStopHandler = handleCancelStop;
    return () => { globalCancelStopHandler = null; };
  }, [handleCancelStop]);

  const handleClose = useCallback(() => {
    if (isRunning) {
      // 运行中点击：触发停止（等当前节点完成），不关闭对话框
      handleStop();
      return;
    }
    // 非运行状态：清除日志后关闭
    globalState.logs = [];
    setLogs([]);
    onClose();
  }, [isRunning, handleStop, onClose]);

  useEffect(() => {
    isMinimizingRef.current = isMinimizing;
  }, [isMinimizing]);

  const handleMinimize = useCallback(() => {
    isMinimizingRef.current = true;
    setIsMinimizing(true);
    onClose(true);
  }, [onClose]);

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open && !isMinimizingRef.current) {
      handleClose();
    }
    if (open) {
      setIsMinimizing(false);
    }
  }, [handleClose]);

  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;

  const renderConfigPanel = () => (
    <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
      <div className="space-y-3">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="testLatency"
            checked={config.testLatency}
            onCheckedChange={(checked) =>
              setConfig(prev => ({ ...prev, testLatency: !!checked }))
            }
          />
          <label htmlFor="testLatency" className="text-sm cursor-pointer">
            测试延迟
          </label>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id="testSpeed"
            checked={config.testSpeed}
            onCheckedChange={(checked) =>
              setConfig(prev => ({ ...prev, testSpeed: !!checked }))
            }
          />
          <label htmlFor="testSpeed" className="text-sm cursor-pointer">
            测试下载速度
          </label>
        </div>

        {config.testSpeed && (
          <div className="flex items-center gap-2 pl-6">
            <label className="text-sm text-muted-foreground whitespace-nowrap">
              测试大小:
            </label>
            <Input
              type="number"
              min={1}
              max={100000}
              value={speedTestSizeInput}
              onChange={(e) =>
                setSpeedTestSizeInput(e.target.value)
              }
              onBlur={(e) => {
                const value = e.target.value;
                const parsedValue = value === "" ? 100 : parseInt(value) || 100;
                const finalValue = Math.max(1, Math.min(100000, parsedValue));
                setConfig(prev => ({ ...prev, speedTestSize: finalValue }));
                setSpeedTestSizeInput(finalValue.toString());
              }}
              className="w-20 h-8"
            />
            <span className="text-sm text-muted-foreground">MB</span>
          </div>
        )}
      </div>

      <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg">
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-blue-700 dark:text-blue-300">
            <p className="font-medium mb-1">测试说明</p>
            <p>• 仅测试延迟：直连节点7000端口，无需隧道配额</p>
            <p>• 包含速度测试：需要创建隧道，请确保至少有1个空闲配额</p>
            <p className="mt-1">测试将逐个节点进行，每个节点会用时15-30秒，具体时间取决于本机环境和节点质量。</p>
          </div>
        </div>
      </div>
    </div>
  );

  const renderBatchRunning = () => {
    const overallProgress = progress!.overallPercent;

    return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
          <span className="text-sm font-medium">
            正在测试 ({progress!.current}/{progress!.total})
          </span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleMinimize}
          className="h-7 px-2"
        >
          <Minimize2 className="w-3.5 h-3.5 mr-1" />
          最小化
        </Button>
      </div>

      <div className="p-3 bg-muted/50 rounded-lg space-y-2">
        <div className="text-sm font-medium truncate">{progress!.currentNodeName}</div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{progress!.stage}</span>
          {progress!.nodeMessage && (
            <>
              <span>-</span>
              <span>{progress!.nodeMessage}</span>
            </>
          )}
        </div>
        {progress!.nodeProgress != null && progress!.nodeProgress > 0 && (
          <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-blue-500 h-full rounded-full transition-all duration-200"
              style={{ width: `${progress!.nodeProgress}%` }}
            />
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>总体进度</span>
          <span>{progress!.current}/{progress!.total} ({overallProgress.toFixed(1)}%)</span>
        </div>
        <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
          <div
            className="bg-primary h-full rounded-full transition-all duration-300 ease-out"
            style={{ width: `${overallProgress}%` }}
          />
        </div>
      </div>
    </div>
  );
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5" />
            {nodeNames.length === 1 ? "节点测试" : "批量测试"}
          </DialogTitle>
          <DialogDescription>
            {nodeNames.length === 1 ? `节点: ${nodeNames[0]}` : `共 ${nodeNames.length} 个节点`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto flex flex-col gap-4 visible-scrollbar">
          {!isRunning && results.length === 0 && renderConfigPanel()}

          {isRunning && progress && renderBatchRunning()}

          {logs.length > 0 && (
            <div className="border rounded-lg p-3 bg-muted/30 max-h-40 overflow-y-auto flex-shrink-0 visible-scrollbar">
              <div className="text-xs font-medium text-muted-foreground mb-2">
                日志 ({logs.length}){!isRunning && ` - 成功: ${successCount}, 失败: ${failCount}`}
              </div>
              <div className="space-y-1.5">
                {logs.map((log, index) => (
                  <LogItem key={index} log={log} />
                ))}
                <div ref={logsEndRef} />
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
          {isRunning && isStopping ? (
            <>
              <Button variant="outline" onClick={handleCancelStop} disabled={isForceStopping}>
                取消停止
              </Button>
              <Button variant="destructive" onClick={handleForceStop} disabled={isForceStopping}>
                {isForceStopping ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                    正在停止...
                  </>
                ) : (
                  <>
                    <SquareX className="w-4 h-4 mr-1.5" />
                    强制停止
                  </>
                )}
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={handleClose} disabled={isStopping}>
              {isRunning ? "停止" : "关闭"}
            </Button>
          )}
          {!isRunning && results.length === 0 && (
            <Button
              onClick={handleStartTest}
              disabled={!config.testLatency && !config.testSpeed}
            >
              <Zap className="w-4 h-4 mr-1.5" />
              开始测试
            </Button>
          )}
          {!isRunning && results.length > 0 && (
            <Button onClick={handleStartTest}>
              重新测试
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
