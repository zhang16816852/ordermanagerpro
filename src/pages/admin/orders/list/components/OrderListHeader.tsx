import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Package, FileText, ClipboardList, PlusCircle, FileUp } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { OrderFilters } from './OrderFilters';
import type {
  AggregateFilterMode,
  OrderStatusTab,
  OrderViewMode,
} from '../orderListTypes';
import type { BusinessFilter } from '../useOrderListDerived';

interface OrderListHeaderProps {
  isRep: boolean;
  statusTab: OrderStatusTab;
  onStatusTabChange: (v: OrderStatusTab) => void;
  viewMode: OrderViewMode;
  onViewModeChange: (v: OrderViewMode) => void;
  aggStatus: AggregateFilterMode;
  onAggStatusChange: (v: AggregateFilterMode) => void;
  search: string;
  onSearchChange: (v: string) => void;
  storeFilter: string;
  onStoreFilterChange: (v: string) => void;
  stores: any[];
  dateFrom: string;
  onDateFromChange: (v: string) => void;
  dateTo: string;
  onDateToChange: (v: string) => void;
  poFilter: 'all' | 'has_po' | 'no_po';
  onPoFilterChange: (v: 'all' | 'has_po' | 'no_po') => void;
  /** 有業務／無業務門市篩選（以 rep_store_assignments 判定） */
  businessFilter: BusinessFilter;
  onBusinessFilterChange: (v: BusinessFilter) => void;
  repFilter: string;
  onRepFilterChange: (v: string) => void;
  reps: any[];
  onExportCSV: () => void;
  syncPending: boolean;
  onSync: () => void;
  onImportOrders?: () => void;
}

export function OrderListHeader({
  isRep,
  statusTab,
  onStatusTabChange,
  viewMode,
  onViewModeChange,
  aggStatus,
  onAggStatusChange,
  search,
  onSearchChange,
  storeFilter,
  onStoreFilterChange,
  stores,
  dateFrom,
  onDateFromChange,
  dateTo,
  onDateToChange,
  poFilter,
  onPoFilterChange,
  businessFilter,
  onBusinessFilterChange,
  repFilter,
  onRepFilterChange,
  reps,
  onExportCSV,
  syncPending,
  onSync,
  onImportOrders,
}: OrderListHeaderProps) {
  const navigate = useNavigate();

  return (
    <>
      <PageHeader
        title="所有訂單"
        subtitle="查看與管理系統中的所有訂單"
        icon={<ClipboardList className="h-5 w-5" />}
        actions={
          <>
            <Button onClick={() => navigate('/admin/orders/checkout')} size="sm" variant="outline">
              <PlusCircle className="mr-2 h-4 w-4" /> 建立新單據
            </Button>
            <Button onClick={onExportCSV} variant="outline" size="sm">
              <FileText className="mr-2 h-4 w-4" /> 匯出 CSV
            </Button>
            {!isRep && onImportOrders && (
              <Button onClick={onImportOrders} variant="outline" size="sm">
                <FileUp className="mr-2 h-4 w-4" /> 匯入
              </Button>
            )}
            <Button onClick={onSync} variant="outline" size="sm" disabled={syncPending}>
              <Package className="mr-2 h-4 w-4" /> 同步舊訂單狀態
            </Button>
          </>
        }
      />

      <OrderFilters
        statusTab={statusTab}
        onStatusTabChange={onStatusTabChange}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        aggStatus={aggStatus}
        onAggStatusChange={onAggStatusChange}
        search={search}
        onSearchChange={onSearchChange}
        storeFilter={storeFilter}
        onStoreFilterChange={onStoreFilterChange}
        stores={stores}
        dateFrom={dateFrom}
        onDateFromChange={onDateFromChange}
        dateTo={dateTo}
        onDateToChange={onDateToChange}
        poFilter={poFilter}
        onPoFilterChange={onPoFilterChange}
        businessFilter={businessFilter}
        onBusinessFilterChange={onBusinessFilterChange}
        repFilter={repFilter}
        onRepFilterChange={onRepFilterChange}
        reps={reps}
      />
    </>
  );
}