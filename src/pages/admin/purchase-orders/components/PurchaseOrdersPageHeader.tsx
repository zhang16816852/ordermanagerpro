import { Button } from '@/components/ui/button';
import { Plus, FileUp, Undo2 } from 'lucide-react';

interface Props {
  onCreateSupplier: () => void;
  onImportPurchase: () => void;
  onImportReturns: () => void;
  onCreateOrder: () => void;
}

export function PurchaseOrdersPageHeader({
  onCreateSupplier,
  onImportPurchase,
  onImportReturns,
  onCreateOrder,
}: Props) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">採購管理</h1>
        <p className="text-muted-foreground">管理供應商採購單、進貨收貨與庫存入庫作業</p>
      </div>
      <div className="flex gap-2">
        <Button onClick={onCreateSupplier} variant="outline">
          <Plus className="h-4 w-4 mr-2" /> 新增供應商
        </Button>
        <Button onClick={onImportPurchase} variant="outline">
          <FileUp className="h-4 w-4 mr-2" /> 匯入採購單
        </Button>
        <Button onClick={onImportReturns} variant="outline">
          <Undo2 className="h-4 w-4 mr-2" /> 匯入退貨單
        </Button>
        <Button onClick={onCreateOrder}>
          <Plus className="h-4 w-4 mr-2" /> 建立採購單
        </Button>
      </div>
    </div>
  );
}