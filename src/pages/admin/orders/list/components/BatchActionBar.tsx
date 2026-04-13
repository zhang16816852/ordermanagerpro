import { Button } from '@/components/ui/button';
import { Truck, CheckSquare, XCircle, Package } from 'lucide-react';

interface BatchActionBarProps {
  statusTab: string;
  viewMode: 'orders' | 'items';
  selectedOrderCount: number;
  selectedItemCount: number;
  onConfirmOrders: () => void;
  onShipItems: () => void;
  onCancelItems: () => void;
  isLoading: boolean;
}

export function BatchActionBar({
  statusTab,
  viewMode,
  selectedOrderCount,
  selectedItemCount,
  onConfirmOrders,
  onShipItems,
  onCancelItems,
  isLoading,
}: BatchActionBarProps) {
  if (viewMode === 'orders' && selectedOrderCount === 0) return null;
  if (viewMode === 'items' && selectedItemCount === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="bg-primary text-primary-foreground px-6 py-4 rounded-full shadow-2xl flex items-center gap-6 border-4 border-background/20 ring-1 ring-primary/30">
        <div className="flex items-center gap-2 border-r border-primary-foreground/30 pr-6">
          <Package className="h-5 w-5" />
          <span className="font-bold text-lg">
            已選擇 {viewMode === 'orders' ? selectedOrderCount : selectedItemCount} {viewMode === 'orders' ? '個訂單' : '個品項'}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {statusTab === 'pending' && viewMode === 'orders' && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onConfirmOrders}
              disabled={isLoading}
              className="rounded-full shadow-inner active:scale-95 transition-all"
            >
              <CheckSquare className="h-4 w-4 mr-2" />
              確認轉處理中
            </Button>
          )}

          {viewMode === 'items' && (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={onShipItems}
                disabled={isLoading}
                className="rounded-full shadow-inner active:scale-95 transition-all"
              >
                <Truck className="h-4 w-4 mr-2" />
                加入出貨池
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={onCancelItems}
                disabled={isLoading}
                className="rounded-full shadow-lg hover:bg-red-600 active:scale-95 transition-all"
              >
                <XCircle className="h-4 w-4 mr-2" />
                標記停產/取消
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
