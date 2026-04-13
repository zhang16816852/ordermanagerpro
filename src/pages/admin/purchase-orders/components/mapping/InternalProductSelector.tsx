import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface InternalProductSelectorProps {
  onSelect: (productId: string, variantId: string | null) => void;
  onClose: () => void;
}

export function InternalProductSelector({ onSelect, onClose }: InternalProductSelectorProps) {
  const [searchTerm, setSearchTerm] = useState('');

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['internal-products-search', searchTerm],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select(`
          id, name, sku, has_variants,
          variants:product_variants(id, name, sku, option_1, option_2, option_3)
        `)
        .eq('status', 'active')
        .ilike('name', `%${searchTerm}%`)
        .limit(20);

      if (error) throw error;
      return data || [];
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
                if (p.has_variants && variants && variants.length > 0) {
                  return variants.map(v => (
                    <TableRow key={v.id}>
                      <TableCell>
                        <div className="font-medium">{p.name}</div>
                        <div className="text-sm text-muted-foreground">{v.name || [v.option_1, v.option_2, v.option_3].filter(Boolean).join(' - ')}</div>
                      </TableCell>
                      <TableCell className="text-sm">{v.sku}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={() => onSelect(p.id, v.id)}>選擇</Button>
                      </TableCell>
                    </TableRow>
                  ));
                }
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="text-sm">{p.sku}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={() => onSelect(p.id, null)}>選擇</Button>
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
