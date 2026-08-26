import { useState, useMemo } from 'react';
import { Check, ChevronsUpDown, X, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';

export interface SearchableSelectOption {
    id: string;
    name: string;
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
        const q = search.toLowerCase();
        return options.filter(o => o.name.toLowerCase().includes(q));
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
                    className={cn('w-full justify-between', !value && 'text-muted-foreground', className)}
                >
                    <span className="truncate">{selected ? selected.name : placeholder}</span>
                    <div className="ml-2 flex items-center gap-1">
                        {value && (
                            <span
                                role="button"
                                tabIndex={0}
                                className="rounded-sm p-0.5 hover:bg-muted-foreground/20"
                                onClick={(e) => { e.stopPropagation(); onChange(null); }}
                            >
                                <X className="h-3 w-3" />
                            </span>
                        )}
                        <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
                    </div>
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
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
                    <CommandList>
                        {clearable && (
                            <CommandItem
                                value="__clear__"
                                onSelect={() => handleSelect(null)}
                                className="text-muted-foreground"
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
                                        >
                                            <Check className={cn('h-4 w-4', isSelected ? 'opacity-100' : 'opacity-0')} />
                                            <span className="truncate">{o.name}</span>
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
