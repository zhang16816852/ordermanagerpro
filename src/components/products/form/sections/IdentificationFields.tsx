import { FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { UseFormReturn } from 'react-hook-form';

interface IdentificationFieldsProps {
    form: UseFormReturn<any>;
}

export function IdentificationFields({ form }: IdentificationFieldsProps) {
    return (
        <>
            {/* 產品名稱 - 滿版 */}
            <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                    <FormItem className="col-span-2">
                        <FormLabel>產品名稱</FormLabel>
                        <FormControl>
                            <Input placeholder="例如：超輕量防水外套" {...field} value={field.value || ''} />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )}
            />

            {/* 產品代碼 */}
            <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>產品代碼</FormLabel>
                        <FormControl>
                            <Input placeholder="P-001" {...field} value={field.value || ''} />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )}
            />
        </>
    );
}
