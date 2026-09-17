import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Plus, Package, FileText, ClipboardList, PlusCircle } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { OrderFilters } from './OrderFilters';
import type {
  OrderStatusTab,
  OrderViewMode,
} from '../orderListTypes';

interface OrderListHeaderProps {
  isRep: boolean;
  statusTab: OrderStatusTab;
  onStatusTabChange: (v: OrderStatusTab) => void;
  viewMode: OrderViewMode;
  onViewModeChange: (v: OrderViewMode) => void;
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
  repFilter: string;
  onRepFilterChange: (v: string) => void;
  reps: any[];
  onExportCSV: () => void;
  syncPending: boolean;
  onSync: () => void;
}

export function OrderListHeader({
  isRep,
  statusTab,
  onStatusTabChange,
  viewMode,
  onViewModeChange,
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
  repFilter,
  onRepFilterChange,
  reps,
  onExportCSV,
  syncPending,
  onSync,
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
            {!isRep && (
              <Button onClick={() => navigate('/admin/orders/new')} size="sm">
                <Plus className="mr-2 h-4 w-4" /> 代訂訂單
              </Button>
            )}
            <Button onClick={onExportCSV} variant="outline" size="sm">
              <FileText className="mr-2 h-4 w-4" /> 匯出 CSV
            </Button>
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
        repFilter={repFilter}
        onRepFilterChange={onRepFilterChange}
        reps={reps}
      />
    </>
  );
}