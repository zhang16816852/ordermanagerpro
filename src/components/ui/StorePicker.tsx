import { useState, useMemo } from 'react';
import { Check, ChevronsUpDown, X, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandList } from '@/components/ui/command';

export interface StoreOption {
  id: string;
  name: string;
  code?: string | null;
  brand?: string | null;
}

export interface StorePickerProps {
  stores: StoreOption[];
  value: string | string[];
  onChange: (value: string | string[]) => void;
  multiple?: boolean;
  valueField?: 'id' | 'brand';
  placeholder?: string;
  searchPlaceholder?: string;
  notFoundText?: string;
  disabled?: boolean;
}

export function StorePicker({
  stores,
  value,
  onChange,
  multiple = false,
  valueField = 'id',
  placeholder = '選擇連鎖客戶...',
  searchPlaceholder = '搜尋連鎖客戶...',
  notFoundText = '找不到符合的客戶',
  disabled = false,
}: StorePickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const selectedValues = useMemo(
    () => (Array.isArray(value) ? value : value ? [value] : []),
    [value],
  );
  const hasSelection = selectedValues.length > 0;

  const selectedStores = useMemo(
    () => stores.filter(s => selectedValues.includes(s[valueField] as string)),
    [stores, selectedValues, valueField],
  );

  const visibleStores = useMemo(() => {
    const q = search.trim().toLowerCase();
    const selected: StoreOption[] = [];
    const rest: StoreOption[] = [];
    for (const store of stores) {
      if (q && !store.name.toLowerCase().includes(q) && !store.code?.toLowerCase().includes(q)) continue;
      if (selectedValues.includes(store[valueField] as string)) selected.push(store);
      else rest.push(store);
    }
    return [...selected, ...rest];
  }, [stores, selectedValues, valueField, search]);

  const label = multiple
    ? hasSelection
      ? `已選 ${selectedStores.length} 家`
      : placeholder
    : selectedStores.length > 0
      ? selectedStores[0].code
        ? `${selectedStores[0].code} - ${selectedStores[0].name}`
        : selectedStores[0].name
      : placeholder;

  const handleSelect = (selectedValue: string) => {
    if (multiple) {
      onChange(
        selectedValues.includes(selectedValue)
          ? selectedValues.filter(v => v !== selectedValue)
          : [...selectedValues, selectedValue],
      );
    } else {
      onChange(selectedValue);
      setOpen(false);
      setSearch('');
    }
  };

  const handleClear = () => {
    onChange(multiple ? [] : '');
    setSearch('');
  };

  const handleToggleAll = () => {
    if (hasSelection) {
      onChange([]);
    } else {
      const filteredValues = visibleStores.map(s => s[valueField] as string);
      onChange(Array.from(new Set([...selectedValues, ...filteredValues])));
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('w-full justify-between', !multiple && !value && 'text-muted-foreground')}
        >
          {label}
          <div className="ml-2 flex items-center gap-1">
            {((multiple && hasSelection) || (!multiple && value)) && (
              <span
                role="button"
                tabIndex={0}
                className="rounded-sm p-0.5 hover:bg-muted-foreground/20"
                onClick={(e) => { e.stopPropagation(); handleClear(); }}
              >
                <X className="h-3 w-3" />
              </span>
            )}
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command shouldFilter={false}>
          <div className="flex items-center border-b px-3">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <input
              className="flex h-10 w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {multiple && visibleStores.length > 0 && (
            <button
              type="button"
              className="flex w-full items-center justify-start border-b px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              onClick={handleToggleAll}
            >
              <span className={cn('font-medium', hasSelection && 'text-primary')}>
                {hasSelection ? '清除' : '全選'}
              </span>
            </button>
          )}
          <CommandList>
            {visibleStores.length === 0 && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {notFoundText}
              </div>
            )}
            {visibleStores.map((store) => {
              const itemValue = store[valueField] as string;
              const isSelected = selectedValues.includes(itemValue);
              return (
                <div
                  key={store.id}
                  role="option"
                  aria-selected={isSelected}
                  data-disabled={false}
                  className={cn(
                    'relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground',
                    isSelected && 'bg-accent text-accent-foreground',
                  )}
                  onClick={() => handleSelect(itemValue)}
                >
                  {multiple && (
                    <div className={cn(
                      'flex h-4 w-4 items-center justify-center rounded-sm border shrink-0',
                      isSelected && 'bg-primary border-primary text-primary-foreground',
                    )}>
                      {isSelected && <Check className="h-3 w-3" />}
                    </div>
                  )}
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="truncate">{store.name}</span>
                    {store.code && (
                      <span className="text-xs text-muted-foreground">{store.code}</span>
                    )}
                  </div>
                  {!multiple && isSelected && <Check className="h-4 w-4 shrink-0 text-primary" />}
                </div>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}