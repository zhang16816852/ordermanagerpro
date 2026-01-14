import { useEffect } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { ProductFormValues } from './product-form.schema';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from '@/components/ui/select';

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialProduct: ProductFormValues | null;
  onCreate: (data: ProductFormValues) => Promise<void>;
  onUpdate: (data: ProductFormValues) => Promise<void>;
};

export function ProductFormDialog({
  open,
  onOpenChange,
  initialProduct,
  onCreate,
  onUpdate,
}: Props) {
  const form = useForm<ProductFormValues>({
    defaultValues: {
      sku: '',
      name: '',
      base_wholesale_price: 0,
      base_retail_price: 0,
      status: 'active',
      has_variants: false,
      variants: [],
    },
  });

  const { register, handleSubmit, reset, control, watch } = form;

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'variants',
  });

  /** 編輯 / 複製時 reset 表單 */
  useEffect(() => {
    if (initialProduct) {
      reset(initialProduct);
    } else {
      reset();
    }
  }, [initialProduct, reset]);

  const onSubmit = async (data: ProductFormValues) => {
    if (data.id) {
      await onUpdate(data);
    } else {
      await onCreate(data);
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initialProduct?.id ? '編輯產品' : '新增產品'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>SKU</Label>
              <Input {...register('sku', { required: true })} />
            </div>
            <div>
              <Label>名稱</Label>
              <Input {...register('name', { required: true })} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>批發價</Label>
              <Input type="number" {...register('base_wholesale_price', { valueAsNumber: true })} />
            </div>
            <div>
              <Label>零售價</Label>
              <Input type="number" {...register('base_retail_price', { valueAsNumber: true })} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>狀態</Label>
              <Select
                value={watch('status')}
                onValueChange={(v) => form.setValue('status', v as any)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">上架中</SelectItem>
                  <SelectItem value="preorder">預購中</SelectItem>
                  <SelectItem value="sold_out">售完</SelectItem>
                  <SelectItem value="discontinued">停售</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2 pt-6">
              <Switch
                checked={watch('has_variants')}
                onCheckedChange={(v) => form.setValue('has_variants', v)}
              />
              <Label>有變體</Label>
            </div>
          </div>

          {/* 變體（RHF FieldArray） */}
          {watch('has_variants') && (
            <div className="space-y-2 border-t pt-4">
              {fields.map((field, index) => (
                <div key={field.id} className="grid grid-cols-3 gap-2">
                  <Input {...register(`variants.${index}.sku`)} />
                  <Input {...register(`variants.${index}.name`)} />
                  <Input
                    type="number"
                    {...register(`variants.${index}.wholesale_price`, {
                      valueAsNumber: true,
                    })}
                  />
                  <Button type="button" variant="outline" onClick={() => remove(index)}>
                    刪除
                  </Button>
                </div>
              ))}

              <Button
                type="button"
                onClick={() =>
                  append({
                    sku: '',
                    name: '',
                    wholesale_price: 0,
                  } as any)
                }
              >
                新增變體
              </Button>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit">儲存</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
