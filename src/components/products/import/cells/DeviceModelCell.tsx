import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Plus, Check, X, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { ImportRow } from '../useProductImport';

interface DeviceModelCellProps {
    value: string | undefined;
    isVariant?: boolean;
    index: number;
    onUpdate: (index: number, field: keyof ImportRow, value: any) => void;
    allDeviceModels: any[];
    allDeviceBrands: any[];
    allDeviceGroups: any[];
    addModel: (data: any) => Promise<any>;
}

export function DeviceModelCell({
    value, isVariant = false, index, onUpdate,
    allDeviceModels, allDeviceBrands, allDeviceGroups,
    addModel
}: DeviceModelCellProps) {
    const [addingModel, setAddingModel] = useState(false);
    const [localSearch, setLocalSearch] = useState('');
    const [modelForm, setModelForm] = useState({ name: '', brand_id: '', device_series: '', device_type: 'smartphone' });

    const renderBadges = () => {
        if (!value) return <span className="text-[10px] text-muted-foreground/50 pl-1 italic">設定型號</span>;

        const models = value.split(',').map(s => s.trim()).filter(Boolean);
        const displayLimit = 2;
        return (
            <div className="flex flex-wrap gap-1">
                {models.slice(0, displayLimit).map((part, i) => {
                    let type: 'group' | 'model' | 'exclude' = 'model';
                    let name = part;
                    let exists = false;
                    const lowerPart = part.toLowerCase();

                    const checkExists = (n: string) => {
                        const s = n.trim().toLowerCase();
                        return allDeviceModels.some(m =>
                            (m.name?.trim().toLowerCase() === s) ||
                            (Array.isArray(m.aliases) && m.aliases.some((a: string) => a?.trim().toLowerCase() === s))
                        );
                    };

                    if (lowerPart.startsWith('group:')) {
                        type = 'group';
                        name = part.substring(6).trim();
                        exists = allDeviceGroups.some(g => g.name.trim().toLowerCase() === name.toLowerCase());
                    } else if (lowerPart.startsWith('exclude:')) {
                        type = 'exclude';
                        name = part.substring(8).trim();
                        exists = checkExists(name);
                    } else if (lowerPart.startsWith('model:')) {
                        type = 'model';
                        name = part.substring(6).trim();
                        exists = checkExists(name);
                    } else {
                        exists = checkExists(name);
                    }

                    return (
                        <Badge key={i}
                            variant={exists ? "secondary" : "destructive"}
                            className={cn(
                                "text-[9px] px-1 h-4 whitespace-nowrap",
                                type === 'group' && "bg-blue-100 text-blue-700 border-blue-200",
                                type === 'exclude' && "bg-rose-50 text-rose-600 border-rose-200 line-through opacity-70",
                                isVariant && type === 'model' && "bg-indigo-100 text-indigo-700 border-indigo-200"
                            )}
                        >
                            {type === 'group' && <Plus className="h-2 w-2 mr-0.5 inline" />}
                            {type === 'exclude' && <X className="h-2 w-2 mr-0.5 inline" />}
                            {name}
                        </Badge>
                    );
                })}
                {models.length > displayLimit && (
                    <Badge variant="outline" className="text-[9px] px-1 h-4 bg-background/50 border-dashed">
                        +{models.length - displayLimit}
                    </Badge>
                )}
            </div>
        );
    };

    return (
        <Popover>
            <PopoverTrigger asChild>
                <div className={cn(
                    "flex flex-wrap items-center gap-1 p-1 rounded-md cursor-pointer hover:bg-muted/50 transition-all border min-h-[32px]",
                    isVariant ? "border-transparent bg-indigo-50/30" : "border-transparent bg-muted/30"
                )}>
                    {renderBadges()}
                </div>
            </PopoverTrigger>
            <PopoverContent className="p-0 w-[260px]" align="start" onWheel={(e) => e.stopPropagation()}>
                {addingModel ? (
                    <div className="p-3 space-y-3 bg-background">
                        <div className="flex items-center justify-between border-b pb-2">
                            <h4 className="text-xs font-bold text-primary">新增裝置型號</h4>
                            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setAddingModel(false)}>
                                <X className="h-3 w-3" />
                            </Button>
                        </div>
                        <div className="space-y-2">
                            <div className="space-y-1">
                                <label className="text-[10px] text-muted-foreground">裝置名稱</label>
                                <Input
                                    value={modelForm.name}
                                    onChange={e => setModelForm({ ...modelForm, name: e.target.value })}
                                    placeholder="例：iPhone 15 Pro"
                                    className="h-8 text-xs"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] text-muted-foreground">所屬品牌</label>
                                <Select value={modelForm.brand_id} onValueChange={v => setModelForm({ ...modelForm, brand_id: v })}>
                                    <SelectTrigger className="h-8 text-xs">
                                        <SelectValue placeholder="選擇品牌" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {allDeviceBrands.map(b => (
                                            <SelectItem key={b.id} value={b.id} className="text-xs">{b.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <Button className="w-full h-8 text-xs" onClick={async () => {
                            if (!modelForm.name || !modelForm.brand_id) {
                                toast.error('名稱與品牌為必填');
                                return;
                            }
                            const res = await addModel(modelForm);
                            if (res) {
                                const current = value ? value.split(',').map(s => s.trim()) : [];
                                const cleanName = res.name.replace(/\s+/g, ' ').trim();
                                if (!current.includes(cleanName)) {
                                    onUpdate(index, isVariant ? 'variant_device_models' : 'device_models', [...current, cleanName].join(', '));
                                }
                                setAddingModel(false);
                                toast.success(`已建立並套用：${res.name}`);
                            }
                        }}>
                            建立並套用
                        </Button>
                    </div>
                ) : (
                    <Command>
                        <CommandInput placeholder="搜尋型號..." className="h-9 text-xs" value={localSearch} onValueChange={setLocalSearch} />
                        <CommandList className="max-h-[300px] overflow-y-auto">
                            <CommandGroup heading="快速操作">
                                <CommandItem
                                    onSelect={() => {
                                        setModelForm({ name: localSearch, brand_id: '', device_series: '', device_type: 'smartphone' });
                                        setAddingModel(true);
                                    }}
                                    className="flex items-center gap-2 py-2 cursor-pointer text-primary"
                                >
                                    <Plus className="h-3.5 w-3.5" />
                                    <span className="text-xs">建立新型號 {localSearch ? `"${localSearch}"` : ''}</span>
                                </CommandItem>
                            </CommandGroup>
                            <CommandEmpty className="py-3 text-xs text-center text-muted-foreground">找不到型號</CommandEmpty>
                            <CommandGroup heading="型號群組">
                                {allDeviceGroups.map(g => {
                                    const isSelected = value?.split(',').map(s => s.trim().toLowerCase()).includes(`group:${g.name.toLowerCase()}`);
                                    return (
                                        <CommandItem key={`group-${g.id}`}
                                            onSelect={() => {
                                                const current = value ? value.split(',').map(s => s.trim()) : [];
                                                const groupValue = `group:${g.name.replace(/\s+/g, ' ').trim()}`;
                                                const next = isSelected ? current.filter(s => s.toLowerCase() !== groupValue.toLowerCase()) : [...current, groupValue];
                                                onUpdate(index, isVariant ? 'variant_device_models' : 'device_models', next.join(', '));
                                            }}
                                            className={cn("flex items-center gap-2 py-2 cursor-pointer", isSelected && "bg-blue-50 text-blue-700 font-medium")}
                                        >
                                            <div className="flex flex-col flex-1 min-w-0">
                                                <span className="text-xs font-medium truncate">{g.name}</span>
                                                <span className="text-[9px] text-muted-foreground">群組</span>
                                            </div>
                                            {isSelected && <Check className="h-3.5 w-3.5 text-blue-600" />}
                                        </CommandItem>
                                    );
                                })}
                            </CommandGroup>
                            <CommandGroup heading="現有型號庫">
                                {[...allDeviceModels].sort((a, b) => {
                                    const aSel = value?.split(',').map(s => s.trim().toLowerCase()).includes(a.name.toLowerCase());
                                    const bSel = value?.split(',').map(s => s.trim().toLowerCase()).includes(b.name.toLowerCase());
                                    if (aSel && !bSel) return -1;
                                    if (!aSel && bSel) return 1;
                                    return a.name.localeCompare(b.name);
                                }).map(m => {
                                    const isSelected = value?.split(',').map(s => s.trim().toLowerCase()).includes(m.name.toLowerCase());
                                    return (
                                        <CommandItem key={m.id}
                                            onSelect={() => {
                                                const current = value ? value.split(',').map(s => s.trim()) : [];
                                                const next = isSelected ? current.filter(s => s.toLowerCase() !== m.name.toLowerCase()) : [...current, m.name.replace(/\s+/g, ' ').trim()];
                                                onUpdate(index, isVariant ? 'variant_device_models' : 'device_models', next.join(', '));
                                            }}
                                            className={cn("flex items-center gap-2 py-2 cursor-pointer", isSelected && "bg-primary/5 text-primary font-medium")}
                                        >
                                            <div className="flex flex-col flex-1 min-w-0">
                                                <span className="text-xs font-medium truncate">{m.name}</span>
                                                <span className="text-[9px] text-muted-foreground truncate">
                                                    {allDeviceBrands.find(b => b.id === m.brand_id)?.name} {m.device_series ? `· ${m.device_series}` : ''}
                                                </span>
                                            </div>
                                            {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
                                        </CommandItem>
                                    );
                                })}
                            </CommandGroup>
                        </CommandList>
                    </Command>
                )}
            </PopoverContent>
        </Popover>
    );
}
