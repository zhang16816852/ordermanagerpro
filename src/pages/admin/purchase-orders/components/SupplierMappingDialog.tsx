import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { SupplierMappingManager } from './mapping/SupplierMappingManager';

interface SupplierMappingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplier: { id: string; name: string } | null;
}

export function SupplierMappingDialog({ open, onOpenChange, supplier }: SupplierMappingDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>對照管理與設定 - {supplier?.name || '未知廠商'}</DialogTitle>
          <DialogDescription>
            在此管理特定供應商的產品編號與系統內產品的對照關係，確保匯入採購單時能正確對齊資料。
          </DialogDescription>
        </DialogHeader>
        {open && supplier && (
          <SupplierMappingManager supplierId={supplier.id} />
        )}
      </DialogContent>
    </Dialog>
  );
}
