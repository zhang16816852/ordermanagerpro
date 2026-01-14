import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tables } from '@/integrations/supabase/types';
import { BasicInfoForm } from './BasicInfoForm';
import { VariantSection } from './VariantSection';

// 統一定義 Schema
const productSchema = z.object({
  name: z.string().min(1, '產品名稱為必填'),
  sku: z.string().min(1, 'SKU 為必填'),
  brand: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  base_wholesale_price: z.coerce.number().min(0),
  base_retail_price: z.coerce.number().min(0),
  status: z.enum(['active', 'discontinued', 'preorder', 'sold_out']),
  has_variants: z.boolean().default(false),
});

type Product = Tables<'products'>;

interface ProductFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: any) => void;
  initialData: Product | null;
  isLoading?: boolean;
}

export function ProductFormDialog({ open, onOpenChange, onSubmit, initialData, isLoading }: ProductFormDialogProps) {
  const [activeTab, setActiveTab] = useState('basic');

  // 1. 在父層初始化 Form
  const form = useForm<z.infer<typeof productSchema>>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: '', sku: '', brand: '', model: '',
      base_wholesale_price: 0, base_retail_price: 0,
      status: 'active', has_variants: false,
    },
  });

  // 2. 當切換編輯對象或 Dialog 開關時，同步 Form 資料
  useEffect(() => {
    if (open) {
      if (initialData) {
        form.reset(initialData);
      } else {
        form.reset({
          name: '', sku: '', brand: '', model: '',
          base_wholesale_price: 0, base_retail_price: 0,
          status: 'active', has_variants: false,
        });
      }
      setActiveTab('basic'); // 每次打開預設回到基本資訊
    }
  }, [open, initialData, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle>{initialData ? `編輯產品: ${initialData.name}` : '新增產品'}</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
          <div className="px-6 border-b">
            <TabsList className="w-full justify-start h-12 bg-transparent p-0 gap-6">
              <TabsTrigger value="basic" className="data-[state=active]:border-b-2 border-primary rounded-none px-2 h-12 bg-transparent shadow-none">
                基本資訊
              </TabsTrigger>
              <TabsTrigger 
                value="variants" 
                disabled={!initialData || !form.watch('has_variants')} // 即時監控 Form 內的 has_variants
                className="data-[state=active]:border-b-2 border-primary rounded-none px-2 h-12 bg-transparent shadow-none"
              >
                變體管理 {!initialData && '(儲存後可用)'}
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            <TabsContent value="basic" className="m-0 focus-visible:ring-0">
              {/* 3. 將 form 物件傳遞給子組件 */}
              <BasicInfoForm 
                form={form} 
                onSubmit={onSubmit} 
                isLoading={isLoading} 
                onCancel={() => onOpenChange(false)}
              />
            </TabsContent>

            <TabsContent value="variants" className="m-0 focus-visible:ring-0">
              {initialData && <VariantSection product={initialData} />}
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}