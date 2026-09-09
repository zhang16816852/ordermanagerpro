import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { OrderItemsTable, OrderItemRow } from '@/components/order/OrderItemsTable';
import { ChevronDown, ChevronUp } from 'lucide-react';

export type PanelState = 'information' | 'items' | 'products' | null;

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
  collapsed?: boolean;
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
  collapsed = false,
}: OrderItemsPanelProps) {
  const isExpanded = activePanel === 'items';

  return (
    <Card className={`h-full flex flex-col ${className || ''}`}>
      <CardHeader
        className="sticky top-0 bg-background z-10 shrink-0 cursor-pointer select-none py-3 px-4"
        onClick={onTogglePanel}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">{isEditMode ? '訂單項目' : (
              orderType === 'purchase' ? '採購品項' :
              orderType === 'consignment_receive' ? '寄賣收貨品項' :
              orderType === 'consignment_send' ? '寄賣出貨品項' : '訂單項目'
            )}</CardTitle>
            <Badge variant="secondary">{items.length} 項</Badge>
          </div>
          <div className="flex items-center gap-1 text-muted-foreground">
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </div>
      </CardHeader>
      {!collapsed && (
        <CardContent className="flex-1 min-h-0 overflow-auto p-4" onClick={(e) => e.stopPropagation()}>
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
      )}
    </Card>
  );
}
