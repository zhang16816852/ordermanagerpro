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
      <DialogContent className="max-w-4xl flex flex-col max-h-[90vh] overflow-hidden p-0">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-2">
          <DialogTitle>對照管理與設定 - {supplier?.name || '未知廠商'}</DialogTitle>
          <DialogDescription>
            在此管理特定供應商的產品編號與系統內產品的對照關係，確保匯入採購單時能正確對齊資料。
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          {open && supplier && (
            <SupplierMappingManager supplierId={supplier.id} supplierName={supplier.name} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}