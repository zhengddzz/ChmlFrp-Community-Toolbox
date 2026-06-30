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
      className="fixed z-50 bg-background border rounded-lg shadow-lg p-3 min-w-[280px] max-w-[320px] cursor-move select-none"
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

      {progress && (
        <>
          <div className="text-xs text-muted-foreground mb-1 truncate">
            {progress.current}/{progress.total} - {progress.currentNodeName}
          </div>
          <div className="text-xs text-muted-foreground mb-2">
            {progress.stage}
            {progress.nodeMessage && ` - ${progress.nodeMessage}`}
          </div>
        </>
      )}

      <div className="w-full bg-muted rounded-full h-2 overflow-hidden mb-2">
        <div
          className="bg-primary h-full rounded-full transition-all duration-300"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className="text-green-600">成功: {successCount}</span>
          <span className="text-red-600">失败: {failCount}</span>
        </div>
        <span className="text-muted-foreground">
          {progressPercent.toFixed(0)}%
        </span>
      </div>
    </div>
  );
}
