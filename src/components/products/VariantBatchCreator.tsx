// src/components/products/VariantBatchCreator.tsx
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Tables } from '@/integrations/supabase/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Layers, Sparkles, AlertCircle } from 'lucide-react';

type Product = Tables<'products'>;

interface VariantBatchCreatorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product;
  onSuccess: () => void;
}

interface GeneratedVariant {
  sku: string;
  name: string;
  option_1: string | null;
  option_2: string | null;
  option_3: string | null;
  wholesale_price: number;
  retail_price: number;
}

export function VariantBatchCreator({ open, onOpenChange, product, onSuccess }: VariantBatchCreatorProps) {
  const [option1Values, setOption1Values] = useState('');
  const [option2Values, setOption2Values] = useState('');
  const [option3Values, setOption3Values] = useState('');
  const [wholesalePrice, setWholesalePrice] = useState(product.base_wholesale_price.toString());
  const [retailPrice, setRetailPrice] = useState(product.base_retail_price.toString());
  const [generatedVariants, setGeneratedVariants] = useState<GeneratedVariant[]>([]);

  const parseOptions = (text: string): string[] => {
    return text
      .split(/[,，\n]/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  };

  const generateVariants = () => {
    const opt1 = parseOptions(option1Values);
    const opt2 = parseOptions(option2Values);
    const opt3 = parseOptions(option3Values);

    if (opt1.length === 0) {
      toast.error('請至少輸入選項1的值');
      return;
    }

    const variants: GeneratedVariant[] = [];
    const price = parseFloat(wholesalePrice) || product.base_wholesale_price;
    const retail = parseFloat(retailPrice) || product.base_retail_price;

    // 生成所有排列組合
    for (const v1 of opt1) {
      if (opt2.length === 0) {
        variants.push({
          sku: `${product.sku}-${v1}`.toUpperCase().replace(/\s+/g, '-'),
          name: `${product.name} - ${v1}`,
          option_1: v1,
          option_2: null,
          option_3: null,
          wholesale_price: price,
          retail_price: retail,
        });
      } else {
        for (const v2 of opt2) {
          if (opt3.length === 0) {
            variants.push({
              sku: `${product.sku}-${v1}-${v2}`.toUpperCase().replace(/\s+/g, '-'),
              name: `${product.name} - ${v1} / ${v2}`,
              option_1: v1,
              option_2: v2,
              option_3: null,
              wholesale_price: price,
              retail_price: retail,
            });
          } else {
            for (const v3 of opt3) {
              variants.push({
                sku: `${product.sku}-${v1}-${v2}-${v3}`.toUpperCase().replace(/\s+/g, '-'),
                name: `${product.name} - ${v1} / ${v2} / ${v3}`,
                option_1: v1,
                option_2: v2,
                option_3: v3,
                wholesale_price: price,
                retail_price: retail,
              });
            }
          }
        }
      }
    }

    setGeneratedVariants(variants);
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      if (generatedVariants.length === 0) throw new Error('請先生成變體');

      const variantsToInsert = generatedVariants.map(v => ({
        product_id: product.id,
        sku: v.sku,
        name: v.name,
        option_1: v.option_1,
        option_2: v.option_2,
        option_3: v.option_3,
        wholesale_price: v.wholesale_price,
        retail_price: v.retail_price,
        status: 'active' as const,
      }));

      const { error } = await supabase.from('product_variants').insert(variantsToInsert);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`成功建立 ${generatedVariants.length} 個變體`);
      onSuccess();
      onOpenChange(false);
      resetForm();
    },
    onError: (error) => {
      toast.error(`建立失敗：${error.message}`);
    },
  });

  const resetForm = () => {
    setOption1Values('');
    setOption2Values('');
    setOption3Values('');
    setWholesalePrice(product.base_wholesale_price.toString());
    setRetailPrice(product.base_retail_price.toString());
    setGeneratedVariants([]);
  };

  const updateVariantPrice = (index: number, field: 'wholesale_price' | 'retail_price', value: string) => {
    setGeneratedVariants(prev => 
      prev.map((v, i) => 
        i === index ? { ...v, [field]: parseFloat(value) || 0 } : v
      )
    );
  };

  const removeVariant = (index: number) => {
    setGeneratedVariants(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" />
            批次建立變體
          </DialogTitle>
          <DialogDescription>
            為「{product.name}」批次建立變體，輸入各選項的值（用逗號或換行分隔），系統會自動生成排列組合
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* 選項輸入 */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="option1">選項1（必填）</Label>
              <Textarea
                id="option1"
                placeholder="輸入選項值，例如：&#10;霧面&#10;透明&#10;抗藍光"
                value={option1Values}
                onChange={(e) => setOption1Values(e.target.value)}
                className="min-h-[100px]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="option2">選項2（選填）</Label>
              <Textarea
                id="option2"
                placeholder="輸入選項值，例如：&#10;128GB&#10;256GB&#10;512GB"
                value={option2Values}
                onChange={(e) => setOption2Values(e.target.value)}
                className="min-h-[100px]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="option3">選項3（選填）</Label>
              <Textarea
                id="option3"
                placeholder="輸入選項值，例如：&#10;黑色&#10;白色&#10;銀色"
                value={option3Values}
                onChange={(e) => setOption3Values(e.target.value)}
                className="min-h-[100px]"
              />
            </div>
          </div>

          {/* 預設價格 */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="defaultWholesale">預設批發價</Label>
              <Input
                id="defaultWholesale"
                type="number"
                step="0.01"
                value={wholesalePrice}
                onChange={(e) => setWholesalePrice(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="defaultRetail">預設零售價</Label>
              <Input
                id="defaultRetail"
                type="number"
                step="0.01"
                value={retailPrice}
                onChange={(e) => setRetailPrice(e.target.value)}
              />
            </div>
          </div>

          <Button onClick={generateVariants} className="w-full" variant="secondary">
            <Sparkles className="mr-2 h-4 w-4" />
            生成變體預覽
          </Button>

          {/* 預覽結果 */}
          {generatedVariants.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-medium">預覽（{generatedVariants.length} 個變體）</h4>
                <Badge variant="outline">點擊可編輯價格</Badge>
              </div>

              <div className="border rounded-lg max-h-[300px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left">SKU</th>
                      <th className="px-3 py-2 text-left">名稱</th>
                      <th className="px-3 py-2 text-right w-24">批發價</th>
                      <th className="px-3 py-2 text-right w-24">零售價</th>
                      <th className="px-3 py-2 w-12"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {generatedVariants.map((variant, index) => (
                      <tr key={index} className="border-t hover:bg-muted/50">
                        <td className="px-3 py-2 font-mono text-xs">{variant.sku}</td>
                        <td className="px-3 py-2">{variant.name}</td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            step="0.01"
                            value={variant.wholesale_price}
                            onChange={(e) => updateVariantPrice(index, 'wholesale_price', e.target.value)}
                            className="h-7 w-20 text-right"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            step="0.01"
                            value={variant.retail_price}
                            onChange={(e) => updateVariantPrice(index, 'retail_price', e.target.value)}
                            className="h-7 w-20 text-right"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive"
                            onClick={() => removeVariant(index)}
                          >
                            ×
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg text-sm">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                <span>確認無誤後點擊下方按鈕建立變體，SKU 重複將會導致失敗</span>
              </div>
            </div>
          )}

          {/* 操作按鈕 */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => { onOpenChange(false); resetForm(); }}>
              取消
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={generatedVariants.length === 0 || createMutation.isPending}
            >
              {createMutation.isPending ? '建立中...' : `建立 ${generatedVariants.length} 個變體`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
