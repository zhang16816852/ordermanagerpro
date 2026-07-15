import { Button } from '@/components/ui/button';
import { Truck, CheckSquare, XCircle, Package, Send, ClipboardList, FileText, FileSpreadsheet } from 'lucide-react';

interface BatchActionBarProps {
  statusTab: string;
  viewMode: 'orders' | 'items' | 'aggregate';
  selectedOrderCount: number;
  selectedItemCount: number;
  selectedAggregateCount: number;
  onConfirmOrders: () => void;
  onShipItems: () => void;
  onCancelItems: () => void;
  onDirectShipOrders: () => void;
  onConvertToPO: () => void;
  onExportAggregateCSV: () => void;
  onExportAggregateExcel: () => void;
  isLoading: boolean;
}

export function BatchActionBar({
  statusTab,
  viewMode,
  selectedOrderCount,
  selectedItemCount,
  selectedAggregateCount,
  onConfirmOrders,
  onShipItems,
  onCancelItems,
  onDirectShipOrders,
  onConvertToPO,
  onExportAggregateCSV,
  onExportAggregateExcel,
  isLoading,
}: BatchActionBarProps) {
  if (viewMode === 'orders' && selectedOrderCount === 0) return null;
  if (viewMode === 'items' && selectedItemCount === 0) return null;
  if (viewMode === 'aggregate' && selectedAggregateCount === 0) return null;

  const getCount = () => {
    if (viewMode === 'orders') return selectedOrderCount;
    if (viewMode === 'items') return selectedItemCount;
    return selectedAggregateCount;
  };
  const getLabel = () => {
    if (viewMode === 'orders') return '個訂單';
    if (viewMode === 'items') return '個品項';
    return '項產品';
  };

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="bg-primary text-primary-foreground px-6 py-4 rounded-full shadow-2xl flex items-center gap-6 border-4 border-background/20 ring-1 ring-primary/30">
        <div className="flex items-center gap-2 border-r border-primary-foreground/30 pr-6">
          <Package className="h-5 w-5" />
          <span className="font-bold text-lg">
            已選擇 {getCount()} {getLabel()}
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

          {statusTab === 'processing' && viewMode === 'orders' && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onDirectShipOrders}
              disabled={isLoading}
              className="rounded-full shadow-inner active:scale-95 transition-all"
            >
              <Send className="h-4 w-4 mr-2" />
              轉銷貨單
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

          {viewMode === 'aggregate' && (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={onExportAggregateCSV}
                disabled={isLoading}
                className="rounded-full shadow-inner active:scale-95 transition-all"
              >
                <FileText className="h-4 w-4 mr-2" />
                匯出 CSV
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={onExportAggregateExcel}
                disabled={isLoading}
                className="rounded-full shadow-inner active:scale-95 transition-all"
              >
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                匯出 Excel
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={onConvertToPO}
                disabled={isLoading}
                className="rounded-full shadow-inner active:scale-95 transition-all"
              >
                <ClipboardList className="h-4 w-4 mr-2" />
                轉採購單
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
