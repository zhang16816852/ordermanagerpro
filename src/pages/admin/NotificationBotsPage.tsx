import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Save, Send, Bot, Check, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const EVENT_TYPES = [
  "sales_note_created",
  "sales_note_updated",
  "sales_note_recalled",
  "customer_statement_created",
  "customer_statement_updated",
  "customer_statement_recalled",
];

interface BotRow {
  id?: string;
  name: string;
  channel: string;
  bot_token: string;
  chat_id: string;
  event_types: string[];
  is_default: boolean;
  is_active: boolean;
}

const emptyBot: BotRow = {
  name: "",
  channel: "telegram",
  bot_token: "",
  chat_id: "",
  event_types: [],
  is_default: false,
  is_active: true,
};

export default function NotificationBotsPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<BotRow | null>(null);
  const [isNew, setIsNew] = useState(false);

  const { data: bots = [], isLoading } = useQuery({
    queryKey: ["notification-bots"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("notification_bots")
        .select("*")
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as BotRow[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (bot: BotRow) => {
      if (bot.id) {
        const { error } = await (supabase as any)
          .from("notification_bots")
          .update({
            name: bot.name,
            bot_token: bot.bot_token || null,
            chat_id: bot.chat_id || null,
            event_types: bot.event_types,
            is_default: bot.is_default,
            is_active: bot.is_active,
          })
          .eq("id", bot.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any)
          .from("notification_bots")
          .insert({
            name: bot.name,
            channel: bot.channel,
            bot_token: bot.bot_token || null,
            chat_id: bot.chat_id || null,
            event_types: bot.event_types,
            is_default: bot.is_default,
            is_active: bot.is_active,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notification-bots"] });
      toast.success("已儲存");
      setEditing(null);
      setIsNew(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "儲存失敗"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from("notification_bots")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notification-bots"] });
      toast.success("已刪除");
    },
    onError: (e: any) => toast.error(e?.message ?? "刪除失敗"),
  });

  const toggleDefault = (bot: BotRow) => {
    // 先取消其他 bot 的 default，再設定此 bot
    const updates = bots.map((b) =>
      b.id === bot.id
        ? { ...b, is_default: true }
        : { ...b, is_default: false }
    );
    // 樂觀更新：直接呼叫 saveMutation 逐筆
    if (bot.id) {
      saveMutation.mutate({ ...bot, is_default: true });
    }
  };

  const toggleEventType = (type: string) => {
    if (!editing) return;
    const types = editing.event_types.includes(type)
      ? editing.event_types.filter((t) => t !== type)
      : [...editing.event_types, type];
    setEditing({ ...editing, event_types: types });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Telegram Bot 管理</h1>
          <p className="text-sm text-muted-foreground mt-1">
            管理多個 Telegram Bot 與群組，每個事件可綁定不同 Bot。未設定 event_types 視為通用 Bot。
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing({ ...emptyBot });
            setIsNew(true);
          }}
        >
          <Plus className="h-4 w-4 mr-2" /> 新增 Bot
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-10 text-muted-foreground">載入中...</div>
      ) : bots.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            尚未建立任何 Bot。請新增一個 Bot 並設定為預設。
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {bots.map((bot) => (
            <Card key={bot.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Bot className="h-5 w-5 text-muted-foreground" />
                    <CardTitle className="text-base">{bot.name || "（未命名）"}</CardTitle>
                    {bot.is_default && <Badge variant="default">預設</Badge>}
                    {bot.is_active ? (
                      <Badge variant="outline" className="text-green-600 border-green-200">啟用</Badge>
                    ) : (
                      <Badge variant="outline" className="text-gray-400">停用</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => { setEditing({ ...bot }); setIsNew(false); }}>
                      編輯
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => {
                        if (confirm(`確定刪除 Bot「${bot.name}」？`)) {
                          deleteMutation.mutate(bot.id!);
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-muted-foreground">Chat ID：</span>
                    <span className="font-mono">{bot.chat_id || "（環境變數 fallback）"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Token：</span>
                    <span className="font-mono">{bot.bot_token ? "••••••" + bot.bot_token.slice(-6) : "（環境變數 fallback）"}</span>
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">事件類型：</span>
                  {bot.event_types.length === 0 ? (
                    <Badge variant="secondary" className="ml-2">通用（所有事件）</Badge>
                  ) : (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {bot.event_types.map((t) => (
                        <Badge key={t} variant="outline" className="text-xs">{t}</Badge>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 編輯/新增 Dialog */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <CardHeader>
              <CardTitle>{isNew ? "新增 Bot" : "編輯 Bot"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>名稱</Label>
                <Input
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="例如：管理群組"
                />
              </div>
              <div className="space-y-2">
                <Label>Bot Token（留空則使用環境變數 TELEGRAM_BOT_TOKEN）</Label>
                <Input
                  value={editing.bot_token}
                  onChange={(e) => setEditing({ ...editing, bot_token: e.target.value })}
                  placeholder="123456:ABC-DEF..."
                  type="password"
                />
              </div>
              <div className="space-y-2">
                <Label>Chat ID（留空則使用環境變數 TELEGRAM_CHAT_ID）</Label>
                <Input
                  value={editing.chat_id}
                  onChange={(e) => setEditing({ ...editing, chat_id: e.target.value })}
                  placeholder="-1001234567890"
                />
              </div>
              <div className="space-y-2">
                <Label>事件類型（不勾選 = 通用 Bot，接收所有事件）</Label>
                <div className="grid grid-cols-2 gap-2">
                  {EVENT_TYPES.map((t) => (
                    <label key={t} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={editing.event_types.includes(t)}
                        onCheckedChange={() => toggleEventType(t)}
                      />
                      {t}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={editing.is_active}
                    onCheckedChange={(v) => setEditing({ ...editing, is_active: v })}
                  />
                  啟用
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={editing.is_default}
                    onCheckedChange={(v) => setEditing({ ...editing, is_default: v })}
                  />
                  預設 Bot
                </label>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => { setEditing(null); setIsNew(false); }}>
                  取消
                </Button>
                <Button onClick={() => saveMutation.mutate(editing)} disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                  儲存
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
