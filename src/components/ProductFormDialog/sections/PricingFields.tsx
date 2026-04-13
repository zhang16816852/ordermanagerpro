import { FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { UseFormReturn } from 'react-hook-form';

interface PricingFieldsProps {
    form: UseFormReturn<any>;
}

export function PricingFields({ form }: PricingFieldsProps) {
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
    );
}
