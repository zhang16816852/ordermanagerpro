import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { OrderItemsTable, OrderItemRow } from '@/components/order/OrderItemsTable';

export type PanelState = 'items' | 'products' | null;

interface OrderItemsPanelProps {
  isEditMode: boolean;
  orderType: string;
  items: OrderItemRow[];
  onUpdateQuantity: (index: number, value: number) => void;
  onUpdatePrice: (index: number, value: number) => void;
  onRemove: (index: number) => void;
  onSplit?: (index: number) => void;
  onReorder: (items: OrderItemRow[]) => void;
  priceSyncMap?: Record<string, boolean>;
  onTogglePriceSync?: (id: string, checked: boolean) => void;
  activePanel: PanelState;
  onTogglePanel: () => void;
  className?: string;
}

export function OrderItemsPanel({
  isEditMode,
  orderType,
  items,
  onUpdateQuantity,
  onUpdatePrice,
  onRemove,
  onSplit,
  onReorder,
  priceSyncMap,
  onTogglePriceSync,
  activePanel,
  onTogglePanel,
  className,
}: OrderItemsPanelProps) {
  return (
    <Card className="h-full min-h-[300px]">
      <CardHeader className="sticky top-0 bg-background z-10 cursor-pointer" onClick={onTogglePanel}>
        <CardTitle className="flex items-center justify-between">
          <span>{isEditMode ? '訂單項目' : (
            orderType === 'purchase' ? '採購品項' :
            orderType === 'consignment_receive' ? '寄賣收貨品項' :
            orderType === 'consignment_send' ? '寄賣出貨品項' : '訂單項目'
          )}</span>
          <Badge variant="secondary">{items.length} 項</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent onClick={(e) => e.stopPropagation()}>
        <OrderItemsTable
          items={items}
          onUpdateQuantity={onUpdateQuantity}
          onUpdatePrice={onUpdatePrice}
          onRemove={onRemove}
          onSplit={onSplit}
          isEditable={true}
          onReorder={onReorder}
          priceSyncMap={orderType === 'sales' ? priceSyncMap : undefined}
          onTogglePriceSync={orderType === 'sales' ? onTogglePriceSync : undefined}
          priceLabel={orderType === 'sales' ? '單價' : '進貨價'}
        />
      </CardContent>
    </Card>
  );
}
