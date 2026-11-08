import { OrderListTab } from './OrderListTab';
import { PurchaseOrdersPageFilterSection } from './PurchaseOrdersPageFilterSection';
import { PurchaseOrdersPageBatchSection } from './PurchaseOrdersPageBatchSection';
import type { PurchaseOrder } from '../types';
import type { PoSortField } from '../orderSort';

interface Props {
  suppliers: any[];
  filters: any;
  onFiltersChange: (patch: any) => void;
  onClearFilters: () => void;
  sortField: PoSortField;
  sortDir: 'asc' | 'desc';
  onSortFieldChange: (f: PoSortField) => void;
  onToggleSortDir: () => void;
  showPaidFilter: boolean;
  paidFilter: 'all' | 'paid' | 'unpaid';
  onPaidFilterChange: (v: 'all' | 'paid' | 'unpaid') => void;
  isLoading: boolean;
  summary?: { count: number; total: number; paid: number; unpaid: number; unpaidCount: number };
  batchMode: boolean;
  onBatchModeChange: (on: boolean) => void;
  selectedCount: number;
  orderableCount: number;
  receivableCount: number;
  payableCount: number;
  canPay: boolean;
  isOrdering: boolean;
  isReceiving: boolean;
  isPaying: boolean;
  onOrder: () => void;
  onReceive: () => void;
  onPay: () => void;
  onClear: () => void;
  orders: PurchaseOrder[];
  onView: (order: PurchaseOrder) => void;
  onEdit: (order: PurchaseOrder) => void;
  onDelete: (id: string) => void;
  onStatusChange: (id: string, status: any) => void;
  paidAmountMap?: Record<string, number>;
  onSort: (field: PoSortField) => void;
  selectedIds: string[];
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: (ids: string[]) => void;
  batchLocked: boolean;
}

export function PurchaseOrdersPageOrdersTab(props: Props) {
  return (
    <div className="space-y-4">
      <PurchaseOrdersPageFilterSection
        suppliers={props.suppliers}
        filters={props.filters}
        onFiltersChange={props.onFiltersChange}
        onClearFilters={props.onClearFilters}
        sortField={props.sortField}
        sortDir={props.sortDir}
        onSortFieldChange={props.onSortFieldChange}
        onToggleSortDir={props.onToggleSortDir}
        showPaidFilter={props.showPaidFilter}
        paidFilter={props.paidFilter}
        onPaidFilterChange={props.onPaidFilterChange}
        isLoading={props.isLoading}
        summary={props.summary}
      />
      <PurchaseOrdersPageBatchSection
        batchMode={props.batchMode}
        onBatchModeChange={props.onBatchModeChange}
        selectedCount={props.selectedCount}
        orderableCount={props.orderableCount}
        receivableCount={props.receivableCount}
        payableCount={props.payableCount}
        canPay={props.canPay}
        isOrdering={props.isOrdering}
        isReceiving={props.isReceiving}
        isPaying={props.isPaying}
        onOrder={props.onOrder}
        onReceive={props.onReceive}
        onPay={props.onPay}
        onClear={props.onClear}
      />
      <OrderListTab
        orders={props.orders}
        onView={props.onView}
        onEdit={props.onEdit}
        onDelete={props.onDelete}
        onStatusChange={props.onStatusChange}
        isLoading={props.isLoading}
        paidAmountMap={props.paidAmountMap}
        sortField={props.sortField}
        sortDir={props.sortDir}
        onSort={props.onSort}
        batchMode={props.batchMode}
        selectedIds={props.selectedIds}
        onToggleSelect={props.onToggleSelect}
        onToggleSelectAll={props.onToggleSelectAll}
        batchLocked={props.batchLocked}
      />
    </div>
  );
}