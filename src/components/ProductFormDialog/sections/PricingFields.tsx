import { FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { UseFormReturn } from 'react-hook-form';

interface PricingFieldsProps {
    form: UseFormReturn<any>;
}

export function PricingFields({ form }: PricingFieldsProps) {
    const hasVariants = form.watch('has_variants');

    return (
        <>
            {/* 型號 */}
            <FormField
                control={form.control}
                name="model"
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>型號</FormLabel>
                        <FormControl>
                            <Input {...field} value={field.value || ''} />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )}
            />

            {hasVariants ? (
                <div className="col-span-2 p-4 rounded-md bg-blue-50 border border-blue-100 text-blue-800 text-sm">
                    <p className="font-bold mb-1">💡 已啟用規格變體</p>
                    <p>基準價格欄位已隱藏，請前往「變體管理」分頁為各個規格設定獨立的批發價與零售價。</p>
                </div>
            ) : (
                <>
                    {/* 批發價 */}
                    <FormField
                        control={form.control}
                        name="base_wholesale_price"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>基準批發價</FormLabel>
                                <FormControl>
                                    <Input type="number" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    {/* 零售價 */}
                    <FormField
                        control={form.control}
                        name="base_retail_price"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>基準零售價</FormLabel>
                                <FormControl>
                                    <Input type="number" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </>
            )}
        </>
    );
}
