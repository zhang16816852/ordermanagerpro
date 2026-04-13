import { format } from "date-fns";
import { Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface AuditTableProps {
  logs: any[] | undefined;
  isLoading: boolean;
  onSelectLog: (log: any) => void;
}

export function AuditTable({ logs, isLoading, onSelectLog }: AuditTableProps) {
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

  if (isLoading) {
    return <div className="text-center py-8 text-muted-foreground">載入中...</div>;
  }

  if (!logs || logs.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        沒有找到符合條件的記錄
      </div>
    );
  }

  return (
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
        {logs.map((log) => (
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
                onClick={() => onSelectLog(log)}
              >
                <Eye className="h-4 w-4" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
