import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, KeyRound, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  dnsFailoverService,
  type DnsCredential,
  type DnsProviderKind,
} from "@/services/dnsFailoverService";

const PROVIDERS: { value: DnsProviderKind; label: string }[] = [
  { value: "dnspodCn", label: "DNSPod.cn（腾讯云 API 3.0）" },
  { value: "dnspodCom", label: "DNSPod.com（国际 Token）" },
  { value: "aliyun", label: "Aliyun（阿里云）" },
];

// 各服务商获取密钥的地址与简短说明
const PROVIDER_GUIDE: Record<
  DnsProviderKind,
  { url: string; urlLabel: string; tip: string }
> = {
  dnspodCn: {
    url: "https://console.dnspod.cn/account/token/token",
    urlLabel: "console.dnspod.cn",
    tip: "在「API 密钥」中创建密钥，获得 SecretId 与 SecretKey",
  },
  dnspodCom: {
    url: "https://www.dnspod.com/account/token",
    urlLabel: "dnspod.com",
    tip: "在「API Token」中创建 Token，格式为 ID,Token（用英文逗号分隔）",
  },
  aliyun: {
    url: "https://ram.console.aliyun.com/manage/ak",
    urlLabel: "ram.console.aliyun.com",
    tip: "在 RAM 访问控制中创建 AccessKey，获得 AccessKeyId 与 AccessKeySecret",
  },
};

const EMPTY: DnsCredential = {
  id: "",
  name: "",
  provider: "dnspodCn",
  secretId: "",
  secretKey: "",
  token: "",
};

export function CredentialsTab() {
  const [list, setList] = useState<DnsCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<DnsCredential | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setList(await dnsFailoverService.listCredentials());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "加载凭证失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleAdd = () => {
    setEditing({ ...EMPTY, id: dnsFailoverService.genId() });
  };

  const handleEdit = (cred: DnsCredential) => {
    setEditing({ ...cred });
  };

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.name.trim()) {
      toast.error("请输入凭证名称");
      return;
    }
    if (editing.provider === "dnspodCom" && !editing.token?.trim()) {
      toast.error("DNSPod.com 需要填写 Token（格式：ID,Token）");
      return;
    }
    if (
      (editing.provider === "dnspodCn" || editing.provider === "aliyun") &&
      (!editing.secretId?.trim() || !editing.secretKey?.trim())
    ) {
      toast.error("请填写 SecretId/AccessKeyId 与 SecretKey/AccessKeySecret");
      return;
    }
    try {
      await dnsFailoverService.saveCredential(editing);
      toast.success("凭证已保存");
      setEditing(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    }
  };

  const handleDelete = async (cred: DnsCredential) => {
    if (!confirm(`确认删除凭证「${cred.name}」？`)) return;
    try {
      await dnsFailoverService.deleteCredential(cred.id);
      toast.success("已删除");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败");
    }
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground">加载中...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">DNS 服务商凭证</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            用于切换 CNAME 记录时调用对应的域名 API
          </p>
        </div>
        <Button size="sm" onClick={handleAdd} className="gap-1.5">
          <Plus className="w-3.5 h-3.5" />
          新增凭证
        </Button>
      </div>

      {list.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-12 h-12 rounded-2xl bg-muted/40 flex items-center justify-center mb-3">
            <KeyRound className="w-6 h-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">暂无凭证，点击右上角新增</p>
        </div>
      ) : (
        <div className="grid gap-2">
          {list.map((cred) => (
            <div
              key={cred.id}
              className="flex items-center gap-3 p-3 rounded-xl border border-border/60 bg-card/50 hover:bg-card/80 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground truncate">
                    {cred.name}
                  </span>
                  <span className="px-1.5 py-0.5 text-[10px] rounded bg-primary/10 text-primary font-medium">
                    {dnsFailoverService.providerLabel(cred.provider)}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 truncate">
                  {cred.provider === "dnspodCom"
                    ? `Token: ${cred.token ? "***" : "未设置"}`
                    : `ID: ${cred.secretId || "未设置"}`}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleEdit(cred)}
                  className="h-8 w-8 p-0"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(cred)}
                  className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 编辑对话框 */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {list.find((c) => c.id === editing?.id) ? "编辑凭证" : "新增凭证"}
            </DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label>名称</Label>
                <Input
                  value={editing.name}
                  onChange={(e) =>
                    setEditing({ ...editing, name: e.target.value })
                  }
                  placeholder="如：我的腾讯云"
                />
              </div>
              <div className="space-y-1.5">
                <Label>服务商</Label>
                <Select
                  options={PROVIDERS.map((p) => ({ value: p.value, label: p.label }))}
                  value={editing.provider}
                  onChange={(v) =>
                    setEditing({
                      ...editing,
                      provider: v as DnsProviderKind,
                    })
                  }
                />
              </div>
              {/* 服务商密钥获取指引 */}
              {(() => {
                const guide = PROVIDER_GUIDE[editing.provider];
                return (
                  <div className="flex items-start gap-2 p-2.5 rounded-lg bg-muted/40 border border-border/50">
                    <KeyRound className="w-3.5 h-3.5 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        {guide.tip}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          void openUrl(guide.url);
                        }}
                        className="mt-1 inline-flex items-center gap-1 text-[11px] text-primary hover:opacity-80"
                      >
                        <ExternalLink className="w-3 h-3" />
                        {guide.urlLabel}
                      </button>
                    </div>
                  </div>
                );
              })()}
              {editing.provider === "dnspodCom" ? (
                <div className="space-y-1.5">
                  <Label>Token（格式：ID,Token）</Label>
                  <Input
                    value={editing.token || ""}
                    onChange={(e) =>
                      setEditing({ ...editing, token: e.target.value })
                    }
                    placeholder="12345,abcdef"
                  />
                </div>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label>
                      {editing.provider === "aliyun"
                        ? "AccessKeyId"
                        : "SecretId"}
                    </Label>
                    <Input
                      value={editing.secretId || ""}
                      onChange={(e) =>
                        setEditing({ ...editing, secretId: e.target.value })
                      }
                      placeholder={
                        editing.provider === "aliyun"
                          ? "LTAI5tXXXXXXXXXXXX"
                          : "AKIDxxxxxxxxxxxxxxxxxxxxx"
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>
                      {editing.provider === "aliyun"
                        ? "AccessKeySecret"
                        : "SecretKey"}
                    </Label>
                    <Input
                      type="password"
                      value={editing.secretKey || ""}
                      onChange={(e) =>
                        setEditing({ ...editing, secretKey: e.target.value })
                      }
                      placeholder="••••••••••••••••"
                    />
                  </div>
                </>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              取消
            </Button>
            <Button onClick={handleSave}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
