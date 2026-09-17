import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Layers } from 'lucide-react';
import type { Product } from '../variantManagerTypes';

interface VariantManagerToolbarProps {
  products: Product[];
  selectedProductId: string | null;
  onSelectProduct: (id: string) => void;
  selectedProduct: Product | null;
  variantCount: number;
  onAddVariant: () => void;
  onOpenBatch: () => void;
}

export function VariantManagerToolbar({
  products,
  selectedProductId,
  onSelectProduct,
  selectedProduct,
  variantCount,
  onAddVariant,
  onOpenBatch,
}: VariantManagerToolbarProps) {
  return (
    <>
      <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg">
        <Label className="text-sm font-medium whitespace-nowrap">選擇產品：</Label>
        <Select value={selectedProductId || ''} onValueChange={onSelectProduct}>
          <SelectTrigger className="flex-1 max-w-md">
            <SelectValue placeholder="選擇產品" />
          </SelectTrigger>
          <SelectContent>
            {products.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground text-center">
                沒有符合的產品
              </div>
            ) : (
              products.map((product) => (
                <SelectItem key={product.id} value={product.id}>
                  <span className="font-mono text-xs mr-2">{product.code}</span>
                  {product.name}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>

        {selectedProductId && (
          <>
            <Button onClick={onAddVariant}>
              <Plus className="mr-2 h-4 w-4" />
              新增變體
            </Button>
            <Button variant="outline" onClick={onOpenBatch}>
              <Layers className="mr-2 h-4 w-4" />
              批次建立
            </Button>
          </>
        )}
      </div>

      {selectedProduct && (
        <div className="p-4 border rounded-lg bg-card">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-lg">{selectedProduct.name}</h3>
              <p className="text-sm text-muted-foreground">
                代碼: {selectedProduct.code}
                {(selectedProduct as any).primary_brand_name && ` | 廠牌: ${(selectedProduct as any).primary_brand_name}`}
              </p>
            </div>
            <Badge variant="secondary">{variantCount} 個變體</Badge>
          </div>
        </div>
      )}
    </>
  );
}