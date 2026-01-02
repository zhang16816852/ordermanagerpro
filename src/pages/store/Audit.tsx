import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, FileText, Eye } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { useAuth } from "@/hooks/useAuth";

export default function StoreAudit() {
  const { storeId, storeRole } = useAuth();
  const [search, setSearch] = useState("");
  const [entityFilter, setEntityFilter] = useState<string>("all");
  const [selectedLog, setSelectedLog] = useState<any>(null);

  const isFounder = storeRole === "founder";

  const { data: auditLogs, isLoading } = useQuery({
    queryKey: ["store-audit-logs", storeId, entityFilter],
    queryFn: async () => {
      if (!storeId) return [];

      let query = supabase
        .from("audit_logs")
        .select("*")
        .eq("store_id", storeId)
        .order("created_at", { ascending: false })
        .limit(100);

      if (entityFilter !== "all") {
        query = query.eq("entity_type", entityFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!storeId && isFounder,
  });

  const filteredLogs = auditLogs?.filter((log) => {
    const searchLower = search.toLowerCase();
    return (
      log.action.toLowerCase().includes(searchLower) ||
      log.entity_type.toLowerCase().includes(searchLower) ||
      log.entity_id.toLowerCase().includes(searchLower)
    );
  });

  const getActionBadge = (action: string) => {
    if (action.includes("create") || action.includes("insert")) {
      return <Badge className="bg-green-500">新增</Badge>;
    }
    if (action.includes("update")) {
      return <Badge className="bg-blue-500">更新</Badge>;
    }
    if (action.includes("delete")) {
      return <Badge className="bg-red-500">刪除</Badge>;
    }
    return <Badge variant="outline">{action}</Badge>;
  };

  if (!storeId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">請先選擇店鋪</p>
      </div>
    );
  }

  if (!isFounder) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">僅創辦人可查看稽核日誌</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">稽核日誌</h1>
        <p className="text-muted-foreground">追蹤店鋪內的所有操作記錄</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            操作記錄
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜尋..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={entityFilter} onValueChange={setEntityFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="篩選類型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">所有類型</SelectItem>
                <SelectItem value="order">訂單</SelectItem>
                <SelectItem value="order_item">訂單項目</SelectItem>
                <SelectItem value="sales_note">銷售單</SelectItem>
                <SelectItem value="store_user">店鋪成員</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">載入中...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>時間</TableHead>
                  <TableHead>操作</TableHead>
                  <TableHead>實體類型</TableHead>
                  <TableHead>實體ID</TableHead>
                  <TableHead>操作者角色</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLogs?.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell>
                      {format(new Date(log.created_at), "yyyy/MM/dd HH:mm:ss")}
                    </TableCell>
                    <TableCell>{getActionBadge(log.action)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{log.entity_type}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {log.entity_id.slice(0, 8)}...
                    </TableCell>
                    <TableCell>
                      {log.performed_by_store_role && (
                        <Badge variant="secondary">
                          {log.performed_by_store_role}
                        </Badge>
                      )}
                      {log.performed_by_system_role && (
                        <Badge>{log.performed_by_system_role}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedLog(log)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {filteredLogs?.length === 0 && !isLoading && (
            <div className="text-center py-8 text-muted-foreground">
              沒有找到符合條件的記錄
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedLog} onOpenChange={() => setSelectedLog(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>日誌詳情</DialogTitle>
          </DialogHeader>
          {selectedLog && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">時間：</span>
                  <span>
                    {format(new Date(selectedLog.created_at), "yyyy/MM/dd HH:mm:ss")}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">操作：</span>
                  <span>{selectedLog.action}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">實體類型：</span>
                  <span>{selectedLog.entity_type}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">實體ID：</span>
                  <span className="font-mono">{selectedLog.entity_id}</span>
                </div>
              </div>

              {selectedLog.old_value && (
                <div>
                  <h4 className="font-medium mb-2">舊值</h4>
                  <pre className="bg-muted p-3 rounded text-sm overflow-auto">
                    {JSON.stringify(selectedLog.old_value, null, 2)}
                  </pre>
                </div>
              )}

              {selectedLog.new_value && (
                <div>
                  <h4 className="font-medium mb-2">新值</h4>
                  <pre className="bg-muted p-3 rounded text-sm overflow-auto">
                    {JSON.stringify(selectedLog.new_value, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
