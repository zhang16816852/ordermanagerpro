import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCategorySpecs } from '@/hooks/useCategorySpecs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Save, Copy, Loader2 } from 'lucide-react';
import { useState, useEffect } from 'react';

interface VariantSpecsMatrixProps {
    productId: string;
    categoryIds: string[];
}

export function VariantSpecsMatrix({ productId, categoryIds }: VariantSpecsMatrixProps) {
    const queryClient = useQueryClient();
    const { data: specs = [], isLoading: specsLoading } = useCategorySpecs(categoryIds);
    const [localData, setLocalData] = useState<Record<string, any>>({}); // variantId -> { specKey -> value }

    const { data: variants = [], isLoading: variantsLoading } = useQuery({
        queryKey: ['product-variants-specs', productId],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('product_variants')
                .select('id, name, table_settings')
                .eq('product_id', productId)
                .order('sku');
            if (error) throw error;
            return data;
        },
        enabled: !!productId
    });

    // Initialize local state when variants are loaded
    useEffect(() => {
        if (variants.length > 0) {
            const initial: Record<string, any> = {};
            variants.forEach(v => {
                initial[v.id] = v.table_settings || {};
            });
            setLocalData(initial);
        }
    }, [variants]);

    const saveMutation = useMutation({
        mutationFn: async () => {
            const updates = Object.entries(localData).map(([id, table_settings]) => ({
                id,
                table_settings
            }));

            // Upsert doesn't support batch update by ID easily in some versions, 
            // but we can use multiple updates or a custom RPC if needed.
            // For now, let's do sequential updates for simplicity, or use .upsert with full objects.
            // Actually, we should just update each one.
            const results = await Promise.all(
                updates.map(u => 
                    supabase.from('product_variants').update({ table_settings: u.table_settings }).eq('id', u.id)
                )
            );
            
            const firstError = results.find(r => r.error);
            if (firstError) throw firstError.error;
        },
        onSuccess: () => {
            toast.success('變體規格已儲存');
            queryClient.invalidateQueries({ queryKey: ['product-variants-specs', productId] });
        },
        onError: (err: any) => {
            toast.error('儲存失敗：' + err.message);
        }
    });

    const handleValueChange = (variantId: string, specKey: string, value: any) => {
        setLocalData(prev => ({
            ...prev,
            [variantId]: {
                ...prev[variantId],
                [specKey]: value
            }
        }));
    };

    const applyToAll = (specKey: string, value: any) => {
        setLocalData(prev => {
            const next = { ...prev };
            Object.keys(next).forEach(vId => {
                next[vId] = { ...next[vId], [specKey]: value };
            });
            return next;
        });
        toast.info(`已將規格「${specs.find(s => s.id === specKey)?.name}」套用至所有變體`);
    };

    if (specsLoading || variantsLoading) {
        return <div className="flex items-center gap-2 p-8 justify-center text-muted-foreground"><Loader2 className="animate-spin" /> 讀取規格矩陣中...</div>;
    }

    if (specs.length === 0 || variants.length === 0) {
        return null;
    }

    return (
        <div className="space-y-4 border rounded-xl overflow-hidden bg-background">
            <div className="bg-muted/30 p-4 border-b flex justify-between items-center">
                <div>
                    <h3 className="text-sm font-bold">變體規格矩陣</h3>
                    <p className="text-xs text-muted-foreground">直接在表格中批次編輯各變體的詳細規格</p>
                </div>
                <Button 
                    size="sm" 
                    onClick={() => saveMutation.mutate()} 
                    disabled={saveMutation.isPending}
                >
                    {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    儲存矩陣變動
                </Button>
            </div>

            <div className="overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-muted/20">
                            <TableHead className="w-[180px] font-bold bg-muted/40 sticky left-0 z-10 border-r">規格項目</TableHead>
                            {variants.map(v => (
                                <TableHead key={v.id} className="min-w-[150px] text-center px-4 font-medium border-r last:border-r-0">
                                    <div className="truncate max-w-[140px]" title={v.name}>{v.name}</div>
                                </TableHead>
                            ))}
                            <TableHead className="w-[80px] text-center font-bold">批次操作</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {specs.map(spec => (
                            <TableRow key={spec.id} className="group hover:bg-muted/5">
                                <TableCell className="font-medium bg-muted/20 sticky left-0 z-10 border-r group-hover:bg-muted/30 transition-colors">
                                    <div className="text-xs font-bold text-primary mb-1">{spec.name}</div>
                                    <div className="text-[10px] text-muted-foreground opacity-60">ID: {spec.id.substring(0, 8)}...</div>
                                </TableCell>
                                {variants.map(v => (
                                    <TableCell key={v.id} className="p-2 border-r last:border-r-0">
                                        <div className="flex justify-center">
                                            {spec.type === 'boolean' ? (
                                                <Checkbox 
                                                    checked={localData[v.id]?.[spec.id] === 'true'}
                                                    onCheckedChange={(val) => handleValueChange(v.id, spec.id, val ? 'true' : 'false')}
                                                />
                                            ) : spec.options && spec.options.length > 0 && spec.type !== 'multiselect' ? (
                                                <Select 
                                                    value={localData[v.id]?.[spec.id] || ''}
                                                    onValueChange={(val) => handleValueChange(v.id, spec.id, val)}
                                                >
                                                    <SelectTrigger className="h-8 text-xs border-none bg-muted/30 hover:bg-muted/50 focus:ring-0">
                                                        <SelectValue placeholder="-" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {spec.options.map(opt => (
                                                            <SelectItem key={opt} value={opt} className="text-xs">{opt}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            ) : (
                                                <Input 
                                                    value={localData[v.id]?.[spec.id] || ''}
                                                    onChange={(e) => handleValueChange(v.id, spec.id, e.target.value)}
                                                    className="h-8 text-xs border-none bg-muted/30 hover:bg-muted/50 focus:ring-0 text-center"
                                                    placeholder="輸入..."
                                                />
                                            )}
                                        </div>
                                    </TableCell>
                                ))}
                                <TableCell className="text-center bg-primary/5">
                                    <Button 
                                        variant="ghost" 
                                        size="icon" 
                                        className="h-8 w-8 text-primary hover:bg-primary/20"
                                        title="將第一個變體的值套用至全部"
                                        onClick={() => {
                                            const firstVal = localData[variants[0].id]?.[spec.id];
                                            applyToAll(spec.id, firstVal);
                                        }}
                                    >
                                        <Copy className="h-4 w-4" />
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
