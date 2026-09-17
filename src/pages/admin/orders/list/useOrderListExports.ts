import { exportToCSV } from '@/lib/exportUtils';
import { getDisplayProductName, getAggregateItemKey } from './orderListUtils';
import type { AggregateSelectionItem } from './orderListTypes';

interface UseOrderListExportsOptions {
  filteredOrders: any[];
  selectedAggregateItems: Map<string, AggregateSelectionItem>;
  aggregatedItems: any[];
  statusTab: string;
}

export function useOrderListExports({
  filteredOrders,
  selectedAggregateItems,
  aggregatedItems,
  statusTab,
}: UseOrderListExportsOptions) {
  const buildAggregateDownloadData = (item: AggregateSelectionItem) => {
    const agg = aggregatedItems.find(a => getAggregateItemKey(a.productId, a.variantId) === `${item.productId}_${item.variantId || 'null'}`);
    const storeDetail = agg?.storeBreakdown.map(s =>
      `${s.storeCode || s.storeName}: ${s.quantity}`
    ).join(', ') || '';
    return {
      '產品名稱': item.productName,
      'SKU': item.sku,
      '總需求量': item.maxQuantity,
      '叫貨量': item.quantity,
      '門市明細': storeDetail,
    };
  };

  const handleExportAggregateCSV = async () => {
    const data = Array.from(selectedAggregateItems.values()).map(buildAggregateDownloadData);
    await exportToCSV(data, `叫貨總覽_${statusTab}`);
  };

  const handleExportAggregateExcel = async () => {
    const data = Array.from(selectedAggregateItems.values()).map(buildAggregateDownloadData);
    const xlsx = await import('xlsx');
    const ws = xlsx.utils.json_to_sheet(data);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, '叫貨總覽');
    xlsx.writeFile(wb, `叫貨總覽_${statusTab}_${Date.now()}.xlsx`);
  };

  const handleExportOrdersCSV = async () => {
    const exportData: Record<string, any>[] = [];
    for (const o of filteredOrders) {
      const items = o.order_items || [];
      if (items.length === 0) {
        exportData.push({
          "訂單編號": o.code || '-',
          "店鋪名稱": o.stores?.name || '-',
          "狀態": o.status,
          "建立日期": new Date(o.created_at).toLocaleString(),
          "項目": '-',
          "數量": 0,
          "單價": 0,
          "小計": 0,
          "備註": o.notes || '-',
        });
      } else {
        for (const item of items) {
          const displayName = getDisplayProductName((item as any).product?.name, (item as any).product_variant?.name);
          exportData.push({
            "訂單編號": o.code || '-',
            "店鋪名稱": o.stores?.name || '-',
            "狀態": o.status,
            "建立日期": new Date(o.created_at).toLocaleString(),
            "項目": displayName,
            "數量": item.quantity,
            "單價": item.unit_price,
            "小計": item.quantity * item.unit_price,
            "備註": o.notes || '-',
          });
        }
      }
    }
    await exportToCSV(exportData, `訂單列表_${statusTab}`);
  };

  return {
    handleExportAggregateCSV,
    handleExportAggregateExcel,
    handleExportOrdersCSV,
  };
}