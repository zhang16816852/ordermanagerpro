import { useQuery } from '@tanstack/react-query';
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UseFormReturn } from 'react-hook-form';
import { supabase } from '@/integrations/supabase/client';

import { useCategorySpecs } from '@/hooks/useCategorySpecs';

interface DynamicSpecsFieldsProps {
    form: UseFormReturn<any>;
}

export function DynamicSpecsFields({ form }: DynamicSpecsFieldsProps) {
    const selectedCategoryIds = form.watch('category_ids') || [];
    const { data: specFields = [] } = useCategorySpecs(selectedCategoryIds);

    if (specFields.length === 0) return null;

    return (
        <div className="space-y-4 p-4 border rounded-lg bg-muted/10">
            <h3 className="text-sm font-bold flex items-center gap-2">
                分類特定規格
            </h3>
            <div className="grid grid-cols-2 gap-4">
                {specFields.map((f: any) => (
                    <div key={f.key} className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">{f.name}</label>
                        {f.type === 'boolean' ? (
                            <div className="flex items-center space-x-2 h-9 border rounded-md px-3 bg-background">
                                <Checkbox
                                    id={`spec-${f.key}`}
                                    checked={form.watch(`table_settings.${f.key}`) === 'true'}
                                    onCheckedChange={(checked) => form.setValue(`table_settings.${f.key}`, checked ? 'true' : 'false')}
                                />
                                <label htmlFor={`spec-${f.key}`} className="text-sm cursor-pointer select-none flex-1">
                                    支援
                                </label>
                            </div>
                        ) : f.type === 'number_with_unit' ? (
                            <div className="flex items-center space-x-2">
                                <Input
                                    type="number"
                                    value={form.watch(`table_settings.${f.key}`) || ''}
                                    onChange={(e) => form.setValue(`table_settings.${f.key}`, e.target.value)}
                                    placeholder={`輸入數值`}
                                    className="h-9"
                                />
                                {f.options?.[0] && (
                                    <span className="text-sm text-muted-foreground whitespace-nowrap">{f.options[0]}</span>
                                )}
                            </div>
                        ) : f.type === 'text' ? (
                            <Input
                                value={form.watch(`table_settings.${f.key}`) || ''}
                                onChange={(e) => form.setValue(`table_settings.${f.key}`, e.target.value)}
                                placeholder={`輸入${f.name}`}
                                className="h-9"
                            />
                        ) : f.type === 'multiselect' ? (
                            <div className="flex flex-col gap-1.5 p-2 border rounded-md bg-background max-h-32 overflow-y-auto">
                                {f.options?.map((opt: string) => {
                                    const currentVals: string[] = (() => {
                                        const raw = form.watch(`table_settings.${f.key}`);
                                        if (Array.isArray(raw)) return raw;
                                        if (typeof raw === 'string' && raw) return raw.split(',');
                                        return [];
                                    })();
                                    const isChecked = currentVals.includes(opt);
                                    return (
                                        <div key={opt} className="flex items-center gap-2">
                                            <Checkbox
                                                id={`spec-${f.key}-${opt}`}
                                                checked={isChecked}
                                                onCheckedChange={(checked) => {
                                                    const next = checked
                                                        ? [...currentVals, opt]
                                                        : currentVals.filter((v) => v !== opt);
                                                    form.setValue(`table_settings.${f.key}`, next);
                                                }}
                                            />
                                            <label htmlFor={`spec-${f.key}-${opt}`} className="text-sm cursor-pointer">{opt}</label>
                                        </div>
                                    );
                                })}
                            </div>
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
    );
}
