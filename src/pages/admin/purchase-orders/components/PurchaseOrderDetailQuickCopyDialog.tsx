import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import type { PurchaseOrderItem } from '../types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  localItems: PurchaseOrderItem[];
  sourceOrderStoreMap: Record<string, string>;
  supplierMappingMap: Record<string, { vendor_product_id?: string }>;
}

const getMappingKey = (item: PurchaseOrderItem) => `${item.product_id}_${item.variant_id || 'null'}`;

export function PurchaseOrderDetailQuickCopyDialog({
  open,
  onOpenChange,
  localItems,
  sourceOrderStoreMap,
  supplierMappingMap,
}: Props) {
  const [connector, setConnector] = useState('');
  const [view, setView] = useState<'items' | 'byStore'>('items');
  const [copied, setCopied] = useState(false);

  const lines =
    view === 'byStore'
      ? buildByStoreRows(localItems, sourceOrderStoreMap).map((r) => {
          const mapping = supplierMappingMap[getMappingKey(r.item)];
          const code = mapping?.vendor_product_id || '';
          return `${code},${r.quantity}`;
        })
      : localItems.map((item) => {
          const mapping = supplierMappingMap[getMappingKey(item)];
          const code = mapping?.vendor_product_id || '';
          return `${code},${item.quantity}`;
        });

  const text = connector ? lines.map((l) => `${l}${connector}`).join('') : lines.join('\n');

  const handleCopy = async () => {
    if (!text) {
      toast.error('無可複製內容');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success('已複製到剪貼簿');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('複製失敗，請手動選取');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>快速複製（廠商代碼,數量）</DialogTitle>
          <DialogDescription>每行格式：廠商代碼,數量；可直接複製貼上。</DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2">
          <div className="inline-flex rounded-md border p-0.5">
            <Button size="sm" variant={view === 'items' ? 'default' : 'ghost'} className="h-7 px-2" onClick={() => setView('items')}>
              品項
            </Button>
            <Button size="sm" variant={view === 'byStore' ? 'default' : 'ghost'} className="h-7 px-2" onClick={() => setView('byStore')}>
              依店家
            </Button>
          </div>
          <span className="text-xs text-muted-foreground">共 {lines.length} 行 / {text.length} 字元</span>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm whitespace-nowrap">行尾連接符：</label>
          <Input
            className="h-8"
            value={connector}
            onChange={(e) => setConnector(e.target.value)}
            placeholder="例如 , 或 ;（留空則分行）"
          />
        </div>

        <textarea
          readOnly
          onClick={(e) => (e.target as HTMLTextAreaElement).select()}
          className="w-full h-64 rounded-md border bg-muted/30 p-2 font-mono text-sm"
          value={text}
        />

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>關閉</Button>
          <Button onClick={handleCopy} disabled={!text}>
            {copied ? '✓ 已複製' : '複製'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// 依店家拆分 rows（複製自原 Dialog，保持一致）
interface ByStoreRow {
  store: string;
  item: PurchaseOrderItem;
  quantity: number;
  received: number;
  sourceOrderIds: string[];
}

function buildByStoreRows(items: PurchaseOrderItem[], sourceOrderStoreMap: Record<string, string>): ByStoreRow[] {
  const rows: ByStoreRow[] = [];
  for (const item of items) {
    const sources = item.source_order_ids || [];
    if (sources.length === 0) {
      rows.push({ store: '無來源訂單', item, quantity: item.quantity, received: item.received_quantity, sourceOrderIds: [] });
      continue;
    }
    const storeQty: Record<string, number> = {};
    const storeOrder: string[] = [];
    const sq = item.source_quantities;
    const hasQty = !!sq && sources.some((sid) => sq[sid] != null);
    if (hasQty) {
      for (const sid of sources) {
        const store = sourceOrderStoreMap[sid] || '未指定店家';
        if (!(store in storeQty)) storeOrder.push(store);
        storeQty[store] = (storeQty[store] || 0) + (sq![sid] ?? 0);
      }
    } else {
      const seen = new Set<string>();
      for (const sid of sources) {
        const store = sourceOrderStoreMap[sid] || '未指定店家';
        if (seen.has(store)) continue;
        seen.add(store);
        storeOrder.push(store);
      }
      const n = storeOrder.length || 1;
      const base = Math.floor(item.quantity / n);
      let rem = item.quantity - base * n;
      for (const store of storeOrder) {
        storeQty[store] = base + (rem > 0 ? 1 : 0);
        if (rem > 0) rem -= 1;
      }
    }
    const total = Object.values(storeQty).reduce((a, b) => a + b, 0);
    const receivedByStore: Record<string, number> = {};
    if (total > 0 && item.received_quantity > 0) {
      let allocated = 0;
      for (const store of storeOrder) {
        const q = storeQty[store] || 0;
        const r = Math.floor((item.received_quantity * q) / total);
        receivedByStore[store] = r;
        allocated += r;
      }
      let remR = item.received_quantity - allocated;
      for (const store of storeOrder) {
        if (remR <= 0) break;
        receivedByStore[store] += 1;
        remR -= 1;
      }
    } else {
      for (const store of storeOrder) receivedByStore[store] = 0;
      if (storeOrder.length > 0) receivedByStore[storeOrder[0]] = item.received_quantity;
    }
    for (const store of storeOrder) {
      const storeSourceIds = sources.filter((sid) => (sourceOrderStoreMap[sid] || '未指定店家') === store);
      rows.push({
        store,
        item,
        quantity: storeQty[store] || 0,
        received: receivedByStore[store] || 0,
        sourceOrderIds: storeSourceIds,
      });
    }
    const sourceQtyTotal = Object.values(storeQty).reduce((a, b) => a + b, 0);
    const inventoryQty = Math.max(0, item.quantity - sourceQtyTotal);
    if (inventoryQty > 0) {
      rows.push({
        store: '庫存',
        item,
        quantity: inventoryQty,
        received: 0,
        sourceOrderIds: [],
      });
    }
  }
  return rows;
}