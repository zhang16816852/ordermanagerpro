import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Package, Plus, Check, Loader2, X, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { useRepairParts, useRepairPartTags, partLabelOf, RepairPart } from '@/hooks/useRepairParts';

export interface RepairPartSelection {
  repair_part_id: string | null;
  product_id: string | null;
  variant_id: string | null;
  part_name: string;
  unit_cost: number;
}

interface RepairPartPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (selection: RepairPartSelection) => void;
  currentValue?: { repair_part_id: string | null } | null;
  deviceModelId?: string | null;
  onCreatePart?: () => void;
}

type Scope = 'device' | 'deviceOnly' | 'all';

export function RepairPartPickerDialog({
  open,
  onOpenChange,
  onSelect,
  currentValue,
  deviceModelId,
  onCreatePart,
}: RepairPartPickerDialogProps) {
  const { parts, isLoading } = useRepairParts();
  const { tags: allTags } = useRepairPartTags();
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [scope, setScope] = useState<Scope>(deviceModelId ? 'device' : 'all');
  const [modelFilter, setModelFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const modelOptions = useMemo(() => {
    const map = new Map<string, string>();
    parts.forEach(p => {
      if (p.device_model_id && p.device_model?.name) {
        map.set(p.device_model_id, p.device_model.name);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [parts]);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return parts.filter((p) => {
      if (!p.is_active && q === '' && activeTags.length === 0) return false;

      if (scope === 'device' && deviceModelId) {
        if (p.device_model_id !== deviceModelId && p.device_model_id !== null) return false;
      } else if (scope === 'deviceOnly' && deviceModelId) {
        if (p.device_model_id !== deviceModelId) return false;
      }
      if (modelFilter !== 'all' && (p.device_model_id || '') !== modelFilter) return false;

      if (activeTags.length > 0 && !activeTags.some(t => (p.tags || []).includes(t))) return false;

      if (q) {
        const haystack = [
          p.name,
          p.device_model?.name || '',
          p.description || '',
          ...(p.tags || []),
          ...p.links.map(l => [l.product_name, l.variant_name, l.sku, l.spec_label].filter(Boolean).join(' ')),
        ].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => {
      // 本機型零件優先，其次通用零件
      const rank = (p: RepairPart) => {
        if (!deviceModelId) return 0;
        if (p.device_model_id === deviceModelId) return 0;
        if (p.device_model_id === null) return 1;
        return 2;
      };
      const d = rank(a) - rank(b);
      if (d !== 0) return d;
      return a.sort_order - b.sort_order || a.name.localeCompare(b.name);
    });
  }, [parts, searchTerm, activeTags, scope, modelFilter, deviceModelId]);

  const toggleTag = (tag: string) => {
    setActiveTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  };

  const selectLink = (part: RepairPart, link: RepairPart['links'][number]) => {
    onSelect({
      repair_part_id: part.id,
      product_id: link.product_id,
      variant_id: link.variant_id,
      part_name: partLabelOf(part, link),
      unit_cost: link.unit_cost || part.default_unit_cost || 0,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0 gap-0 overflow-hidden sm:rounded-xl">
        <DialogHeader className="p-4 pb-3 border-b bg-muted/20">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <DialogTitle className="text-base font-semibold flex items-center gap-2">
                <Package className="h-4 w-4 text-primary shrink-0" />
                選擇維修零件
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                依零件型錄挑選，自動帶出品號、成本與庫存
              </DialogDescription>
            </div>
            {onCreatePart && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1 shrink-0"
                onClick={() => {
                  onOpenChange(false);
                  onCreatePart();
                }}
              >
                <Plus className="h-3.5 w-3.5" />
                建立新零件
              </Button>
            )}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜尋零件名稱、型號、SKU 或標籤..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 pr-8 h-9 text-sm"
                autoFocus
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="清除搜尋"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {deviceModelId && (
              <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
                <SelectTrigger className="h-9 w-36 shrink-0 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="device" className="text-xs">本機型＋通用</SelectItem>
                  <SelectItem value="deviceOnly" className="text-xs">僅本機型</SelectItem>
                  <SelectItem value="all" className="text-xs">全部型號</SelectItem>
                </SelectContent>
              </Select>
            )}

            <Select value={modelFilter} onValueChange={setModelFilter}>
              <SelectTrigger className="h-9 w-32 shrink-0 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">型號：全部</SelectItem>
                {modelOptions.map(m => (
                  <SelectItem key={m.id} value={m.id} className="text-xs">{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {allTags.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground shrink-0">標籤</span>
              {allTags.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleTag(t.name)}
                  className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                    activeTags.includes(t.name)
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
                  }`}
                >
                  {t.name}
                </button>
              ))}
              {activeTags.length > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveTags([])}
                  className="text-[11px] text-muted-foreground hover:text-foreground underline"
                >
                  清除
                </button>
              )}
            </div>
          )}
        </DialogHeader>

        <div className="p-2">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span className="text-xs">載入零件型錄中...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center px-4">
              <Package className="h-10 w-10 text-muted-foreground/40 mb-2" />
              <p className="text-sm font-medium text-foreground">找不到符合條件的維修零件</p>
              <p className="text-xs text-muted-foreground mt-1">
                {searchTerm || activeTags.length > 0 ? '請嘗試調整搜尋或標籤條件' : '目前尚無零件，可先建立零件型錄'}
              </p>
              {onCreatePart && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3 text-xs gap-1"
                  onClick={() => {
                    onOpenChange(false);
                    onCreatePart();
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  前往建立零件
                </Button>
              )}
            </div>
          ) : (
            <ScrollArea className="h-[380px] pr-2">
              <div className="space-y-1">
                {filtered.map(part => {
                  const isSelected = currentValue?.repair_part_id === part.id;
                  const isMulti = part.links.length > 1;
                  const isExpanded = expandedId === part.id;
                  const onlyLink = part.links.length === 1 ? part.links[0] : null;

                  return (
                    <div
                      key={part.id}
                      className={`rounded-lg border transition-colors ${
                        isSelected ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'border-border/60 bg-card'
                      }`}
                    >
                      <div
                        className={`flex items-center justify-between gap-2 p-2.5 ${
                          onlyLink && !isMulti ? 'cursor-pointer hover:bg-accent/40' : ''
                        } rounded-lg`}
                        onClick={() => {
                          if (isMulti) setExpandedId(isExpanded ? null : part.id);
                          else if (onlyLink) selectLink(part, onlyLink);
                        }}
                      >
                        <div className="min-w-0 flex-1 pr-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {isMulti && (
                              isExpanded
                                ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            )}
                            <span className="text-sm font-medium text-foreground truncate">
                              {partLabelOf(part)}
                            </span>
                            {part.device_model_id === null && (
                              <Badge variant="outline" className="h-5 px-1.5 text-[10px] shrink-0">通用</Badge>
                            )}
                            {!part.is_active && (
                              <Badge variant="secondary" className="h-5 px-1.5 text-[10px] shrink-0">停用</Badge>
                            )}
                            {(part.tags || []).map(t => (
                              <Badge key={t} variant="outline" className="h-5 px-1.5 text-[10px] font-normal shrink-0">{t}</Badge>
                            ))}
                          </div>

                          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
                            {part.links.length === 0 ? (
                              <span className="text-amber-600 flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3" />
                                尚未綁定庫存商品
                              </span>
                            ) : isMulti ? (
                              <span>共 {part.links.length} 種規格，請展開選擇</span>
                            ) : (
                              <>
                                {onlyLink?.sku && <span className="font-mono">SKU: {onlyLink.sku}</span>}
                                <span>成本: {formatCurrency(onlyLink!.unit_cost || part.default_unit_cost)}</span>
                                <span className={onlyLink!.stock > 0 ? 'text-emerald-600' : ''}>
                                  庫存 {onlyLink!.stock}
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        {onlyLink && !isMulti && (
                          <Button type="button" variant={isSelected ? 'default' : 'outline'} size="sm" className="h-8 px-3 text-xs shrink-0">
                            {isSelected ? (<><Check className="h-3.5 w-3.5 mr-1" />已選</>) : '選擇'}
                          </Button>
                        )}
                      </div>

                      {isMulti && isExpanded && (
                        <div className="px-2.5 pb-2.5 space-y-1">
                          {part.links.map(link => (
                            <div
                              key={link.id}
                              onClick={() => selectLink(part, link)}
                              className="flex items-center justify-between gap-2 p-2 rounded-md border border-border/50 bg-background/60 hover:border-primary/50 hover:bg-accent/40 cursor-pointer"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs font-medium truncate">
                                    {link.spec_label || link.variant_name || link.product_name}
                                  </span>
                                  {link.is_default && (
                                    <Badge variant="outline" className="h-4 px-1 text-[10px] shrink-0">預設</Badge>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                                  {link.sku && <span className="font-mono">{link.sku}</span>}
                                  <span>成本: {formatCurrency(link.unit_cost || part.default_unit_cost)}</span>
                                  <span className={link.stock > 0 ? 'text-emerald-600' : ''}>庫存 {link.stock}</span>
                                </div>
                              </div>
                              <Button type="button" variant="outline" size="sm" className="h-7 px-2.5 text-[11px] shrink-0">選擇</Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </div>

        <div className="p-3 bg-muted/20 border-t flex items-center justify-between text-xs text-muted-foreground">
          <span>共 {filtered.length} 項零件</span>
          <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onOpenChange(false)}>
            關閉
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
