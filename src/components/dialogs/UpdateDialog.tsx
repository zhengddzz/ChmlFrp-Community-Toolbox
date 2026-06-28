import { Download, Clock, Sparkles } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";

interface UpdateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** 点击"立即更新"开始下载 */
  onUpdate: () => void;
  /** 下载完成后点击"立即重启更新"运行安装包 */
  onInstall: () => void;
  version: string;
  date?: string;
  body?: string;
  isDownloading?: boolean;
  /** 安装包是否已下载完成，等待用户确认重启 */
  downloaded?: boolean;
  downloadProgress?: number;
}

function renderMarkdown(text: string): string {
  if (!text) return "";

  // 规范化换行符：将 \r\n 和 \r 统一为 \n，避免行尾残留 \r 导致匹配失败
  const normalizedText = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalizedText.split("\n");
  const result: string[] = [];
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    if (trimmedLine === "") {
      if (inList) {
        result.push("</ul>");
        inList = false;
      }
      continue;
    }

    // 水平分隔线
    if (trimmedLine === "---" || trimmedLine === "***" || trimmedLine === "___") {
      if (inList) {
        result.push("</ul>");
        inList = false;
      }
      result.push("<hr class='my-3 border-border/60' />");
      continue;
    }

    if (trimmedLine.startsWith("### ")) {
      if (inList) {
        result.push("</ul>");
        inList = false;
      }
      const content = trimmedLine.substring(4);
      const emojiMatch = content.match(
        /^([\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}])/u,
      );
      const emoji = emojiMatch ? emojiMatch[0] : "";
      const text = emoji ? content.substring(emoji.length).trim() : content;
      result.push(
        `<h3 class='text-sm font-semibold mt-3 mb-2 text-foreground flex items-center gap-2'><span>${emoji}</span><span>${text}</span></h3>`,
      );
    } else if (trimmedLine.startsWith("## ")) {
      if (inList) {
        result.push("</ul>");
        inList = false;
      }
      const content = trimmedLine.substring(3);
      const emojiMatch = content.match(
        /^([\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}])/u,
      );
      const emoji = emojiMatch ? emojiMatch[0] : "";
      const text = emoji ? content.substring(emoji.length).trim() : content;
      result.push(
        `<h2 class='text-base font-semibold mt-3 mb-2 text-foreground flex items-center gap-2'><span>${emoji}</span><span>${text}</span></h2>`,
      );
    } else if (trimmedLine.startsWith("# ")) {
      if (inList) {
        result.push("</ul>");
        inList = false;
      }
      const content = trimmedLine.substring(2);
      result.push(
        `<h1 class='text-lg font-semibold mt-3 mb-2 text-foreground'>${content}</h1>`,
      );
    } else if (trimmedLine.startsWith("- ") || trimmedLine.startsWith("* ")) {
      if (!inList) {
        result.push("<ul class='list-none space-y-1.5 my-2'>");
        inList = true;
      }
      const content = trimmedLine.substring(2);
      const processedContent = content
        .replace(
          /\*\*(.*?)\*\*/g,
          "<strong class='font-semibold text-foreground'>$1</strong>",
        )
        .replace(
          /\[([^\]]+)\]\(([^)]+)\)/g,
          "<a href='$2' target='_blank' rel='noopener noreferrer' class='text-primary underline hover:opacity-80'>$1</a>",
        );
      result.push(
        `<li class='text-sm text-muted-foreground leading-relaxed flex items-start gap-2'><span class='text-primary mt-0.5'>•</span><span class='flex-1'>${processedContent}</span></li>`,
      );
    } else {
      if (inList) {
        result.push("</ul>");
        inList = false;
      }
      const processedLine = trimmedLine
        .replace(
          /\*\*(.*?)\*\*/g,
          "<strong class='font-semibold text-foreground'>$1</strong>",
        )
        .replace(
          /\[([^\]]+)\]\(([^)]+)\)/g,
          "<a href='$2' target='_blank' rel='noopener noreferrer' class='text-primary underline hover:opacity-80'>$1</a>",
        );
      result.push(
        `<p class='text-sm text-muted-foreground mb-1 leading-relaxed'>${processedLine}</p>`,
      );
    }
  }

  if (inList) {
    result.push("</ul>");
  }

  return result.join("");
}

export function UpdateDialog({
  isOpen,
  onClose,
  onUpdate,
  onInstall,
  version,
  date,
  body,
  isDownloading = false,
  downloaded = false,
  downloadProgress = 0,
}: UpdateDialogProps) {
  const markdownContent = body ? renderMarkdown(body) : "";

  // 下载中 / 下载完成：不再使用对话框，改由设置页 UpdateSection 和侧边栏按钮显示
  // 此处对话框仅在"发现新版本"初始提示时显示
  if (isDownloading || downloaded) {
    return null;
  }

  // 初始提示：发现新版本
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => !open && !isDownloading && onClose()}
    >
      <DialogContent
        className="max-w-xl max-h-[85vh] p-0 overflow-hidden"
        showCloseButton={!isDownloading}
      >
        <div className="flex flex-col h-full max-h-[85vh]">
          <div className="relative bg-gradient-to-br from-primary/10 via-primary/5 to-background border-b border-border/50 flex-shrink-0">
            <DialogHeader className="relative p-6 pb-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <DialogTitle className="flex items-center gap-3 text-xl mb-3">
                    <Sparkles className="w-5 h-5 text-primary" />
                    <span>发现新版本</span>
                  </DialogTitle>
                  <DialogDescription className="space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge
                        variant="secondary"
                        className="text-xs font-medium px-2 py-0.5 bg-primary/10 text-primary border-primary/20"
                      >
                        v{version}
                      </Badge>
                      {date && (
                        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5" />
                          <span>
                            {new Date(date).toLocaleDateString("zh-CN", {
                              year: "numeric",
                              month: "long",
                              day: "numeric",
                            })}
                          </span>
                        </div>
                      )}
                    </div>
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
          </div>

          {markdownContent && (
            <div className="px-6 py-4 flex-1 min-h-0 overflow-hidden">
              <ScrollArea className="h-full pr-4">
                <div
                  className="prose prose-sm dark:prose-invert max-w-none update-content"
                  dangerouslySetInnerHTML={{ __html: markdownContent }}
                />
              </ScrollArea>
            </div>
          )}

          <DialogFooter className="px-6 py-4 border-t border-border/50 bg-muted/20 z-10 flex items-center justify-between gap-3 flex-shrink-0">
            <div className="flex items-center gap-3 w-full sm:w-auto sm:ml-auto">
              <Button
                variant="outline"
                onClick={onClose}
                disabled={isDownloading}
                className="flex items-center gap-2 flex-1 sm:flex-initial"
              >
                下次再说
              </Button>
              <Button
                onClick={onUpdate}
                disabled={isDownloading}
                className="flex items-center gap-2 flex-1 sm:flex-initial bg-primary hover:bg-primary/90 shadow-sm"
              >
                <Download className="w-4 h-4" />
                立即更新
              </Button>
            </div>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
