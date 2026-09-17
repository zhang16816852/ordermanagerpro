import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DollarSign, Edit, Package, Truck, PackageCheck, Loader2 } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';

interface RepairItemsSectionProps {
  items: any[];
  hasUndeductedParts: boolean;
  isDeductingAll: boolean;
  deductPending: boolean;
  deductingItemId: string | null;
  onDeductAll: () => void;
  onDeductSingle: (item: any) => void;
  onEdit: () => void;
}

export function RepairItemsSection({
  items,
  hasUndeductedParts,
  isDeductingAll,
  deductPending,
  deductingItemId,
  onDeductAll,
  onDeductSingle,
  onEdit,
}: RepairItemsSectionProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <DollarSign className="h-4 w-4" />
          維修項目與用料
        </CardTitle>
        <div className="flex items-center gap-2">
          {hasUndeductedParts && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs text-amber-600 border-amber-300 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-700"
              onClick={onDeductAll}
              disabled={isDeductingAll}
            >
              {isDeductingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PackageCheck className="h-3.5 w-3.5" />}
              {isDeductingAll ? '出庫扣減中...' : '一鍵全數扣庫存'}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={onEdit}
          >
            <Edit className="h-3.5 w-3.5" />
            編輯項目
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground text-xs">
                <th className="text-left py-2 px-1 font-medium w-16">類型</th>
                <th className="text-left py-2 px-2 font-medium">項目名稱 / 零件材料</th>
                <th className="text-left py-2 px-2 font-medium">描述說明</th>
                <th className="text-center py-2 px-2 font-medium w-14">數量</th>
                <th className="text-right py-2 px-2 font-medium w-20">成本</th>
                <th className="text-right py-2 px-2 font-medium w-20">售價</th>
                <th className="text-right py-2 px-2 font-medium w-20">小計</th>
                <th className="text-center py-2 px-2 font-medium w-28">庫存狀態</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-muted-foreground">
                    <Package className="h-8 w-8 mx-auto mb-2 text-muted-foreground/30" />
                    <p className="text-sm">尚未新增維修項目或材料</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3 gap-1.5"
                      onClick={onEdit}
                    >
                      <Edit className="h-3.5 w-3.5" />
                      前往編輯添加項目
                    </Button>
                  </td>
                </tr>
              ) : (
                items.map((item: any, idx: number) => {
                  const isPart = item.item_type === 'part' || (!item.item_type && !!(item.product_id || item.variant_id));
                  const itemName = (isPart
                    ? (item.part_name || item.variant?.name || (item.product?.name ? `${item.product.name}${item.variant?.name ? ` - ${item.variant.name}` : ''}` : '') || item.service_name)
                    : (item.service_name || item.part_name)) || '未命名項目';

                  const isDeductingThis = deductingItemId === item.id;

                  return (
                    <tr key={item.id || idx} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                      <td className="py-2.5 px-1 align-top">
                        <Badge
                          variant={isPart ? 'default' : 'secondary'}
                          className="text-[10px] font-normal px-1.5 py-0 select-none"
                        >
                          {isPart ? '零件' : '服務'}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-2 align-top">
                        <div className="font-medium text-foreground flex items-center gap-1.5 flex-wrap">
                          <span>{itemName}</span>
                          {isPart && item.purchase_order_item_id && (
                            <Badge variant="outline" className="text-[10px] text-green-600 border-green-300 dark:text-green-400 gap-0.5 py-0 font-normal">
                              <Truck className="h-3 w-3" /> 已叫料
                            </Badge>
                          )}
                        </div>
                        {isPart && (item.product?.code || item.variant?.sku) && (
                          <div className="text-[11px] text-muted-foreground font-mono mt-0.5">
                            {item.product?.code ? `料號: ${item.product.code}` : ''}
                            {item.variant?.sku ? ` (${item.variant.sku})` : ''}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-2 align-top text-xs text-muted-foreground max-w-[180px]">
                        {item.description ? (
                          <span className="line-clamp-2">{item.description}</span>
                        ) : (
                          <span className="text-muted-foreground/30">-</span>
                        )}
                      </td>
                      <td className="py-2.5 px-2 align-top text-center font-medium">
                        {item.quantity}
                      </td>
                      <td className="py-2.5 px-2 align-top text-right font-mono text-xs text-muted-foreground">
                        {isPart ? formatCurrency(item.unit_cost || 0) : '-'}
                      </td>
                      <td className="py-2.5 px-2 align-top text-right font-mono">
                        {formatCurrency(item.unit_price || 0)}
                      </td>
                      <td className="py-2.5 px-2 align-top text-right font-mono font-medium">
                        {formatCurrency((item.unit_price || 0) * (item.quantity || 1))}
                      </td>
                      <td className="py-2.5 px-2 align-top text-center">
                        {isPart ? (
                          item.is_stock_deducted ? (
                            <Badge
                              variant="secondary"
                              className="text-[10px] font-normal bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300"
                            >
                              已扣庫存
                            </Badge>
                          ) : (item.product_id || item.variant_id) ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-6 text-[11px] px-2 py-0 gap-1 text-amber-600 border-amber-300 hover:bg-amber-50 hover:text-amber-700 dark:text-amber-400 dark:border-amber-700 shadow-none font-normal"
                              onClick={() => onDeductSingle(item)}
                              disabled={deductPending || isDeductingAll}
                              title="點擊立即扣減自有倉零件庫存"
                            >
                              {isDeductingThis ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <PackageCheck className="h-3 w-3" />
                              )}
                              扣庫存
                            </Button>
                          ) : (
                            <Badge
                              variant="outline"
                              className="text-[10px] font-normal text-amber-600 border-amber-300 dark:text-amber-400"
                            >
                              未扣庫存
                            </Badge>
                          )
                        ) : (
                          <span className="text-xs text-muted-foreground/30">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}