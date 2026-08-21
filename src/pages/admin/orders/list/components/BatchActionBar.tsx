import { Button } from '@/components/ui/button';
import { Truck, CheckSquare, XCircle, Package, Send, Store, ClipboardList, FileText, FileSpreadsheet } from 'lucide-react';
import { MobileFooter } from '@/components/layout/MobileFooter';

interface BatchActionBarProps {
  statusTab: string;
  viewMode: 'orders' | 'items' | 'aggregate';
  selectedOrderCount: number;
  selectedItemCount: number;
  selectedAggregateCount: number;
  hasConsignmentSelection: boolean;
  hasNormalSelection: boolean;
  allSelectedConsignment: boolean;
  onConfirmOrders: () => void;
  onShipItems: () => void;
  onCancelItems: () => void;
  onDirectShipOrders: () => void;
  onConvertToConsignment: () => void;
  onShipOrdersToPool: () => void;
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
  hasConsignmentSelection,
  hasNormalSelection,
  allSelectedConsignment,
  onConfirmOrders,
  onShipItems,
  onCancelItems,
  onDirectShipOrders,
  onConvertToConsignment,
  onShipOrdersToPool,
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
    <>
      {/* Desktop: Floating pill */}
      <div className="hidden md:flex fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
        <div className="bg-primary text-primary-foreground px-6 py-4 rounded-full shadow-2xl flex items-center gap-6 border-4 border-background/20 ring-1 ring-primary/30">
          <div className="flex items-center gap-2 border-r border-primary-foreground/30 pr-6">
            <Package className="h-5 h-5" />
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
                className="rounded-full shadow-inner active:scale-95 transition-colors duration-150"
              >
                <CheckSquare className="h-4 w-4 mr-2" />
                確認轉處理中
              </Button>
            )}

            {statusTab === 'processing' && viewMode === 'orders' && (
              <>
                {hasNormalSelection && (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={onDirectShipOrders}
                      disabled={isLoading}
                      className="rounded-full shadow-inner active:scale-95 transition-colors duration-150"
                    >
                      <Send className="h-4 w-4 mr-2" />
                      轉銷貨單
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={onConvertToConsignment}
                      disabled={isLoading}
                      className="rounded-full shadow-inner active:scale-95 transition-colors duration-150"
                    >
                      <Store className="h-4 w-4 mr-2" />
                      轉寄賣
                    </Button>
                    {hasConsignmentSelection && <span className="w-px h-6 bg-primary-foreground/30" />}
                  </>
                )}
                {hasConsignmentSelection && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={onDirectShipOrders}
                    disabled={isLoading}
                    className="rounded-full shadow-inner active:scale-95 transition-colors duration-150"
                  >
                    <Send className="h-4 w-4 mr-2" />
                    寄賣出貨
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onShipOrdersToPool}
                  disabled={isLoading}
                  className="rounded-full shadow-inner active:scale-95 transition-colors duration-150"
                >
                  <Truck className="h-4 w-4 mr-2" />
                  轉出貨池
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onConvertToPO}
                  disabled={isLoading}
                  className="rounded-full shadow-inner active:scale-95 transition-colors duration-150"
                >
                  <ClipboardList className="h-4 w-4 mr-2" />
                  轉採購單
                </Button>
              </>
            )}

            {viewMode === 'items' && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onShipItems}
                  disabled={isLoading}
                  className="rounded-full shadow-inner active:scale-95 transition-colors duration-150"
                >
                  <Truck className="h-4 w-4 mr-2" />
                  加入出貨池
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={onCancelItems}
                  disabled={isLoading}
                  className="rounded-full shadow-lg hover:bg-red-600 active:scale-95 transition-colors duration-150"
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
                  className="rounded-full shadow-inner active:scale-95 transition-colors duration-150"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  匯出 CSV
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onExportAggregateExcel}
                  disabled={isLoading}
                  className="rounded-full shadow-inner active:scale-95 transition-colors duration-150"
                >
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  匯出 Excel
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onConvertToPO}
                  disabled={isLoading}
                  className="rounded-full shadow-inner active:scale-95 transition-colors duration-150"
                >
                  <ClipboardList className="h-4 w-4 mr-2" />
                  轉採購單
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Mobile: Full-width bottom bar */}
      <MobileFooter visible={true} className="!z-50">
        <div className="flex items-center gap-3 mb-3">
          <Package className="h-4 w-4 shrink-0" />
          <span className="font-semibold text-sm truncate">
            已選擇 {getCount()} {getLabel()}
          </span>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 snap-x snap-mandatory">
          {statusTab === 'pending' && viewMode === 'orders' && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onConfirmOrders}
              disabled={isLoading}
              className="snap-start shrink-0"
            >
              <CheckSquare className="h-4 w-4 mr-1.5" />
              確認轉處理中
            </Button>
          )}

          {statusTab === 'processing' && viewMode === 'orders' && (
            <>
              {hasNormalSelection && (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={onDirectShipOrders}
                    disabled={isLoading}
                    className="snap-start shrink-0"
                  >
                    <Send className="h-4 w-4 mr-1.5" />
                    轉銷貨單
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={onConvertToConsignment}
                    disabled={isLoading}
                    className="snap-start shrink-0"
                  >
                    <Store className="h-4 w-4 mr-1.5" />
                    轉寄賣
                  </Button>
                </>
              )}
              {hasConsignmentSelection && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onDirectShipOrders}
                  disabled={isLoading}
                  className="snap-start shrink-0"
                >
                  <Send className="h-4 w-4 mr-1.5" />
                  寄賣出貨
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={onShipOrdersToPool}
                disabled={isLoading}
                className="snap-start shrink-0"
              >
                <Truck className="h-4 w-4 mr-1.5" />
                轉出貨池
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={onConvertToPO}
                disabled={isLoading}
                className="snap-start shrink-0"
              >
                <ClipboardList className="h-4 w-4 mr-1.5" />
                轉採購單
              </Button>
            </>
          )}

          {viewMode === 'items' && (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={onShipItems}
                disabled={isLoading}
                className="snap-start shrink-0"
              >
                <Truck className="h-4 w-4 mr-1.5" />
                加入出貨池
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={onCancelItems}
                disabled={isLoading}
                className="snap-start shrink-0"
              >
                <XCircle className="h-4 w-4 mr-1.5" />
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
                className="snap-start shrink-0"
              >
                <FileText className="h-4 w-4 mr-1.5" />
                匯出 CSV
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={onExportAggregateExcel}
                disabled={isLoading}
                className="snap-start shrink-0"
              >
                <FileSpreadsheet className="h-4 w-4 mr-1.5" />
                匯出 Excel
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={onConvertToPO}
                disabled={isLoading}
                className="snap-start shrink-0"
              >
                <ClipboardList className="h-4 w-4 mr-1.5" />
                轉採購單
              </Button>
            </>
          )}
        </div>
      </MobileFooter>
    </>
  );
}
