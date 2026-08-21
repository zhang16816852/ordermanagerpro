import { useState } from 'react';
import { useConsignment } from '../hooks/useConsignment';
import { ConsignmentSalesReport } from '../types';
import { Button } from '@/components/ui/button';
import { Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/formatters';

interface ReportsTabProps {
  reports: ConsignmentSalesReport[];
  isLoading: boolean;
}

export function ReportsTab({ reports, isLoading }: ReportsTabProps) {
  const { confirmReportsMutation, rejectReportMutation } = useConsignment();
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const selectedIds = Object.keys(selected).filter(id => selected[id]);

  const handleConfirmAll = () => {
    if (selectedIds.length === 0) {
      toast.warning('請先勾選要審核的回報');
      return;
    }
    confirmReportsMutation.mutate(selectedIds, {
      onSuccess: () => setSelected({}),
    });
  };

  const handleConfirmOne = (report: ConsignmentSalesReport) => {
    confirmReportsMutation.mutate([report.id], {
      onSuccess: () => setSelected({}),
    });
  };

  const handleRejectOne = (report: ConsignmentSalesReport) => {
    if (!confirm('確定要駁回此銷售回報嗎？')) return;
    rejectReportMutation.mutate(report.id);
  };

  if (isLoading) {
    return <div className="text-center py-12 text-muted-foreground">載入中...</div>;
  }

  if (reports.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground border-2 border-dashed rounded-lg">
        <Check className="h-12 w-12 mx-auto mb-4 opacity-30" />
        <p className="text-lg font-medium">目前沒有待審核的銷售回報</p>
        <p className="text-sm">店家回報銷售後，會出現在此處進行確認</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          共 {reports.length} 筆待審核回報{selectedIds.length > 0 && `，已選 ${selectedIds.length} 筆`}
        </p>
        <Button onClick={handleConfirmAll} disabled={selectedIds.length === 0 || confirmReportsMutation.isPending}>
          <Check className="h-4 w-4 mr-1" />
          確認所選（{selectedIds.length}）
        </Button>
      </div>

      <div className="border rounded-md overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="py-2 px-3 w-10">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={reports.length > 0 && selectedIds.length === reports.length}
                  onChange={(e) => {
                    if (e.target.checked) {
                      const all: Record<string, boolean> = {};
                      reports.forEach(r => { all[r.id] = true; });
                      setSelected(all);
                    } else {
                      setSelected({});
                    }
                  }}
                />
              </th>
              <th className="text-left py-2 px-3 font-medium">寄賣單</th>
              <th className="text-left py-2 px-3 font-medium">店家</th>
              <th className="text-left py-2 px-3 font-medium">商品</th>
              <th className="text-right py-2 px-3 font-medium w-16">數量</th>
              <th className="text-right py-2 px-3 font-medium w-28">售價</th>
              <th className="text-right py-2 px-3 font-medium w-32">回報時間</th>
              <th className="text-right py-2 px-3 font-medium w-32">操作</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((report) => (
              <tr key={report.id} className="border-b last:border-0">
                <td className="py-2 px-3">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={!!selected[report.id]}
                    onChange={(e) => setSelected(prev => ({ ...prev, [report.id]: e.target.checked }))}
                  />
                </td>
                <td className="py-2 px-3 font-mono text-xs">
                  {report.consignment_order?.code || report.consignment_order_id.slice(0, 8)}
                </td>
                <td className="py-2 px-3">{report.store?.name || '-'}</td>
                <td className="py-2 px-3">
                  {report.item?.product?.name || '-'}
                  {report.item?.variant?.name && (
                    <span className="text-xs text-muted-foreground ml-1">({report.item.variant.name})</span>
                  )}
                </td>
                <td className="text-right py-2 px-3 font-medium">{report.quantity}</td>
                <td className="text-right py-2 px-3">
                  {report.sale_price != null
                    ? formatCurrency(report.sale_price)
                    : <span className="text-muted-foreground">依預設</span>}
                </td>
                <td className="text-right py-2 px-3 text-xs">
                  {new Date(report.created_at).toLocaleString('zh-TW')}
                </td>
                <td className="py-2 px-3">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="outline" className="text-green-600 border-green-500 hover:bg-green-50"
                      onClick={() => handleConfirmOne(report)} disabled={confirmReportsMutation.isPending}>
                      <Check className="h-3.5 w-3.5 mr-1" />確認
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive"
                      onClick={() => handleRejectOne(report)} disabled={rejectReportMutation.isPending}
                      aria-label="駁回回報">
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
