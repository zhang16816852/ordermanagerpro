import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UseFormReturn } from 'react-hook-form';

interface IdentificationFieldsProps {
    form: UseFormReturn<any>;
}

const ITEM_TYPE_OPTIONS: { value: string; label: string }[] = [
    { value: 'product', label: '一般商品' },
    { value: 'shipping', label: '運費（不進目錄/不扣庫存/月結）' },
    { value: 'packaging', label: '包裝（庫存商品，可作為加購）' },
    { value: 'repair_part', label: '維修零件（不顯示於訂單選購目錄）' },
];

export function IdentificationFields({ form }: IdentificationFieldsProps) {
    const itemType = form.watch('item_type') || 'product';

    const { data: suppliers = [] } = useQuery<{ id: string; name: string }[]>({
        queryKey: ['product-form-suppliers'],
        queryFn: async () => {
            const { data, error } = await (supabase as any)
                .from('suppliers')
                .select('id, name')
                .eq('is_active', true)
                .order('name');
            if (error) throw error;
            return data || [];
        },
        enabled: itemType === 'shipping',
    });

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

            {/* 商品類型 */}
            <FormField
                control={form.control}
                name="item_type"
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>商品類型</FormLabel>
                        <Select value={field.value || 'product'} onValueChange={field.onChange}>
                            <FormControl>
                                <SelectTrigger>
                                    <SelectValue placeholder="選擇商品類型" />
                                </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                                {ITEM_TYPE_OPTIONS.map(o => (
                                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <FormDescription>運費不進庫存與目錄；維修零件列為維修單零件選項。</FormDescription>
                        <FormMessage />
                    </FormItem>
                )}
            />

            {/* 前端顯示開關 */}
            <FormField
                control={form.control}
                name="is_hidden"
                render={({ field }) => (
                    <FormItem className="flex items-center gap-2 rounded-md border p-3 col-span-2">
                        <FormControl>
                            <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-input"
                                checked={!!field.value}
                                onChange={e => field.onChange(e.target.checked)}
                            />
                        </FormControl>
                        <FormLabel className="!mt-0">前端顯示開關（勾選＝自訂目錄/大眾前台隱藏，後台仍可管理）</FormLabel>
                    </FormItem>
                )}
            />

            {/* 運費型商品：所屬物流公司（採購商） */}
            {itemType === 'shipping' && (
                <FormField
                    control={form.control}
                    name="supplier_id"
                    render={({ field }) => (
                        <FormItem className="col-span-2">
                            <FormLabel>所屬物流公司（採購商）</FormLabel>
                            <Select value={field.value || ''} onValueChange={field.onChange}>
                                <FormControl>
                                    <SelectTrigger>
                                        <SelectValue placeholder="選擇物流公司" />
                                    </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                    {suppliers.map(s => (
                                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <FormDescription>物流公司統一在「採購管理→供應商」管理，此處選擇該運費商品歸屬的公司。</FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            )}
        </>
    );
}