import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UseFormReturn } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useMemo } from 'react';

interface BasicInfoFormProps {
    form: UseFormReturn<any>;
    onSubmit: (data: any) => void;
    isLoading?: boolean;
    onCancel: () => void;
}

export function BasicInfoForm({ form, onSubmit, isLoading, onCancel }: BasicInfoFormProps) {
    const { data: categories = [] } = useQuery({
        queryKey: ['categories'],
        queryFn: async () => {
            const { data, error } = await (supabase
                .from('categories' as any) as any)
                .select('*')
                .order('sort_order', { ascending: true });
            if (error) {
                console.error('Categories table may not exist yet:', error);
                return [];
            }
            return data;
        },
    });

    // Build flat tree for select
    const categoryOptions = useMemo(() => {
        const build = (pid: string | null = null, level = 0): any[] => {
            return categories
                .filter((c: any) => c.parent_id === pid)
                .flatMap((c: any) => [
                    { id: c.id, name: c.name, level, spec_schema: c.spec_schema },
                    ...build(c.id, level + 1),
                ]);
        };
        return build();
    }, [categories]);

    const selectedCategoryId = form.watch('category_id');
    const selectedCategory = categoryOptions.find(c => c.id === selectedCategoryId);
    const specFields = selectedCategory?.spec_schema?.fields || [];

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <div className="grid grid-cols-2 gap-x-6 gap-y-4">
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

                    {/* 類別 (UUID) */}
                    <FormField
                        control={form.control}
                        name="category_id"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>產品分類</FormLabel>
                                <Select
                                    onValueChange={(val) => {
                                        field.onChange(val);
                                        // Sync name to legacy category string field
                                        const cat = categoryOptions.find(c => c.id === val);
                                        if (cat) form.setValue('category', cat.name);
                                    }}
                                    value={field.value || ''}
                                >
                                    <FormControl>
                                        <SelectTrigger>
                                            <SelectValue placeholder="選擇分類" />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        {categoryOptions.map((cat) => (
                                            <SelectItem key={cat.id} value={cat.id}>
                                                {"\u00A0".repeat(cat.level * 4)}{cat.name}
                                            </SelectItem>
                                        ))}
                                        {categoryOptions.length === 0 && (
                                            <SelectItem value="none" disabled>請先建立分類</SelectItem>
                                        )}
                                    </SelectContent>
                                </Select>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    <FormField
                        control={form.control}
                        name="brand"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>品牌</FormLabel>
                                <FormControl>
                                    <Input {...field} value={field.value || ''} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

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
                </div>

                {/* 動態規格欄位 (table_settings) */}
                {specFields.length > 0 && (
                    <div className="space-y-4 p-4 border rounded-lg bg-muted/10">
                        <h3 className="text-sm font-bold flex items-center gap-2">
                            分類特定規格
                        </h3>
                        <div className="grid grid-cols-2 gap-4">
                            {specFields.map((f: any) => (
                                <div key={f.key} className="space-y-1.5">
                                    <label className="text-xs font-medium text-muted-foreground">{f.key}</label>
                                    {f.type === 'text' ? (
                                        <Input
                                            value={form.watch(`table_settings.${f.key}`) || ''}
                                            onChange={(e) => form.setValue(`table_settings.${f.key}`, e.target.value)}
                                            placeholder={`輸入${f.key}`}
                                            className="h-9"
                                        />
                                    ) : (
                                        <Select
                                            value={form.watch(`table_settings.${f.key}`) || ''}
                                            onValueChange={(val) => form.setValue(`table_settings.${f.key}`, val)}
                                        >
                                            <SelectTrigger className="h-9">
                                                <SelectValue placeholder="請選擇" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {f.options?.map((opt: string) => (
                                                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

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
