import { useMemo, useRef, useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { X, Smartphone, Plus } from 'lucide-react';
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
  value: string | string[] | null;
  onChange: (modelId: string | string[] | null) => void;
  multi?: boolean;
  filterLabel?: string;
  className?: string;
}

export function ModelPicker({ models, value, onChange, multi = false, className }: ModelPickerProps) {
  const [typeFilter, setTypeFilter] = useState('all');
  const [brandFilter, setBrandFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);

  const selectedIds = useMemo(() => (Array.isArray(value) ? value : value ? [value] : []), [value]);
  const selectedModels = useMemo(() => selectedIds.map(id => models.find(m => m.id === id)).filter(Boolean) as ModelPickerOption[], [selectedIds, models]);

  const types = useMemo(() => Array.from(new Set(models.map(m => m.device_type).filter(Boolean))) as string[], [models]);
  const brands = useMemo(() => {
    const map = new Map<string, string>();
    models.forEach(m => {
      if (m.brand_name) map.set(m.brand_name, m.brand_name);
    });
    return Array.from(map.values());
  }, [models]);

  const filtered = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return models.filter(m => {
      if (typeFilter !== 'all' && m.device_type !== typeFilter) return false;
      if (brandFilter !== 'all' && m.brand_name !== brandFilter) return false;
      if (selectedIds.includes(m.id)) return false; // 已選的不重複顯示
      if (tokens.length > 0) {
        const haystack = `${m.brand_name || ''} ${m.name} ${(m.aliases || []).join(' ')}`.toLowerCase();
        if (!tokens.every(t => haystack.includes(t))) return false;
      }
      return true;
    });
  }, [models, typeFilter, brandFilter, query, selectedIds]);

  const inputRef = useRef<HTMLInputElement>(null);

  const pick = (model: ModelPickerOption) => {
    if (multi) {
      onChange([...selectedIds, model.id]);
    } else {
      onChange(model.id);
    }
    setQuery('');
    setFocused(false);
  };

  const remove = (id: string) => {
    if (multi) {
      const next = selectedIds.filter(x => x !== id);
      onChange(next.length === 0 ? null : next);
    } else {
      onChange(null);
    }
  };

  const clear = () => {
    onChange(null);
    setQuery('');
  };

  const showList = focused && (query.trim().length > 0 || selectedIds.length === 0);

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

      {/* 已選型號 chips */}
      {selectedModels.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedModels.map(m => (
            <span key={m.id} className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-xs">
              {m.brand_name ? `${m.brand_name} ` : ''}{m.name}
              <button type="button" onClick={() => remove(m.id)} className="text-muted-foreground hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {!multi && selectedModels.length > 0 && (
            <button type="button" onClick={clear} className="text-xs text-muted-foreground underline">清除</button>
          )}
        </div>
      )}

      {/* 搜尋輸入（多選時永遠顯示；單選時未選時顯示） */}
      {(multi || selectedIds.length === 0) && (
        <div className="relative">
          <Label className="sr-only">型號搜尋</Label>
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setFocused(true); }}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            placeholder={multi ? '搜尋並新增型號（可多選）...' : '輸入型號關鍵字搜尋...'}
            className="pr-8"
          />
          <Smartphone className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />

          {showList && (
            <div className="absolute z-50 mt-1 w-full max-h-56 overflow-auto rounded-md border bg-popover shadow-md">
              {filtered.length === 0 && (
                <p className="px-3 py-2 text-sm text-muted-foreground">找不到符合的型號</p>
              )}
              {filtered.slice(0, 50).map(m => (
                <button
                  key={m.id}
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent"
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
      )}

      {selectedModels.length === 0 && (
        <p className="text-xs text-muted-foreground">已選擇：無</p>
      )}
      {selectedModels.length > 0 && !multi && (
        <p className="text-xs text-muted-foreground">
          已選擇：{selectedModels[0].brand_name ? selectedModels[0].brand_name + ' ' : ''}{selectedModels[0].name}
        </p>
      )}
      {multi && selectedModels.length > 0 && (
        <p className="text-xs text-muted-foreground">已選擇 {selectedModels.length} 個型號</p>
      )}
    </div>
  );
}