import { Form } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { UseFormReturn } from 'react-hook-form';

import { IdentificationFields } from './sections/IdentificationFields';
import { CategorySelectField } from './sections/CategorySelectField';
import { BrandSelectField } from './sections/BrandSelectField';
import { SeriesSelectField } from './sections/SeriesSelectField';
import { PricingFields } from './sections/PricingFields';

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

                    {/* 系列選擇 */}
                    <SeriesSelectField form={form} />

                    {/* 價格與型號 */}
                    <PricingFields form={form} />

                </div>

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
