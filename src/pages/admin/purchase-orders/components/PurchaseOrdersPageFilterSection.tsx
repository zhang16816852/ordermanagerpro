import { OrderFilterBar } from './OrderFilterBar';
import { PurchaseOrdersPageSummary } from './PurchaseOrdersPageSummary';
import type { PurchaseOrderFilters } from '../hooks/usePurchaseOrders';
import type { Supplier } from '../types';
import type { PoSortField } from '../orderSort';

interface Props {
  suppliers: Supplier[];
  filters: PurchaseOrderFilters;
  onFiltersChange: (patch: PurchaseOrderFilters) => void;
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
}

export function PurchaseOrdersPageFilterSection({
  suppliers,
  filters,
  onFiltersChange,
  onClearFilters,
  sortField,
  sortDir,
  onSortFieldChange,
  onToggleSortDir,
  showPaidFilter,
  paidFilter,
  onPaidFilterChange,
  isLoading,
  summary,
}: Props) {
  return (
    <div className="space-y-3">
      <OrderFilterBar
        suppliers={suppliers}
        filters={filters}
        onFiltersChange={onFiltersChange}
        onClearFilters={onClearFilters}
        sortField={sortField}
        sortDir={sortDir}
        onSortFieldChange={onSortFieldChange}
        onToggleSortDir={onToggleSortDir}
        showPaidFilter={showPaidFilter}
        paidFilter={paidFilter}
        onPaidFilterChange={onPaidFilterChange}
      />
      {!isLoading && summary && summary.count > 0 && (
        <PurchaseOrdersPageSummary
          count={summary.count}
          total={summary.total}
          paid={summary.paid}
          unpaid={summary.unpaid}
          unpaidCount={summary.unpaidCount}
          canSeePayments={showPaidFilter}
        />
      )}
    </div>
  );
}