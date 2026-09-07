import { useMemo, useRef, useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { X, Smartphone } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ModelPickerOption {
  id: string;
  name: string;
  brand_name?: string | null;
  device_type?: string | null;
  aliases?: string[] | null;
  specifications?: any;
}

export interface ModelPickerProps {
  models: ModelPickerOption[];
  value: string | null;
  onChange: (modelId: string | null) => void;
  filterLabel?: string;
  className?: string;
}

export function ModelPicker({ models, value, onChange, className }: ModelPickerProps) {
  const [typeFilter, setTypeFilter] = useState('all');
  const [brandFilter, setBrandFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);

  const selected = models.find(m => m.id === value) || null;

  const types = useMemo(() => Array.from(new Set(models.map(m => m.device_type).filter(Boolean))) as string[], [models]);
  const brands = useMemo(() => {
    const map = new Map<string, string>();
    models.forEach(m => {
      if (m.brand_name) map.set(m.brand_name, m.brand_name);
    });
    return Array.from(map.values());
  }, [models]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return models.filter(m => {
      if (typeFilter !== 'all' && m.device_type !== typeFilter) return false;
      if (brandFilter !== 'all' && m.brand_name !== brandFilter) return false;
      if (q) {
        const name = `${m.brand_name || ''} ${m.name}`.toLowerCase();
        const aliases = (m.aliases || []).map(a => a.toLowerCase());
        if (!name.includes(q) && !aliases.some(a => a.includes(q))) return false;
      }
      return true;
    });
  }, [models, typeFilter, brandFilter, query]);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selected) {
      setQuery(`${selected.brand_name ? selected.brand_name + ' ' : ''}${selected.name}`);
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (model: ModelPickerOption) => {
    onChange(model.id);
    if (selected?.id !== model.id) {
      setQuery(`${model.brand_name ? model.brand_name + ' ' : ''}${model.name}`);
    }
    setFocused(false);
  };

  const clear = () => {
    onChange(null);
    setQuery('');
  };

  const showList = focused && (query.trim().length > 0 || !selected);

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex gap-2">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="設備類型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部類型</SelectItem>
            {types.map(t => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={brandFilter} onValueChange={setBrandFilter}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="廠牌" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部廠牌</SelectItem>
            {brands.map(b => (
              <SelectItem key={b} value={b}>{b}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="relative">
        <Label className="sr-only">型號搜尋</Label>
        <Input
          ref={inputRef}
          value={selected ? `${selected.brand_name ? selected.brand_name + ' ' : ''}${selected.name}` : query}
          onChange={(e) => {
            if (selected) onChange(null);
            setQuery(e.target.value);
            setFocused(true);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder="輸入型號關鍵字搜尋..."
          className="pr-8"
        />
        {selected && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
            onMouseDown={(e) => { e.preventDefault(); clear(); }}
            aria-label="清除型號"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
        <Smartphone className="absolute right-8 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />

        {showList && (
          <div className="absolute z-50 mt-1 w-full max-h-56 overflow-auto rounded-md border bg-popover shadow-md">
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-sm text-muted-foreground">找不到符合的型號</p>
            )}
            {filtered.slice(0, 50).map(m => (
              <button
                key={m.id}
                type="button"
                className={cn(
                  'w-full text-left px-3 py-2 text-sm hover:bg-accent',
                  m.id === value && 'bg-accent'
                )}
                onMouseDown={() => pick(m)}
              >
                <span className="font-medium">{m.name}</span>
                {m.brand_name && <span className="ml-2 text-xs text-muted-foreground">{m.brand_name}</span>}
                {m.device_type && <span className="ml-2 text-xs text-muted-foreground">{m.device_type}</span>}
                {m.aliases && m.aliases.length > 0 && (
                  <span className="ml-2 text-xs text-muted-foreground">別名：{m.aliases.join('、')}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      {selected && (
        <p className="text-xs text-muted-foreground">
          已選擇：{selected.brand_name ? selected.brand_name + ' ' : ''}{selected.name}
        </p>
      )}
    </div>
  );
}