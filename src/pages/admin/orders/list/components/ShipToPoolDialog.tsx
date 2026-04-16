import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Truck } from 'lucide-react';

interface ShipToPoolDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupedItems: Record<string, { storeName: string; items: any[] }>;
  onConfirm: () => void;
  isLoading: boolean;
}

export function ShipToPoolDialog({
  open,
  onOpenChange,
  groupedItems,
  onConfirm,
  isLoading,
}: ShipToPoolDialogProps) {
  const totalCount = Object.values(groupedItems).reduce((sum, g) => sum + g.items.length, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col p-0">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle className="flex items-center gap-2 text-xl font-bold">
            <Truck className="h-6 w-6 text-primary" />
            確認加入出貨池
          </DialogTitle>
          <DialogDescription>
            請核對即將加入出貨池的品項清單。加入後，倉庫人員將可看到這些需求並開始進行配貨。
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-8">
          {Object.entries(groupedItems).map(([storeId, group]) => (
            <div key={storeId} className="space-y-3">
              <div className="flex items-center justify-between border-b pb-1">
                <h3 className="font-bold text-lg text-primary">{group.storeName}</h3>
                <span className="text-xs text-muted-foreground">{group.items.length} 個品項</span>
              </div>
              <Table>
                <TableHeader className="bg-muted/30">
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>產品名稱</TableHead>
                    <TableHead className="text-right">數量</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.items.map((item) => (
                    <TableRow key={item.itemId}>
                      <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                      <TableCell className="text-sm font-medium">{item.productName}</TableCell>
                      <TableCell className="text-right font-bold text-primary">{item.quantity}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ))}
        </div>

        <DialogFooter className="p-6 pt-2 bg-muted/20 border-t">
          <div className="flex-1 text-sm text-muted-foreground self-center">
            共計 {totalCount} 個品項待出貨
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            取消修
          </Button>
          <Button onClick={onConfirm} disabled={isLoading} className="shadow-lg">
            {isLoading ? '處理中...' : '確認加入'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
