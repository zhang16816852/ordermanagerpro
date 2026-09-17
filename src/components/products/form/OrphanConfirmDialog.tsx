import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertCircle } from 'lucide-react';
import type { OrphanConfirmState } from './variantBatchCreatorTypes';

interface OrphanConfirmDialogProps {
  orphanConfirm: OrphanConfirmState;
  onCancel: () => void;
  onProceed: () => void;
}

export function OrphanConfirmDialog({ orphanConfirm, onCancel, onProceed }: OrphanConfirmDialogProps) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-amber-600" />
            既有變體已被業務資料引用
          </DialogTitle>
          <DialogDescription>
            以下變體不在新的生成組合中，且已被訂單／庫存等資料引用，無法刪除；儲存後會保留原樣（失去選項連結）。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="space-y-1.5">
            {orphanConfirm.referencedOrphans.map(({ variant, refs }) => (
              <div key={variant._dbId} className="rounded-lg border p-2.5">
                <div className="flex items-center gap-2 font-medium">
                  <span className="font-mono text-xs">{variant.sku}</span>
                  <span className="text-muted-foreground">{variant.name}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {refs.map(r => (
                    <Badge key={r.table} variant="outline" className="text-xs">
                      {r.label} ×{r.count}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {orphanConfirm.unreferencedToDelete.length > 0 && (
            <p className="text-muted-foreground">
              另有 {orphanConfirm.unreferencedToDelete.length} 個未被引用的既有變體將於儲存後自動刪除。
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            建議先到「訂單／庫存」移除引用，或調整選項群組以保留這些變體，再重新生成。
          </p>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onCancel}>
            返回調整
          </Button>
          <Button onClick={onProceed}>
            仍要儲存（被引用者保留）
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}