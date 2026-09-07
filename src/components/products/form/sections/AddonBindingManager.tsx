import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Plus, Trash2, Link2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';

interface BindingRow {
  id: string;
  addon_product_id: string;
  addon_variant_id: string | null;
  quantity: number;
  sort_order: number;
  addon_product: { name: string; code: string | null } | null;
  addon_variant: { name: string | null } | null;
}

export function AddonBindingManager({ productId }: { productId: string }) {
  const queryClient = useQueryClient();
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [saving, setSaving] = useState(false);

  const { data: bindings = [], isLoading } = useQuery<BindingRow[]>({
    queryKey: ['product-addon-bindings', productId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('product_addon_bindings')
        .select(`
          id, addon_product_id, addon_variant_id, quantity, sort_order,
          addon_product:products(name, code),
          addon_variant:product_variants(name)
        `)
        .eq('parent_product_id', productId)
        .order('sort_order');
      if (error) throw error;
      return (data || []).map((b: any) => ({
        id: b.id,
        addon_product_id: b.addon_product_id,
        addon_variant_id: b.addon_variant_id ?? null,
        quantity: Number(b.quantity) || 1,
        sort_order: Number(b.sort_order) || 0,
        addon_product: b.addon_product || null,
        addon_variant: b.addon_variant || null,
      }));
    },
    enabled: !!productId,
  });

  // 可作為加購品的候選商品（一般商品 / 打包商品，排除自身，不隱藏）
  const { data: candidates = [] } = useQuery<{ id: string; name: string; code: string | null }[]>({
    queryKey: ['addon-candidates', productId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('products')
        .select('id, name, code')
        .eq('is_hidden', false)
        .in('item_type', ['product', 'packaging'])
        .neq('id', productId)
        .order('name');
      if (error) throw error;
      return data || [];
    },
    enabled: !!productId,
  });

  const candidateSelected = candidates.find(c => c.id === selectedProductId);

  // 候選商品的變體（供加購指定變體）
  const { data: candidateVariants = [] } = useQuery<{ id: string; product_id: string; name: string }[]>({
    queryKey: ['addon-candidates-variants', selectedProductId],
    queryFn: async () => {
      if (!selectedProductId) return [];
      const { data, error } = await (supabase as any)
        .from('product_variants')
        .select('id, product_id, name')
        .eq('product_id', selectedProductId)
        .order('name');
      if (error) throw error;
      return data || [];
    },
    enabled: !!selectedProductId && !!candidateSelected,
  });

  const variantsForSelected = useMemo(
    () => candidateVariants.filter(v => v.product_id === selectedProductId),
    [candidateVariants, selectedProductId],
  );

  const resetForm = () => {
    setSelectedProductId('');
    setSelectedVariantId('');
    setQuantity('1');
  };

  const addBinding = async () => {
    if (!selectedProductId) return;
    setSaving(true);
    try {
      const maxSort = bindings.reduce((s, b) => Math.max(s, b.sort_order), 0);
      const { error } = await (supabase.from('product_addon_bindings') as any).insert({
        parent_product_id: productId,
        parent_variant_id: null,
        addon_product_id: selectedProductId,
        addon_variant_id: selectedVariantId || null,
        quantity: Math.max(1, parseInt(quantity) || 1),
        sort_order: maxSort + 1,
      });
      if (error) throw error;
      toast.success('已加入加購品（A+B）');
      queryClient.invalidateQueries({ queryKey: ['product-addon-bindings', productId] });
      resetForm();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const removeBinding = async (id: string) => {
    const { error } = await (supabase.from('product_addon_bindings') as any).delete().eq('id', id);
    if (error) {
      toast.error(getErrorMessage(error));
      return;
    }
    toast.success('已移除加購綁定');
    queryClient.invalidateQueries({ queryKey: ['product-addon-bindings', productId] });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link2 className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-medium">A+B 加購綁定</h3>
        <span className="text-xs text-muted-foreground">
          挑選此商品時自動帶出的加購品（個別新增品項，以子行依附，出貨時同步扣庫存）
        </span>
      </div>

      <div className="border rounded-md bg-muted/20 p-4 space-y-3">
        <div className="grid gap-3 md:grid-cols-[1fr_180px_120px]">
          <div className="space-y-1.5">
            <Label>加購商品</Label>
            <Select
              value={selectedProductId}
              onValueChange={(v) => { setSelectedProductId(v); setSelectedVariantId(''); }}
            >
              <SelectTrigger><SelectValue placeholder="選擇商品" /></SelectTrigger>
              <SelectContent>
                {candidates.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}{c.code ? `（${c.code}）` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>變體（選填）</Label>
            <Select value={selectedVariantId} onValueChange={setSelectedVariantId} disabled={!candidateSelected}>
              <SelectTrigger><SelectValue placeholder={variantsForSelected.length ? '選擇變體' : candidateSelected ? '無變體' : '先選商品'} /></SelectTrigger>
              <SelectContent>
                {variantsForSelected.map(v => (
                  <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>數量</Label>
            <Input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={addBinding} disabled={!selectedProductId || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
            加入綁定
          </Button>
        </div>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>加購品</TableHead>
              <TableHead>變體</TableHead>
              <TableHead className="w-24 text-center">數量</TableHead>
              <TableHead className="w-20 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">載入中...</TableCell></TableRow>
            ) : bindings.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                尚未設定加購品。選擇此商品加入訂單時，綁定的加購品會自動一併帶入。
              </TableCell></TableRow>
            ) : (
              bindings.map(b => (
                <TableRow key={b.id}>
                  <TableCell>
                    <span className="font-medium">{b.addon_product?.name || '—'}</span>
                    {b.addon_product?.code && (
                      <span className="ml-2 font-mono text-xs text-muted-foreground">{b.addon_product.code}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {b.addon_variant?.name
                      ? <Badge variant="secondary">{b.addon_variant.name}</Badge>
                      : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-center">×{b.quantity}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeBinding(b.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}