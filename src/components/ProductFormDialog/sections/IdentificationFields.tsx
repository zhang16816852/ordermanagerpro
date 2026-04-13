import { FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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

            {/* SKU */}
            <FormField
                control={form.control}
                name="sku"
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>主要 SKU</FormLabel>
                        <FormControl>
                            <Input placeholder="P-001" {...field} value={field.value || ''} />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )}
            />

            {/* 狀態選單 */}
            <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>銷售狀態</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                                <SelectTrigger>
                                    <SelectValue placeholder="選擇狀態" />
                                </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                                <SelectItem value="active">上架中</SelectItem>
                                <SelectItem value="preorder">預購中</SelectItem>
                                <SelectItem value="sold_out">售完停產</SelectItem>
                                <SelectItem value="discontinued">已停售</SelectItem>
                            </SelectContent>
                        </Select>
                        <FormMessage />
                    </FormItem>
                )}
            />
        </>
    );
}
