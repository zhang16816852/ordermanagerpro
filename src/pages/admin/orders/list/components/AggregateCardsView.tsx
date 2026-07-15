import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, ChevronRight, Store, Package } from 'lucide-react';
import type { AggregatedItem } from './AggregateTableView';

interface AggregateCardsViewProps {
  items: AggregatedItem[];
  isLoading: boolean;
  selectedItems: Map<string, { productId: string; variantId: string | null; quantity: number; maxQuantity: number; productName: string; sku: string; sourceOrderIds: string[] }>;
  onToggleSelection: (item: AggregatedItem, checked: boolean) => void;
  onUpdateQuantity: (key: string, quantity: number) => void;
}

export function AggregateCardsView({
  items,
  isLoading,
  selectedItems,
  onToggleSelection,
  onUpdateQuantity,
}: AggregateCardsViewProps) {
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

  const getItemKey = (item: AggregatedItem) => `${item.productId}_${item.variantId || 'null'}`;

  const toggleExpand = (key: string) => {
    setExpandedCards(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        載入中...
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Package className="h-12 w-12 mb-4 opacity-30" />
        <p className="text-lg font-medium">目前沒有待叫貨的品項</p>
        <p className="text-sm">切換至「未確認」或「處理中」狀態查看訂單</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 pb-20">
      {items.map((item) => {
        const key = getItemKey(item);
        const isSelected = selectedItems.has(key);
        const selectedData = selectedItems.get(key);
        const isExpanded = expandedCards.has(key);

        return (
          <Collapsible key={key} open={isExpanded} onOpenChange={() => toggleExpand(key)}>
            <div className={`rounded-lg border bg-card p-4 ${isSelected ? 'ring-2 ring-primary' : ''}`}>
              <div className="flex items-start gap-3">
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={(checked) => onToggleSelection(item, checked === true)}
                  className="mt-1"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-medium truncate">{item.productName}</h3>
                      {item.variantName && (
                        <p className="text-sm text-muted-foreground truncate">{item.variantName}</p>
                      )}
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">{item.sku}</p>
                    </div>
                    <Badge variant="secondary" className="font-bold text-base px-3 py-1 shrink-0">
                      {isSelected ? selectedData?.quantity : item.totalPendingQuantity}
                    </Badge>
                  </div>

                  {isSelected && (
                    <div className="mt-3 flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">叫貨量：</span>
                      <Input
                        type="number"
                        min={1}
                        max={item.totalPendingQuantity}
                        value={selectedData?.quantity ?? item.totalPendingQuantity}
                        onChange={(e) => {
                          const val = parseInt(e.target.value) || 1;
                          onUpdateQuantity(key, Math.min(Math.max(1, val), item.totalPendingQuantity));
                        }}
                        className="w-24 h-8 text-center"
                      />
                    </div>
                  )}

                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="mt-2 h-7 px-2 text-xs text-muted-foreground">
                      <Store className="h-3 w-3 mr-1" />
                      {item.storeBreakdown.length} 門市需要
                      {isExpanded ? <ChevronDown className="h-3 w-3 ml-1" /> : <ChevronRight className="h-3 w-3 ml-1" />}
                    </Button>
                  </CollapsibleTrigger>
                </div>
              </div>

              <CollapsibleContent>
                <div className="mt-3 ml-9 grid grid-cols-2 gap-2">
                  {item.storeBreakdown.map((store) => (
                    <div
                      key={store.storeId}
                      className="flex items-center justify-between rounded border bg-muted/30 px-2 py-1.5 text-xs"
                    >
                      <span className="truncate">
                        {store.storeCode ? `${store.storeCode}` : store.storeName}
                      </span>
                      <Badge variant="outline" className="ml-1 shrink-0 text-xs">
                        {store.quantity}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        );
      })}
    </div>
  );
}
