import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useStoreAuditLogs } from "./hooks/useStoreAuditLogs";
import { AuditFilters } from "./components/audit/AuditFilters";
import { AuditTable } from "./components/audit/AuditTable";
import { AuditDetailDialog } from "./components/audit/AuditDetailDialog";

export default function StoreAudit() {
  const { storeId, storeRole } = useAuth();
  const [search, setSearch] = useState("");
  const [entityFilter, setEntityFilter] = useState<string>("all");
  const [selectedLog, setSelectedLog] = useState<any>(null);

  const isFounder = storeRole === "founder";

  const { data: auditLogs, isLoading } = useStoreAuditLogs(storeId, isFounder, entityFilter);

  const filteredLogs = auditLogs?.filter((log) => {
    const searchLower = search.toLowerCase();
    return (
      log.action.toLowerCase().includes(searchLower) ||
      log.entity_type.toLowerCase().includes(searchLower) ||
      log.entity_id.toLowerCase().includes(searchLower)
    );
  });

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
          <AuditFilters 
            search={search}
            setSearch={setSearch}
            entityFilter={entityFilter}
            setEntityFilter={setEntityFilter}
          />

          <AuditTable 
            logs={filteredLogs}
            isLoading={isLoading}
            onSelectLog={setSelectedLog}
          />
        </CardContent>
      </Card>

      <AuditDetailDialog 
        selectedLog={selectedLog}
        onClose={() => setSelectedLog(null)}
      />
    </div>
  );
}
