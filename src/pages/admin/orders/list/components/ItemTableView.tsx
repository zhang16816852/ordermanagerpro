import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { RotateCcw } from 'lucide-react';

interface ItemTableViewProps {
  items: any[];
  cancelledItems: any[];
  isLoading: boolean;
  selectedItems: Map<string, any>;
  shippingPoolMap: Map<string, number>;
  onToggleSelection: (item: any, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
  onUpdateQuantity: (id: string, quantity: number) => void;
  onRestoreItem: (id: string) => void;
}

export function ItemTableView({
  items,
  cancelledItems,
  isLoading,
  selectedItems,
  shippingPoolMap,
  onToggleSelection,
  onToggleAll,
  onUpdateQuantity,
  onRestoreItem,
}: ItemTableViewProps) {
  return (
    <div className="rounded-lg border bg-card shadow-soft flex-1 flex flex-col overflow-hidden">
      <Table containerClassName="h-full">
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead className="w-12">
              <Checkbox
                checked={items.length > 0 && selectedItems.size === items.length}
                onCheckedChange={(checked) => onToggleAll(!!checked)}
              />
            </TableHead>
            <TableHead>店鋪</TableHead>
            <TableHead>SKU</TableHead>
            <TableHead>產品名稱</TableHead>
            <TableHead className="text-right">訂購</TableHead>
            <TableHead className="text-right">已出貨</TableHead>
            <TableHead className="text-right">出貨池</TableHead>
            <TableHead className="text-right">待出貨</TableHead>
            <TableHead className="w-32">出貨數量</TableHead>
            <TableHead>訂單日期</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                <TableCell><Skeleton className="h-4 w-8 ml-auto" /></TableCell>
                <TableCell><Skeleton className="h-4 w-8 ml-auto" /></TableCell>
                <TableCell><Skeleton className="h-4 w-8 ml-auto" /></TableCell>
                <TableCell><Skeleton className="h-4 w-8 ml-auto" /></TableCell>
                <TableCell><Skeleton className="h-8 w-20" /></TableCell>
                <TableCell><Skeleton className="h-4 w-20" /></TableCell>
              </TableRow>
            ))
          ) : items.length === 0 && cancelledItems.length === 0 ? (
            <TableRow>
              <TableCell colSpan={10} className="text-center py-12 text-muted-foreground italic">
                沒有找到待處理商品
              </TableCell>
            </TableRow>
          ) : (
            <>
              {items.map((item) => {
                const inPool = shippingPoolMap.get(item.id) || 0;
                const selection = selectedItems.get(item.id);
                return (
                  <TableRow key={item.id} className={selection ? 'bg-muted/50' : ''}>
                    <TableCell>
                      <Checkbox
                        checked={!!selection}
                        onCheckedChange={(checked) => onToggleSelection(item, !!checked)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-xs">{item.storeName}</div>
                      {item.storeCode && <div className="text-[10px] text-muted-foreground opacity-70">{item.storeCode}</div>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{item.product?.sku}</TableCell>
                    <TableCell className="text-sm">
                      {item.product?.name}
                      {item.product_variant && (
                        <span className="text-muted-foreground ml-1">
                          - {item.product_variant.name}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{item.quantity}</TableCell>
                    <TableCell className="text-right">{item.shipped_quantity}</TableCell>
                    <TableCell className="text-right">
                      {inPool > 0 && <Badge variant="outline" className="bg-warning/10 text-orange-600 animate-pulse">{inPool}</Badge>}
                    </TableCell>
                    <TableCell className="text-right font-bold">
                      <Badge variant={item.pendingQuantity > 0 ? 'default' : 'secondary'}>
                        {item.pendingQuantity}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {selection && (
                        <Input
                          type="number"
                          min={1}
                          max={selection.maxQuantity}
                          value={selection.quantity}
                          onChange={(e) => onUpdateQuantity(item.id, parseInt(e.target.value) || 1)}
                          className="w-20 h-8 border-primary/50"
                        />
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {format(new Date(item.orderCreatedAt), 'MM/dd', { locale: zhTW })}
                    </TableCell>
                  </TableRow>
                );
              })}

              {/* Cancelled/Discontinued Items */}
              {cancelledItems.map((item) => (
                <TableRow key={`cancelled-${item.id}`} className="opacity-40 bg-muted/20 grayscale pointer-events-none">
                  <TableCell></TableCell>
                  <TableCell className="text-xs">{item.storeName}</TableCell>
                  <TableCell className="font-mono text-xs line-through">{item.product?.sku}</TableCell>
                  <TableCell className="text-sm italic">
                    <span className="line-through">{item.product?.name}</span>
                    <Badge variant="outline" className="ml-1 text-[10px] h-4">
                      {item.status === 'cancelled' ? '已取消' : '已停售'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{item.quantity}</TableCell>
                  <TableCell className="text-right">{item.shipped_quantity}</TableCell>
                  <TableCell colSpan={3}></TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-blue-500 pointer-events-auto"
                      onClick={() => onRestoreItem(item.id)}
                      title="還原為待出貨"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
