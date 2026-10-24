import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Globe } from 'lucide-react';

export default function CrossBorderPage() {
  const [poSearch, setPoSearch] = useState('');

  const { data: pos = [], isLoading } = useQuery({
    queryKey: ['cb-pos', poSearch],
    queryFn: async () => {
      let q = (supabase as any)
        .from('purchase_orders')
        .select('id, supplier_id, supplier_order_number, currency, total_amount, status, order_date, landed_total_amount')
        .order('order_date', { ascending: false })
        .limit(100);
      if (poSearch.trim()) {
        q = q.ilike('supplier_order_number', `%${poSearch.trim()}%`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Globe className="h-6 w-6" />
          <h1 className="text-2xl font-bold">集運倉管理</h1>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>集運單候選採購單</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            跨國採購的單張運費與落地成本分攤，請於「採購單明細」內處理；此頁僅彙整可納入集運倉合併運送的採購單。
          </p>
          <Input placeholder="搜尋單號..." value={poSearch} onChange={e => setPoSearch(e.target.value)} />
          {isLoading ? (
            <p className="text-center text-muted-foreground py-8">載入中…</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {(pos as any[]).map((po: any) => (
                <Card key={po.id}>
                  <CardContent className="p-4 space-y-1">
                    <div className="font-medium">{po.supplier_order_number || po.id.slice(0, 8)}</div>
                    <div className="text-xs text-muted-foreground">
                      {po.order_date} · {po.status} · {po.currency || 'TWD'}
                    </div>
                    <div className="text-xs">
                      商品總額：{Number(po.total_amount).toFixed(2)}
                      {po.landed_total_amount != null && Number(po.landed_total_amount) !== Number(po.total_amount) && (
                        <span className="text-green-600 ml-2">落地：{Number(po.landed_total_amount).toFixed(2)}</span>
                      )}
                    </div>
                    <Badge variant="outline" className="text-xs">待集運</Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          {(pos as any[]).length === 0 && !isLoading && (
            <p className="text-center text-muted-foreground py-8">尚無採購單</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
