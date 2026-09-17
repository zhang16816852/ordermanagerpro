import { REPAIR_ORDER_STATUS_LABELS } from '@/types/repair';
import { formatDate, formatCurrency } from '@/lib/formatters';

interface RepairReceiptProps {
  order: any;
  items: any[];
  finalPrice: number;
  printRef: React.RefObject<HTMLDivElement>;
}

export function RepairReceipt({ order, items, finalPrice, printRef }: RepairReceiptProps) {
  return (
    <div ref={printRef} className="bg-white p-6 max-w-[320px] mx-auto text-sm" style={{ fontFamily: 'monospace' }}>
      <div className="text-center border-b pb-3 mb-3">
        <h2 className="text-lg font-bold">維修收據</h2>
        <p className="text-xs text-gray-500">Repair Receipt</p>
      </div>

      <div className="mb-3 pb-3 border-b">
        <div className="flex justify-between">
          <span className="font-bold">單號:</span>
          <span>{order.code}</span>
        </div>
        <div className="flex justify-between">
          <span className="font-bold">日期:</span>
          <span>{formatDate(order.created_at)}</span>
        </div>
        <div className="flex justify-between">
          <span className="font-bold">狀態:</span>
          <span>{REPAIR_ORDER_STATUS_LABELS[order.status as keyof typeof REPAIR_ORDER_STATUS_LABELS]}</span>
        </div>
      </div>

      <div className="mb-3 pb-3 border-b">
        <div className="font-bold mb-1">客戶資訊</div>
        <div className="flex justify-between">
          <span>姓名:</span>
          <span>{order.customer_name}</span>
        </div>
        {order.customer_phone && (
          <div className="flex justify-between">
            <span>電話:</span>
            <span>{order.customer_phone}</span>
          </div>
        )}
      </div>

      <div className="mb-3 pb-3 border-b">
        <div className="font-bold mb-1">裝置資訊</div>
        <div className="flex justify-between">
          <span>型號:</span>
          <span>{order.device_model?.name || '-'}</span>
        </div>
        {order.device_color && (
          <div className="flex justify-between">
            <span>顏色:</span>
            <span>{order.device_color}</span>
          </div>
        )}
        {order.device_storage && (
          <div className="flex justify-between">
            <span>容量:</span>
            <span>{order.device_storage}</span>
          </div>
        )}
        {order.device_imei && (
          <div className="flex justify-between">
            <span>IMEI:</span>
            <span className="text-[10px]">{order.device_imei}</span>
          </div>
        )}
      </div>

      {order.reported_issue && (
        <div className="mb-3 pb-3 border-b">
          <div className="font-bold mb-1">問題描述</div>
          <p className="text-xs">{order.reported_issue}</p>
        </div>
      )}

      <div className="mb-3 pb-3 border-b">
        <div className="font-bold mb-1">維修項目</div>
        {items.length === 0 ? (
          <p className="text-xs text-gray-400 py-1">無維修項目</p>
        ) : (
          items.map((item: any, idx: number) => {
            const isPart = item.item_type === 'part' || (!item.item_type && !!(item.product_id || item.variant_id));
            const itemName = (isPart
              ? (item.part_name || item.variant?.name || (item.product?.name ? `${item.product.name}${item.variant?.name ? ` - ${item.variant.name}` : ''}` : '') || item.service_name)
              : (item.service_name || item.part_name)) || '維修項目';
            return (
              <div key={item.id || idx} className="flex justify-between text-xs py-0.5">
                <span className="flex-1">
                  {isPart ? '[零件]' : '[服務]'} {itemName}
                  {(item.quantity || 1) > 1 ? ` x${item.quantity}` : ''}
                </span>
                <span className="font-mono">{formatCurrency(((item.unit_price || 0) * (item.quantity || 1)))}</span>
              </div>
            );
          })
        )}
      </div>

      <div className="mb-3 pb-3 border-b">
        <div className="flex justify-between font-bold">
          <span>總金額</span>
          <span>{formatCurrency(finalPrice)}</span>
        </div>
        {order.discount > 0 && (
          <div className="flex justify-between text-xs text-gray-500">
            <span>折扣</span>
            <span>-{formatCurrency(order.discount)}</span>
          </div>
        )}
        {order.deposit > 0 && (
          <div className="flex justify-between text-xs">
            <span>已付定金</span>
            <span>{formatCurrency(order.deposit)}</span>
          </div>
        )}
        {order.deposit > 0 && (
          <div className="flex justify-between text-xs font-bold text-blue-600">
            <span>尚欠金額</span>
            <span>{formatCurrency(finalPrice - order.deposit)}</span>
          </div>
        )}
      </div>

      {order.diagnostic_result && (
        <div className="mb-3 pb-3 border-b">
          <div className="font-bold mb-1">檢測結果</div>
          <p className="text-xs">{order.diagnostic_result}</p>
        </div>
      )}

      <div className="text-center text-[10px] text-gray-400 mt-4">
        <p>感謝您的信任與支持</p>
        <p>如有任何問題請憑此單洽詢</p>
      </div>
    </div>
  );
}