import { useState } from 'react';
import { useConsignment } from '../hooks/useConsignment';
import { ConsignmentSalesReport } from '../types';
import { Button } from '@/components/ui/button';
import { Check, X, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/formatters';

interface ReportsTabProps {
  reports: ConsignmentSalesReport[];
  isLoading: boolean;
  confirmedReports?: ConsignmentSalesReport[];
  confirmedLoading?: boolean;
}

export function ReportsTab({ reports, isLoading, confirmedReports = [], confirmedLoading = false }: ReportsTabProps) {
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

  return (
    <div className="space-y-6">
      {/* 待審核 */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            待審核回報：共 {reports.length} 筆{selectedIds.length > 0 && `，已選 ${selectedIds.length} 筆`}
          </p>
          <Button onClick={handleConfirmAll} disabled={selectedIds.length === 0 || confirmReportsMutation.isPending}>
            <Check className="h-4 w-4 mr-1" />
            確認所選（{selectedIds.length}）
          </Button>
        </div>

        {reports.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-lg">
            <Check className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">目前沒有待審核的銷售回報</p>
          </div>
        ) : (
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
                      {report.item?.variant?.name || report.item?.product?.name || '-'}
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
        )}
      </div>

      {/* 已審核 */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <p className="text-sm font-medium">已審核回報（最近 100 筆）</p>
        </div>
        {confirmedLoading ? (
          <div className="text-center py-6 text-muted-foreground">載入中...</div>
        ) : confirmedReports.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground border-2 border-dashed rounded-lg">
            <p className="text-sm">尚無已審核的銷售回報</p>
          </div>
        ) : (
          <div className="border rounded-md overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left py-2 px-3 font-medium">寄賣單</th>
                  <th className="text-left py-2 px-3 font-medium">店家</th>
                  <th className="text-left py-2 px-3 font-medium">商品</th>
                  <th className="text-right py-2 px-3 font-medium w-16">數量</th>
                  <th className="text-right py-2 px-3 font-medium w-28">售價</th>
                  <th className="text-right py-2 px-3 font-medium w-32">審核時間</th>
                </tr>
              </thead>
              <tbody>
                {confirmedReports.map((report) => (
                  <tr key={report.id} className="border-b last:border-0">
                    <td className="py-2 px-3 font-mono text-xs">
                      {report.consignment_order?.code || report.consignment_order_id.slice(0, 8)}
                    </td>
                    <td className="py-2 px-3">{report.store?.name || '-'}</td>
                    <td className="py-2 px-3">
                      {report.item?.variant?.name || report.item?.product?.name || '-'}
                    </td>
                    <td className="text-right py-2 px-3 font-medium">{report.quantity}</td>
                    <td className="text-right py-2 px-3">
                      {report.sale_price != null
                        ? formatCurrency(report.sale_price)
                        : <span className="text-muted-foreground">依預設</span>}
                    </td>
                    <td className="text-right py-2 px-3 text-xs">
                      {report.confirmed_at ? new Date(report.confirmed_at).toLocaleString('zh-TW') : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}