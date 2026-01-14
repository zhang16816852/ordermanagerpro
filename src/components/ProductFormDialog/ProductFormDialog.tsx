import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Tables, TablesInsert } from '@/integrations/supabase/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';

// 定義驗證架構
const productSchema = z.object({
  sku: z.string().min(1, "請輸入 SKU"),
  name: z.string().min(1, "請輸入產品名稱"),
  brand: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  series: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  barcode: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  base_wholesale_price: z.coerce.number().min(0, "價格不能小於 0"),
  base_retail_price: z.coerce.number().min(0, "價格不能小於 0"),
  status: z.enum(['active', 'discontinued', 'preorder', 'sold_out']),
  has_variants: z.boolean().default(false),
});

type ProductFormValues = z.infer<typeof productSchema>;

interface ProductFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: ProductFormValues) => void;
  initialData?: Tables<'products'> | null;
  isLoading?: boolean;
}

export function ProductFormDialog({
  open,
  onOpenChange,
  onSubmit,
  initialData,
  isLoading,
}: ProductFormDialogProps) {
  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      sku: '',
      name: '',
      brand: '',
      model: '',
      series: '',
      category: '',
      color: '',
      barcode: '',
      description: '',
      base_wholesale_price: 0,
      base_retail_price: 0,
      status: 'active',
      has_variants: false,
    },
  });

  // 當編輯資料傳入時，重置表單值
  useEffect(() => {
    if (initialData) {
      form.reset({
        ...initialData,
        brand: initialData.brand || '',
        model: initialData.model || '',
        series: initialData.series || '',
        category: initialData.category || '',
        color: initialData.color || '',
        barcode: initialData.barcode || '',
        description: initialData.description || '',
      } as ProductFormValues);
    } else {
      form.reset({
        sku: '',
        name: '',
        brand: '',
        model: '',
        series: '',
        category: '',
        color: '',
        barcode: '',
        description: '',
        base_wholesale_price: 0,
        base_retail_price: 0,
        status: 'active',
        has_variants: false,
      });
    }
  }, [initialData, form, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initialData?.id ? '編輯產品' : '新增產品'}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="sku"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>SKU *</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>產品名稱 *</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <FormField control={form.control} name="brand" render={({ field }) => (
                <FormItem><FormLabel>廠牌</FormLabel><FormControl><Input {...field} value={field.value || ''} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="model" render={({ field }) => (
                <FormItem><FormLabel>型號</FormLabel><FormControl><Input {...field} value={field.value || ''} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="series" render={({ field }) => (
                <FormItem><FormLabel>系列</FormLabel><FormControl><Input {...field} value={field.value || ''} /></FormControl></FormItem>
              )} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField control={form.control} name="base_wholesale_price" render={({ field }) => (
                <FormItem><FormLabel>批發價</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="base_retail_price" render={({ field }) => (
                <FormItem><FormLabel>零售價</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl></FormItem>
              )} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>狀態</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="active">上架中</SelectItem>
                        <SelectItem value="preorder">預購中</SelectItem>
                        <SelectItem value="sold_out">售完停產</SelectItem>
                        <SelectItem value="discontinued">已停售</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="has_variants"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm mt-6">
                    <div className="space-y-0.5">
                      <FormLabel>有變體選項</FormLabel>
                      <FormDescription>啟用後可管理變體</FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem><FormLabel>描述</FormLabel><FormControl><Textarea {...field} value={field.value || ''} /></FormControl></FormItem>
            )} />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
              <Button type="submit" disabled={isLoading}>
                {initialData?.id ? '儲存更新' : '確認新增'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}