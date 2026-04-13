import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SupplierImportConfig } from '../../hooks/useSupplierMappings';

interface MappingConfigFormProps {
  initialConfig: SupplierImportConfig | null;
  onSave: (data: any) => void;
  isLoading?: boolean;
}

export function MappingConfigForm({ initialConfig, onSave, isLoading }: MappingConfigFormProps) {
  const { register, handleSubmit, reset } = useForm({
    defaultValues: {
      header_row: 0,
      vendor_product_id: '',
      vendor_product_name: '',
      quantity: '',
      unit_cost: '',
    }
  });

  useEffect(() => {
    if (initialConfig) {
      reset({
        header_row: initialConfig.header_row || 0,
        vendor_product_id: initialConfig.mapping_config?.vendor_product_id || '',
        vendor_product_name: initialConfig.mapping_config?.vendor_product_name || '',
        quantity: initialConfig.mapping_config?.quantity || '',
        unit_cost: initialConfig.mapping_config?.unit_cost || '',
      });
    }
  }, [initialConfig, reset]);

  const onSubmit = (data: any) => {
    onSave({
      header_row: Number(data.header_row),
      mapping_config: {
        vendor_product_id: data.vendor_product_id,
        vendor_product_name: data.vendor_product_name,
        quantity: data.quantity,
        unit_cost: data.unit_cost,
      }
    });
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>標題列索引 (通常從 0 開始)</Label>
          <Input type="number" {...register('header_row')} />
          <p className="text-xs text-muted-foreground">Excel 檔案中第幾列為欄位標題</p>
        </div>
      </div>
      
      <div className="grid grid-cols-2 gap-4 border-t pt-4">
        <div className="col-span-full mb-1">
          <p className="text-sm font-medium">Excel 對應欄位名稱配置</p>
          <p className="text-xs text-muted-foreground">請填入供應商提供之 Excel 報表中，對應的「欄位中文/英文字段名稱」(完全比對)，而非欄引號 (A, B)</p>
        </div>
        <div className="space-y-2">
          <Label>廠商產品代號 *</Label>
          <Input {...register('vendor_product_id')} required placeholder="例如：產品編號" />
        </div>
        <div className="space-y-2">
          <Label>廠商產品名稱</Label>
          <Input {...register('vendor_product_name')} placeholder="例如：品名" />
        </div>
        <div className="space-y-2">
          <Label>數量</Label>
          <Input {...register('quantity')} placeholder="例如：本期進貨" />
        </div>
        <div className="space-y-2">
          <Label>單價</Label>
          <Input {...register('unit_cost')} placeholder="例如：單價" />
        </div>
      </div>
      
      <div className="flex justify-end pt-4">
        <Button disabled={isLoading} type="submit">儲存設定</Button>
      </div>
    </form>
  );
}
