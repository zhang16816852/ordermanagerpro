import { useState, useMemo } from 'react';
import { Check, ChevronsUpDown, X, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';

export interface SearchableSelectOption {
    id: string;
    name: string;
    subLabel?: string;
    badge?: string;
    searchKeywords?: string[];
    group?: string;
    disabled?: boolean;
}

export interface SearchableSelectProps {
    options: SearchableSelectOption[];
    value: string | null | undefined;
    onChange: (id: string | null) => void;
    placeholder?: string;
    searchPlaceholder?: string;
    emptyText?: string;
    clearable?: boolean;
    clearLabel?: string;
    disabled?: boolean;
    className?: string;
}

export function SearchableSelect({
    options,
    value,
    onChange,
    placeholder = '請選擇...',
    searchPlaceholder = '搜尋...',
    emptyText = '找不到符合的項目',
    clearable = true,
    clearLabel = '無',
    disabled = false,
    className,
}: SearchableSelectProps) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');

    const selected = options.find(o => o.id === value) || null;

    const filtered = useMemo(() => {
        if (!search) return options;
        const q = search.trim().toLowerCase();
        return options.filter(o => {
            if (o.name.toLowerCase().includes(q)) return true;
            if (o.group && o.group.toLowerCase().includes(q)) return true;
            if (o.subLabel && o.subLabel.toLowerCase().includes(q)) return true;
            if (o.searchKeywords && o.searchKeywords.some(k => k.toLowerCase().includes(q))) return true;
            return false;
        });
    }, [options, search]);

    const grouped = useMemo(() => {
        const map = new Map<string, SearchableSelectOption[]>();
        const order: string[] = [];
        filtered.forEach(o => {
            const g = o.group || '';
            if (!map.has(g)) {
                map.set(g, []);
                order.push(g);
            }
            map.get(g)!.push(o);
        });
        return order.map(g => ({ group: g, items: map.get(g)! }));
    }, [filtered]);

    const handleSelect = (id: string | null) => {
        onChange(id);
        setOpen(false);
        setSearch('');
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    disabled={disabled}
                    title={selected ? selected.name : undefined}
                    className={cn('w-full justify-between min-w-0', !value && 'text-muted-foreground', className)}
                >
                    <span className="truncate text-left flex-1 min-w-0">
                        {selected ? selected.name : placeholder}
                    </span>
                    <div className="ml-2 flex items-center gap-1 shrink-0">
                        {value && (
                            <span
                                role="button"
                                tabIndex={0}
                                className="rounded-sm p-0.5 hover:bg-muted-foreground/20 text-muted-foreground hover:text-foreground transition-colors"
                                onClick={(e) => { e.stopPropagation(); onChange(null); }}
                                title="清除"
                            >
                                <X className="h-3.5 w-3.5" />
                            </span>
                        )}
                        <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
                    </div>
                </Button>
            </PopoverTrigger>
            <PopoverContent 
                className="w-[var(--radix-popover-trigger-width)] min-w-[340px] max-w-[min(560px,95vw)] p-0" 
                align="start"
            >
                <Command shouldFilter={false}>
                    <div className="flex items-center border-b px-3">
                        <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                        <input
                            className="flex h-10 w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
                            placeholder={searchPlaceholder}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>
                    <CommandList className="max-h-[300px]">
                        {clearable && (
                            <CommandItem
                                value="__clear__"
                                onSelect={() => handleSelect(null)}
                                className="text-muted-foreground cursor-pointer"
                            >
                                {clearLabel}
                            </CommandItem>
                        )}
                        {grouped.length === 0 && (
                            <div className="py-6 text-center text-sm text-muted-foreground">{emptyText}</div>
                        )}
                        {grouped.map(({ group, items }) => (
                            <CommandGroup key={group || 'default'} heading={group || undefined}>
                                {items.map(o => {
                                    const isSelected = o.id === value;
                                    return (
                                        <CommandItem
                                            key={o.id}
                                            value={o.id}
                                            disabled={o.disabled}
                                            onSelect={() => handleSelect(o.id)}
                                            className="flex items-center justify-between gap-2 py-2 px-3 cursor-pointer"
                                        >
                                            <div className="flex items-center gap-2 min-w-0 flex-1">
                                                <Check className={cn('h-4 w-4 shrink-0', isSelected ? 'opacity-100' : 'opacity-0')} />
                                                <div className="flex flex-col min-w-0 flex-1">
                                                    <span className="text-sm font-medium leading-tight text-foreground truncate" title={o.name}>
                                                        {o.name}
                                                    </span>
                                                    {o.subLabel && (
                                                        <span className="text-xs text-muted-foreground truncate mt-0.5">
                                                            {o.subLabel}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            {o.badge && (
                                                <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0 font-normal">
                                                    {o.badge}
                                                </span>
                                            )}
                                        </CommandItem>
                                    );
                                })}
                            </CommandGroup>
                        ))}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
