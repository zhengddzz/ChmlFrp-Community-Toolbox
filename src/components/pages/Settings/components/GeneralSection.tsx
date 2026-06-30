import { useState, useEffect } from "react";
import { Settings2 } from "lucide-react";
import {
  Item,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemActions,
} from "@/components/ui/item";
import { Select } from "@/components/ui/select";
import {
  getCloseAction,
  setCloseAction,
  type CloseAction,
} from "@/lib/settings-utils";

// 关闭窗口默认行为选项
const closeActionOptions = [
  { value: "ask", label: "每次询问" },
  { value: "minimize", label: "最小化到托盘" },
  { value: "exit", label: "直接退出" },
];

export function GeneralSection() {
  const [closeAction, setCloseActionState] = useState<CloseAction>(() =>
    getCloseAction(),
  );

  // 监听关闭行为变更（关闭弹窗记忆选择时会同步更新这里）
  useEffect(() => {
    const handler = () => setCloseActionState(getCloseAction());
    window.addEventListener("closeActionChanged", handler);
    return () => window.removeEventListener("closeActionChanged", handler);
  }, []);

  const handleChange = (value: string | number) => {
    const action = String(value) as CloseAction;
    setCloseAction(action);
    setCloseActionState(action);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Settings2 className="w-4 h-4" />
        <span>通用</span>
      </div>
      <div className="rounded-lg bg-card overflow-hidden">
        <Item variant="outline" className="border-0">
          <ItemContent>
            <ItemTitle>关闭窗口行为</ItemTitle>
            <ItemDescription className="text-xs">
              点击窗口关闭按钮时的默认操作，可在关闭弹窗中勾选「记住」快速设置
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <Select
              options={closeActionOptions}
              value={closeAction}
              onChange={handleChange}
              size="sm"
              className="w-32"
            />
          </ItemActions>
        </Item>
      </div>
    </div>
  );
}
