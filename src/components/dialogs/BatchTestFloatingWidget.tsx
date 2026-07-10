import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Maximize2, Loader2, GripVertical } from "lucide-react";
import { getBatchTestState, subscribeBatchTestState, type BatchTestState } from "./BatchSpeedTestDialog";

interface BatchTestFloatingWidgetProps {
  onExpand: () => void;
  isDialogOpen: boolean;
}

export function BatchTestFloatingWidget({ onExpand, isDialogOpen }: BatchTestFloatingWidgetProps) {
  const [state, setState] = useState<BatchTestState>(() => getBatchTestState());
  const [position, setPosition] = useState<{ left: number; top: number }>(() => ({
    left: typeof window !== "undefined" ? window.innerWidth - 296 : 0,
    top: typeof window !== "undefined" ? window.innerHeight - 150 : 0,
  }));
  const [isDragging, setIsDragging] = useState(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const unsubscribe = subscribeBatchTestState(() => {
      setState(getBatchTestState());
    });
    return unsubscribe;
  }, []);

  // isDialogOpen 变化时（如最小化/展开），主动刷新 state，确保 state.isRunning 是最新的
  useEffect(() => {
    setState(getBatchTestState());
  }, [isDialogOpen]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();

    setIsDragging(true);
    dragOffsetRef.current = {
      x: e.clientX - position.left,
      y: e.clientY - position.top,
    };
  }, [position]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;

    const newLeft = e.clientX - dragOffsetRef.current.x;
    const newTop = e.clientY - dragOffsetRef.current.y;

    setPosition({
      left: Math.max(0, Math.min(window.innerWidth - 280, newLeft)),
      top: Math.max(0, Math.min(window.innerHeight - 100, newTop)),
    });
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const handleExpandClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onExpand();
  }, [onExpand]);

  if (!state.isRunning || isDialogOpen) {
    return null;
  }

  const progress = state.progress;
  const progressPercent = progress ? progress.overallPercent : 0;
  const successCount = state.results.filter(r => r.success).length;
  const failCount = state.results.filter(r => !r.success).length;

  return (
    <div
      className="group fixed z-50 bg-background border rounded-lg shadow-lg p-3 min-w-[280px] max-w-[320px] cursor-move select-none overflow-hidden transition-all duration-300 ease-out hover:shadow-xl hover:border-primary/40"
      style={{
        left: position.left,
        top: position.top,
      }}
      onMouseDown={handleMouseDown}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <GripVertical className="w-4 h-4 text-muted-foreground" />
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
          <span className="text-sm font-medium">批量测试中</span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleExpandClick}
          className="h-6 w-6 p-0 cursor-pointer"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </Button>
      </div>

      <div className="w-full bg-muted rounded-full h-2 overflow-hidden mb-2">
        <div
          className="bg-primary h-full rounded-full transition-all duration-300"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground font-medium">
          {progress ? `${progress.current}/${progress.total}` : "0/0"}
        </span>
        <span className="text-muted-foreground font-medium">
          {progressPercent.toFixed(0)}%
        </span>
      </div>

      {progress && (
        <div className="grid grid-rows-[0fr] opacity-0 group-hover:grid-rows-[1fr] group-hover:opacity-100 transition-all duration-300 ease-out">
          <div className="overflow-hidden">
            <div className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border/50">
              <div className="truncate mb-1 text-foreground/80">
                {progress.currentNodeName}
              </div>
              <div className="mb-2">
                {progress.stage}
                {progress.nodeMessage && ` - ${progress.nodeMessage}`}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-green-600">成功: {successCount}</span>
                <span className="text-red-600">失败: {failCount}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
