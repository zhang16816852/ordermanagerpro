import { Form, FormField, FormItem, FormLabel, FormControl } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { UseFormReturn } from 'react-hook-form';

import { IdentificationFields } from './sections/IdentificationFields';
import { CategorySelectField } from './sections/CategorySelectField';
import { BrandSelectField } from './sections/BrandSelectField';
import { PricingFields } from './sections/PricingFields';
import { DynamicSpecsFields } from './sections/DynamicSpecsFields';
import { DeviceModelSelectField } from './sections/DeviceModelSelectField';

interface BasicInfoFormProps {
    form: UseFormReturn<any>;
    onSubmit: (data: any) => void;
    isLoading?: boolean;
    onCancel: () => void;
}

export function BasicInfoForm({ form, onSubmit, isLoading, onCancel }: BasicInfoFormProps) {
    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                    {/* 產品辨識資訊 (名稱, SKU, 狀態) */}
                    <IdentificationFields form={form} />

                    {/* 分類選擇 (多選與階層邏輯) */}
                    <CategorySelectField form={form} />

                    {/* 品牌選擇 */}
                    <BrandSelectField form={form} />

                    {/* 價格與型號 */}
                    <PricingFields form={form} />

                    {/* 適用設備型號 (多選標籤) */}
                    <DeviceModelSelectField form={form} />
                </div>

                {/* 動態規格欄位 (根據分類自動顯示) */}
                <DynamicSpecsFields form={form} />

                {/* 變體切換開關 */}
                <FormField
                    control={form.control}
                    name="has_variants"
                    render={({ field }) => (
                        <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 bg-muted/20">
                            <FormControl>
                                <Checkbox
                                    checked={field.value}
                                    onCheckedChange={(checked) =>
                                        field.onChange(checked === true)
                                    }
                                />
                            </FormControl>
                            <div className="space-y-1 leading-none">
                                <FormLabel>啟用規格變體</FormLabel>
                                <p className="text-sm text-muted-foreground">
                                    如果此產品有顏色、尺寸等不同規格，請勾選。
                                </p>
                            </div>
                        </FormItem>
                    )}
                />

                {/* 按鈕區 */}
                <div className="flex justify-end gap-3 pt-4 border-t">
                    <Button type="button" variant="outline" onClick={onCancel}>
                        取消
                    </Button>
                    <Button type="submit" disabled={isLoading}>
                        {isLoading ? "儲存中..." : "儲存基本資訊"}
                    </Button>
                </div>
            </form>
        </Form>
    );
}
