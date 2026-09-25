import { type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, ChevronRight, Eye } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { GroupFooter, PartnerHeader, ReceivedBadge, StatusBadge } from './consignmentViewParts';
import {
  deliveredOf,
  orderTotals,
  type CollapseApi,
  type ColumnMode,
  type PartnerGroup,
} from './consignmentViewData';
import type {
  ConsignmentViewItem,
  ConsignmentViewItemSummary,
  ConsignmentViewOrder,
} from './consignmentViewTypes';

export interface ConsignmentOrdersViewProps<T extends ConsignmentViewOrder> {
  groups: PartnerGroup<T>[];
  summaries: Record<string, ConsignmentViewItemSummary>;
  columnMode: ColumnMode;
  /** 桌機預設展開 */
  desktopCollapse: CollapseApi;
  /** 手機預設收合 */
  mobileCollapse: CollapseApi;
  onView?: (order: T) => void;
  renderOrderActions?: (order: T) => ReactNode;
  renderItemActions?: (
    order: T,
    item: ConsignmentViewItem,
    summary?: ConsignmentViewItemSummary
  ) => ReactNode;
}

export function ConsignmentOrdersView<T extends ConsignmentViewOrder>({
  groups,
  summaries,
  columnMode,
  desktopCollapse,
  mobileCollapse,
  onView,
  renderOrderActions,
  renderItemActions,
}: ConsignmentOrdersViewProps<T>) {
  return (
    <>
      {groups.map((group) => (
        <div key={`${group.kind}:${group.partnerId}`} className="border rounded-lg bg-card shadow-soft">
          <PartnerHeader group={group} />
          <div className="p-2">{group.orders.map((order) => (
            <OrderBlock<T>
              key={order.id}
              order={order}
              summaries={summaries}
              columnMode={columnMode}
              desktopCollapse={desktopCollapse}
              mobileCollapse={mobileCollapse}
              onView={onView}
              renderOrderActions={renderOrderActions}
              renderItemActions={renderItemActions}
            />
          ))}</div>
          <GroupFooter group={group} columnMode={columnMode} />
        </div>
      ))}
    </>
  );
}

function OrderBlock<T extends ConsignmentViewOrder>({
  order,
  summaries,
  columnMode,
  desktopCollapse,
  mobileCollapse,
  onView,
  renderOrderActions,
  renderItemActions,
}: {
  order: T;
  summaries: Record<string, ConsignmentViewItemSummary>;
  columnMode: ColumnMode;
  desktopCollapse: CollapseApi;
  mobileCollapse: CollapseApi;
  onView?: (order: T) => void;
  renderOrderActions?: (order: T) => ReactNode;
  renderItemActions?: (
    order: T,
    item: ConsignmentViewItem,
    summary?: ConsignmentViewItemSummary
  ) => ReactNode;
}) {
  const items = order.items || [];
  const isStore = order.direction === 'send_to_store';
  const { total, delivered: orderDelivered, remaining: orderRemaining } = orderTotals(
    items,
    summaries,
    isStore
  );
  const dateValue = order.shipped_at || order.created_at;
  const dateLabel = dateValue ? new Date(dateValue).toLocaleDateString('zh-TW') : '-';
  const hasItemActions = !!renderItemActions;
  const itemColSpan = (columnMode === 'all' ? 5 : 3) + (hasItemActions ? 1 : 0);

  return (
    <div className="space-y-2 md:space-y-0">
      {/* 桌機：品項以表格呈現 */}
      <div className="hidden md:block rounded-md hover:bg-muted/40 transition-colors">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <button
            type="button"
            className="flex flex-1 items-center gap-3 text-left min-w-0"
            onClick={() => desktopCollapse.toggle(order.id)}
            aria-expanded={!desktopCollapse.isCollapsed(order.id)}
          >
            {desktopCollapse.isCollapsed(order.id) ? (
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-mono text-xs font-medium">{order.code}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <StatusBadge status={order.status} />
                {order.received_at && <ReceivedBadge />}
                <span className="text-xs text-muted-foreground">{dateLabel}</span>
              </div>
            </div>
            <div className="text-right text-xs text-muted-foreground shrink-0">
              <span>剩餘 {orderRemaining} 件</span>
              {desktopCollapse.isCollapsed(order.id) && (
                <p className="font-semibold text-foreground text-sm mt-0.5">
                  {formatCurrency(total)}
                </p>
              )}
            </div>
          </button>

          {renderOrderActions?.(order)}
          {onView && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onView(order)}
              aria-label={`查看寄賣單 ${order.code}`}
            >
              <Eye className="h-3.5 w-3.5 mr-1" />查看
            </Button>
          )}
        </div>

        {!desktopCollapse.isCollapsed(order.id) && (
          <div className="px-3 pb-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y bg-muted/40">
                  <th className="text-left py-1.5 px-2 font-medium">商品</th>
                  <th className="text-right py-1.5 px-2 font-medium w-24">單價</th>
                  {columnMode === 'all' && (
                    <th className="text-right py-1.5 px-2 font-medium w-16">
                      {isStore ? '給貨' : '已收'}
                    </th>
                  )}
                  {columnMode === 'all' && (
                    <th className="text-right py-1.5 px-2 font-medium w-20">回報銷售</th>
                  )}
                  <th className="text-right py-1.5 px-2 font-medium w-20">剩餘數量</th>
                  {hasItemActions && (
                    <th className="text-right py-1.5 px-2 font-medium w-24">操作</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const s = summaries[item.id];
                  const itemDelivered = deliveredOf(s, isStore);
                  const sold = s?.sold_quantity || 0;
                  const remaining = s?.remaining_quantity ?? 0;
                  return (
                    <tr key={item.id} className="border-b last:border-0">
                      <td className="py-1.5 px-2">
                        {item.variant?.name || item.product?.name || '-'}
                      </td>
                      <td className="text-right py-1.5 px-2 text-muted-foreground">
                        {formatCurrency(item.unit_price)}
                      </td>
                      {columnMode === 'all' && (
                        <td className="text-right py-1.5 px-2">{itemDelivered}</td>
                      )}
                      {columnMode === 'all' && (
                        <td className="text-right py-1.5 px-2">{sold}</td>
                      )}
                      <td className="text-right py-1.5 px-2 font-medium">{remaining}</td>
                      {hasItemActions && (
                        <td className="py-1.5 px-2 text-right">
                          {renderItemActions?.(order, item, s)}
                        </td>
                      )}
                    </tr>
                  );
                })}
                {items.length === 0 && (
                  <tr>
                    <td
                      colSpan={itemColSpan}
                      className="py-3 px-2 text-center text-muted-foreground"
                    >
                      無品項
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td className="py-1.5 px-2 text-muted-foreground">小計</td>
                  <td className="py-1.5 px-2" />
                  {columnMode === 'all' && (
                    <td className="text-right py-1.5 px-2 font-medium">{orderDelivered}</td>
                  )}
                  {columnMode === 'all' && <td className="py-1.5 px-2" />}
                  <td className="text-right py-1.5 px-2 font-medium">{orderRemaining}</td>
                  {hasItemActions && <td className="py-1.5 px-2" />}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* 手機：每單一張卡，品項預設收合 */}
      <Collapsible
        open={!mobileCollapse.isCollapsed(order.id)}
        onOpenChange={(open) => {
          if (!mobileCollapse.isCollapsed(order.id) === open) return;
          mobileCollapse.toggle(order.id);
        }}
      >
        <div className="md:hidden rounded-lg border bg-card shadow-soft">
          <div className="flex items-start gap-2 p-3">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex flex-1 items-start gap-2 text-left min-w-0"
                aria-label={`${mobileCollapse.isCollapsed(order.id) ? '展開' : '收合'}寄賣單 ${order.code} 品項`}
              >
                {mobileCollapse.isCollapsed(order.id) ? (
                  <ChevronRight className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronDown className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs font-medium">{order.code}</p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                    <StatusBadge status={order.status} />
                    {order.received_at && <ReceivedBadge />}
                    <span className="text-xs text-muted-foreground">{dateLabel}</span>
                  </div>
                </div>
                <div className="text-right text-xs text-muted-foreground shrink-0">
                  <span>剩餘 {orderRemaining} 件</span>
                  {mobileCollapse.isCollapsed(order.id) && (
                    <p className="font-semibold text-foreground text-sm mt-0.5">
                      {formatCurrency(total)}
                    </p>
                  )}
                </div>
              </button>
            </CollapsibleTrigger>
            {renderOrderActions?.(order)}
            {onView && (
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                onClick={() => onView(order)}
                aria-label={`查看寄賣單 ${order.code}`}
              >
                <Eye className="h-3.5 w-3.5 mr-1" />查看
              </Button>
            )}
          </div>

          <CollapsibleContent>
            <div className="px-3 pb-3 space-y-2">
              {items.length === 0 && (
                <p className="py-2 text-center text-xs text-muted-foreground">無品項</p>
              )}
              {items.map((item) => {
                const s = summaries[item.id];
                const itemDelivered = deliveredOf(s, isStore);
                const sold = s?.sold_quantity || 0;
                const remaining = s?.remaining_quantity ?? 0;
                return (
                  <div key={item.id} className="rounded-md border bg-muted/20 px-2.5 py-2">
                    <div className="flex items-start gap-2">
                      <p className="flex-1 min-w-0 text-sm break-words whitespace-normal">
                        {item.variant?.name || item.product?.name || '-'}
                      </p>
                      <p className="shrink-0 text-sm text-muted-foreground tabular-nums">
                        {formatCurrency(item.unit_price)}
                      </p>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {columnMode === 'all' && (
                        <span>
                          {isStore ? '給貨' : '已收'}{' '}
                          <span className="font-medium text-foreground tabular-nums">
                            {itemDelivered}
                          </span>
                        </span>
                      )}
                      {columnMode === 'all' && (
                        <span>
                          回報銷售{' '}
                          <span className="font-medium text-foreground tabular-nums">{sold}</span>
                        </span>
                      )}
                      <span>
                        剩餘{' '}
                        <span className="font-medium text-foreground tabular-nums">{remaining}</span>
                      </span>
                    </div>
                    {hasItemActions && (
                      <div className="mt-2 flex justify-end">
                        {renderItemActions?.(order, item, s)}
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="flex items-center justify-end gap-3 px-2.5 pt-1 text-xs">
                <span className="text-muted-foreground">小計</span>
                {columnMode === 'all' && (
                  <span className="text-muted-foreground">
                    {isStore ? '給貨' : '已收'}{' '}
                    <span className="font-medium text-foreground tabular-nums">
                      {orderDelivered}
                    </span>
                  </span>
                )}
                <span className="text-muted-foreground">
                  剩餘{' '}
                  <span className="font-medium text-foreground tabular-nums">{orderRemaining}</span>
                </span>
              </div>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </div>
  );
}
