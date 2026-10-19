import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface InternalProductSelectorProps {
  onSelect: (productId: string, variantId: string | null, productName: string, variantName: string | null) => void;
  onClose: () => void;
}

export function InternalProductSelector({ onSelect, onClose }: InternalProductSelectorProps) {
  const [searchTerm, setSearchTerm] = useState('');

  // 空白分割：所有 token 都必須出現在產品名/代碼/變體名/SKU 中
  const tokens = searchTerm.trim().toLowerCase().split(/\s+/).filter(Boolean);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['internal-products-search', searchTerm],
    queryFn: async () => {
      // 先抓一批產品（含變體），再在前端依 token 過濾變體，支援變體搜尋
      const { data, error } = await (supabase
        .from('products') as any)
        .select(`
          id, name, code,
          variants:product_variants(id, name, sku)
        `);

      if (error) throw error;
      if (tokens.length === 0) return data || [];
      return (data || []).map((p: any) => {
        const variants = (p.variants || []).filter((v: any) => {
          const hay = `${p.name || ''} ${p.code || ''} ${v.name || ''} ${v.sku || ''}`.toLowerCase();
          return tokens.every((t) => hay.includes(t));
        });
        // 若產品本身或任一變體命中，保留命中變體；產品無變體時以產品本身判斷
        const prodHay = `${p.name || ''} ${p.code || ''}`.toLowerCase();
        const prodMatch = tokens.every((t) => prodHay.includes(t));
        if (variants.length > 0) return { ...p, variants };
        if (prodMatch) return p;
        return null;
      }).filter(Boolean);
    },
    enabled: searchTerm.length > 0,
  });

  return (
    <div className="space-y-4">
      <Input
        placeholder="搜尋內部產品名稱..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
      />
      <ScrollArea className="h-[300px] border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>產品/規格</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead className="w-[100px]">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center py-4 text-muted-foreground">搜尋中...</TableCell>
              </TableRow>
            ) : products.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center py-4 text-muted-foreground">無相關產品</TableCell>
              </TableRow>
            ) : (
              products.map((p) => {
                const variants = p.variants as any[];
                if (variants && variants.length > 0) {
                  return variants.map(v => (
                    <TableRow key={v.id}>
                      <TableCell>
                        <div className="font-medium">{v.name || v.sku}</div>
                      </TableCell>
                      <TableCell className="text-sm">{v.sku}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={() => onSelect(p.id, v.id, p.name, v.name || null)}>選擇</Button>
                      </TableCell>
                    </TableRow>
                  ));
                }
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="text-sm">{p.code}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={() => onSelect(p.id, null, p.name, null)}>選擇</Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </ScrollArea>
      <div className="flex justify-end">
        <Button variant="ghost" onClick={onClose}>取消</Button>
      </div>
    </div>
  );
}
