import { FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UseFormReturn } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface BrandSelectFieldProps {
    form: UseFormReturn<any>;
}

export function BrandSelectField({ form }: BrandSelectFieldProps) {
    const { data: brands = [], isLoading: isLoadingBrands } = useQuery({
        queryKey: ['brands'],
        queryFn: async () => {
            try {
                const { data, error } = await (supabase.from('brands' as any) as any)
                    .select('*')
                    .order('sort_order', { ascending: true })
                    .order('name', { ascending: true });
                if (error) return [];
                return data;
            } catch (err) {
                console.error('Error fetching brands:', err);
                return [];
            }
        },
    });

    return (
        <FormField
            control={form.control}
            name="brand_id"
            render={({ field }) => (
                <FormItem>
                    <FormLabel>品牌</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || undefined} disabled={isLoadingBrands}>
                        <FormControl>
                            <SelectTrigger>
                                <SelectValue placeholder={isLoadingBrands ? "載入中..." : "選擇品牌"} />
                            </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                            <SelectItem value="none" disabled className="hidden">無</SelectItem>
                            {brands.map((brand: any) => (
                                <SelectItem key={brand.id} value={brand.id}>
                                    {brand.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {brands.length === 0 && !isLoadingBrands && (
                        <p className="text-[10px] text-muted-foreground mt-1">尚未建立任何品牌，請至分類管理新增</p>
                    )}
                    <FormMessage />
                </FormItem>
            )}
        />
    );
}
