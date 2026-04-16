import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

interface AuditDetailDialogProps {
  selectedLog: any;
  onClose: () => void;
}

export function AuditDetailDialog({ selectedLog, onClose }: AuditDetailDialogProps) {
  return (
    <Dialog open={!!selectedLog} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>日誌詳情</DialogTitle>
          <DialogDescription>
            檢視特定操作的詳細異動紀錄，包含修改時間、操作者以及資料的新舊值對照。
          </DialogDescription>
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
  );
}
