import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UseFormReturn } from 'react-hook-form';

interface BasicInfoFormProps {
    form: UseFormReturn<any>; // 接收父層傳來的 form
    onSubmit: (data: any) => void;
    isLoading?: boolean;
    onCancel: () => void;
}

export function BasicInfoForm({ form, onSubmit, isLoading, onCancel }: BasicInfoFormProps) {
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

                    {/* 品牌 */}
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
                </div>

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