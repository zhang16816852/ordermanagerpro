import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Plus, Layers } from 'lucide-react';
import { VariantBatchCreator } from './VariantBatchCreator';

export function VariantSection({ product }: { product: any }) {
  const [isBatchOpen, setIsBatchOpen] = useState(false);

  const { data: variants, isLoading } = useQuery({
    queryKey: ['product-variants', product.id],
    queryFn: async () => {
      const { data } = await supabase.from('product_variants').select('*').eq('product_id', product.id).order('sku');
      return data;
    }
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-medium text-muted-foreground">
          此產品共有 {variants?.length || 0} 個變體
        </h3>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setIsBatchOpen(true)}>
            <Layers className="mr-2 h-4 w-4" /> 批次產生變體
          </Button>
          <Button size="sm">
            <Plus className="mr-2 h-4 w-4" /> 新增單一變體
          </Button>
        </div>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>規格名稱</TableHead>
              <TableHead className="text-right">批發價</TableHead>
              <TableHead className="text-right">零售價</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {variants?.map(v => (
              <TableRow key={v.id}>
                <TableCell className="font-mono text-xs">{v.sku}</TableCell>
                <TableCell>{v.name}</TableCell>
                <TableCell className="text-right">${v.wholesale_price}</TableCell>
                <TableCell className="text-right">${v.retail_price}</TableCell>
              </TableRow>
            ))}
            {variants?.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                  尚未建立任何變體
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <VariantBatchCreator 
        open={isBatchOpen} 
        onOpenChange={setIsBatchOpen} 
        product={product} 
        onSuccess={() => {/* 刷新 query */}} 
      />
    </div>
  );
}