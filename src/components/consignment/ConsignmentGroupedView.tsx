import { useMemo, useState, type ReactNode } from 'react';
import { ConsignmentOrdersView } from './ConsignmentOrdersView';
import { ConsignmentProductsView } from './ConsignmentProductsView';
import { ViewToolbar } from './consignmentViewParts';
import {
  buildPartnerGroups,
  buildPivotGroups,
  type CollapseApi,
  type ColumnMode,
  type ViewMode,
} from './consignmentViewData';
import type {
  ConsignmentProductRow,
  ConsignmentViewItem,
  ConsignmentViewItemSummary,
  ConsignmentViewOrder,
} from './consignmentViewTypes';

export interface ConsignmentGroupedViewProps<T extends ConsignmentViewOrder> {
  orders: T[];
  summaries: Record<string, ConsignmentViewItemSummary>;
  isLoading: boolean;
  onView?: (order: T) => void;
  renderOrderActions?: (order: T) => ReactNode;
  renderItemActions?: (
    order: T,
    item: ConsignmentViewItem,
    summary?: ConsignmentViewItemSummary
  ) => ReactNode;
  renderProductActions?: (product: ConsignmentProductRow) => ReactNode;
  emptyState?: ReactNode;
}

export function ConsignmentGroupedView<T extends ConsignmentViewOrder>({
  orders,
  summaries,
  isLoading,
  onView,
  renderOrderActions,
  renderItemActions,
  renderProductActions,
  emptyState,
}: ConsignmentGroupedViewProps<T>) {
  const [viewMode, setViewMode] = useState<ViewMode>('orders');
  const [collapsedIds, setCollapsedIds] = useState<Record<string, boolean>>({});
  const [columnMode, setColumnMode] = useState<ColumnMode>('all');

  // collapsedIds 僅記錄「明確 override」；未記錄者桌機預設展開、手機預設收合
  const desktopCollapse = useMemo<CollapseApi>(
    () => ({
      isCollapsed: (orderId) => !!collapsedIds[orderId],
      toggle: (orderId) => setCollapsedIds((prev) => ({ ...prev, [orderId]: !prev[orderId] })),
    }),
    [collapsedIds]
  );
  const mobileCollapse = useMemo<CollapseApi>(
    () => ({
      isCollapsed: (orderId) => collapsedIds[orderId] ?? true,
      toggle: (orderId) =>
        setCollapsedIds((prev) => ({ ...prev, [orderId]: !(prev[orderId] ?? true) })),
    }),
    [collapsedIds]
  );

  const toggleAll = (collapsed: boolean) => {
    setCollapsedIds((prev) => {
      const next: Record<string, boolean> = {};
      for (const order of orders) next[order.id] = collapsed;
      return next;
    });
  };

  const groups = useMemo(
    () => buildPartnerGroups(orders, summaries),
    [orders, summaries]
  );
  const pivotGroups = useMemo(
    () => buildPivotGroups(groups, summaries),
    [groups, summaries]
  );

  if (isLoading) {
    return (
      <div className="border rounded-md">
        <div className="p-8 text-center text-muted-foreground" role="status" aria-live="polite">
          載入中…
        </div>
      </div>
    );
  }

  if (groups.length === 0) {
    if (emptyState) return <>{emptyState}</>;
    return (
      <div className="border rounded-md">
        <div className="p-8 text-center text-muted-foreground italic">目前無寄賣紀錄</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ViewToolbar
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        columnMode={columnMode}
        onColumnModeChange={setColumnMode}
        columnToggleOnMobile={viewMode === 'orders'}
        showExpandAll={viewMode === 'orders'}
        onToggleAll={toggleAll}
      />

      {viewMode === 'orders' ? (
        <ConsignmentOrdersView<T>
          groups={groups}
          summaries={summaries}
          columnMode={columnMode}
          desktopCollapse={desktopCollapse}
          mobileCollapse={mobileCollapse}
          onView={onView}
          renderOrderActions={renderOrderActions}
          renderItemActions={renderItemActions}
        />
      ) : (
        <ConsignmentProductsView<T>
          pivotGroups={pivotGroups}
          columnMode={columnMode}
          renderProductActions={renderProductActions}
        />
      )}
    </div>
  );
}
