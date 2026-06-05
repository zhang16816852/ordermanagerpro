import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Check, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { QuickColorAdd } from '@/pages/admin/libraries/colors/QuickColorAdd';
import { ImportRow } from '../useProductImport';

interface ColorCellProps {
    row: ImportRow;
    index: number;
    onUpdate: (index: number, field: keyof ImportRow, value: any) => void;
    allColors: any[];
    searchQuery: string;
    setSearchQuery: (q: string) => void;
}

export function ColorCell({ row, index, onUpdate, allColors, searchQuery, setSearchQuery }: ColorCellProps) {
    const [addingColor, setAddingColor] = useState(false);

    if (!row.is_variant) {
        return <span className="text-[10px] text-muted-foreground/30 pl-2">-</span>;
    }

    const matchedColor = allColors.find(c =>
        c.name.trim().toLowerCase() === (row.option_3 || '').trim().toLowerCase()
    );

    return (
        <Popover>
            <PopoverTrigger asChild>
                <div className={cn(
                    "flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-muted/50 transition-all border",
                    row.is_variant && row.option_3 && !matchedColor
                        ? "bg-destructive/10 border-destructive/20 text-destructive"
                        : "border-transparent bg-muted/30"
                )}>
                    {matchedColor ? (
                        <div className="w-3 h-3 rounded-full border border-black/10 shadow-sm shrink-0"
                            style={{ backgroundColor: matchedColor.hex_code || '#808080' }} />
                    ) : (
                        <div className="w-3 h-3 rounded-full border border-dashed border-muted-foreground/50 shrink-0" />
                    )}
                    <span className={cn("text-[10px] font-medium truncate", !row.option_3 && "text-muted-foreground italic font-normal")}>
                        {row.option_3 || '點擊設定'}
                    </span>
                </div>
            </PopoverTrigger>
            <PopoverContent className="p-0 w-[240px]" align="start" onWheel={(e) => e.stopPropagation()}>
                {addingColor ? (
                    <QuickColorAdd
                        initialName={searchQuery || row.option_3 || ''}
                        onSuccess={(newColor) => {
                            onUpdate(index, 'option_3', newColor.name);
                            setAddingColor(false);
                        }}
                        onCancel={() => setAddingColor(false)}
                    />
                ) : (
                    <Command>
                        <CommandInput placeholder="搜尋或輸入..." className="h-9 text-xs"
                            value={searchQuery} onValueChange={setSearchQuery} />
                        <CommandList className="max-h-[300px] overflow-y-auto">
                            <CommandGroup heading="快速操作">
                                <CommandItem onSelect={() => setAddingColor(true)}
                                    className="flex items-center gap-2 py-2 cursor-pointer text-primary">
                                    <Plus className="h-3.5 w-3.5" />
                                    <span className="text-xs">建立新顏色 {searchQuery || row.option_3 ? `"${searchQuery || row.option_3}"` : ''}</span>
                                </CommandItem>
                            </CommandGroup>
                            <CommandEmpty className="py-3 text-xs text-center text-muted-foreground">
                                找不到顏色 "{searchQuery}"
                            </CommandEmpty>
                            <CommandGroup heading="現有顏色庫">
                                {allColors.map(c => (
                                    <CommandItem key={c.id}
                                        onSelect={() => { onUpdate(index, 'option_3', c.name); setSearchQuery(''); }}
                                        className="flex items-center gap-2 py-2 cursor-pointer">
                                        <div className="w-3.5 h-3.5 rounded-full border border-black/10 shrink-0"
                                            style={{ backgroundColor: c.hex_code || '#808080' }} />
                                        <div className="flex flex-col flex-1 min-w-0">
                                            <span className="text-xs font-medium truncate">{c.name}</span>
                                            <span className="text-[10px] text-muted-foreground uppercase">{c.code}</span>
                                        </div>
                                        {(row.option_3 || '').trim().toLowerCase() === c.name.trim().toLowerCase() &&
                                            <Check className="h-3.5 w-3.5 text-primary" />}
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        </CommandList>
                    </Command>
                )}
            </PopoverContent>
        </Popover>
    );
}
