import { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Link2, Star, Package, Tags, Loader2, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { formatCurrency } from '@/lib/formatters';
import { useDeviceModels } from '@/hooks/useDeviceModels';
import {
  useRepairParts,
  useRepairPartTags,
  useRepairPartMutations,
  useRepairPartProductOptions,
  partLabelOf,
  resolveLinkOf,
  RepairPart,
} from '@/hooks/useRepairParts';
import { RepairPartFormDialog } from '@/components/repair/RepairPartFormDialog';
import { RepairPartTagsManager } from './RepairPartTagsManager';
import { RepairPartBatchCreateDialog } from './RepairPartBatchCreateDialog';
import { toast } from 'sonner';

type ModelFilter = 'all' | 'mine' | 'generic';

export default function RepairPartsPage() {
  const { parts, isLoading } = useRepairParts();
  const { tags: allTags } = useRepairPartTags();
  const { deleteMutation } = useRepairPartMutations();
  const { data: models } = useDeviceModels();

  const [keyword, setKeyword] = useState('');
  const [modelFilter, setModelFilter] = useState<ModelFilter>('all');
  const [modelId, setModelId] = useState<string | null>(null);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [showInactive, setShowInactive] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editingPart, setEditingPart] = useState<RepairPart | null>(null);
  const [presetModelId, setPresetModelId] = useState<string | null>(null);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);

  const modelOptions = useMemo(
    () => models.map(m => ({ id: m.id, name: m.name })),
    [models],
  );

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return parts.filter(p => {
      if (!showInactive && !p.is_active) return false;
      if (modelFilter === 'mine' && !p.device_model_id) return false;
      if (modelFilter === 'generic' && p.device_model_id) return false;
      if (modelFilter === 'all' && modelId && p.device_model_id !== modelId) return false;
      if (activeTags.length > 0 && !activeTags.every(t => p.tags.includes(t))) return false;
      if (!q) return true;
      const haystack = [
        p.name,
        p.description,
        p.device_model?.name,
        ...p.tags,
        ...p.links.map(l => [l.product_name, l.variant_name, l.sku, l.product_code].filter(Boolean).join(' ')),
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [parts, keyword, modelFilter, modelId, activeTags, showInactive]);

  const noLinkCount = filtered.filter(p => p.links.length === 0).length;
  const inactiveCount = parts.filter(p => !p.is_active).length;

  const handleDelete = (part: RepairPart) => {
    if (part.links.length > 0) {
      toast.error(`「${part.name}」仍綁定 ${part.links.length} 個庫存商品，請先移除連結`);
      return;
    }
    if (!window.confirm(`確定刪除零件「${partLabelOf(part)}」？已使用此零件的維修單品項不會被刪除。`)) return;
    deleteMutation.mutate(part.id);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Wrench className="h-6 w-6" />
            維修零件
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            零件型錄記錄「適用型號 × 零件名稱」，並綁定實際庫存商品作為維修單出料依據。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setTagsOpen(true)}>
            <Tags className="h-4 w-4 mr-1.5" />
            標籤字典
          </Button>
          <Button variant="outline" onClick={() => setBatchOpen(true)}>
            <Package className="h-4 w-4 mr-1.5" />
            批次建立
          </Button>
          <Button onClick={() => { setEditingPart(null); setPresetModelId(null); setFormOpen(true); }}>
            <Plus className="h-4 w-4 mr-1.5" />
            新增零件
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜尋零件名稱、型號、商品、SKU"
              className="h-9 w-full sm:w-72"
            />
            <div className="flex items-center gap-1 rounded-full border p-0.5 text-xs">
              {([['all', '全部'], ['mine', '僅本機型'], ['generic', '通用']] as [ModelFilter, string][]).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setModelFilter(v)}
                  className={`rounded-full px-2.5 py-1 transition-colors ${modelFilter === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {modelFilter === 'all' && (
              <div className="w-full sm:w-56">
                <SearchableSelect
                  options={modelOptions}
                  value={modelId}
                  onChange={(id) => setModelId(id || null)}
                  placeholder="全部型號"
                  searchPlaceholder="搜尋型號"
                  clearable
                />
              </div>
            )}
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
                className="rounded border-input"
              />
              顯示停用{inactiveCount > 0 ? `（${inactiveCount}）` : ''}
            </label>
          </div>

          {allTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {allTags.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTags(prev => prev.includes(t.name) ? prev.filter(x => x !== t.name) : [...prev, t.name])}
                  className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                    activeTags.includes(t.name)
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
                  }`}
                >
                  #{t.name}
                </button>
              ))}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            共 {filtered.length} 項符合
            {activeTags.length > 0 && `（已套用 ${activeTags.length} 個標籤）`}
            {noLinkCount > 0 && `，其中 ${noLinkCount} 項尚未綁定庫存商品`}
          </p>

          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {parts.length === 0 ? '尚無維修零件，請先按「新增零件」或「批次建立」。' : '查無符合條件的零件。'}
            </p>
          ) : (
            <>
              {/* 桌機表格 */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 px-2 font-medium">零件</th>
                      <th className="py-2 px-2 font-medium">標籤</th>
                      <th className="py-2 px-2 font-medium">庫存連結</th>
                      <th className="py-2 px-2 font-medium text-right">自有庫存</th>
                      <th className="py-2 px-2 font-medium text-right">成本 / 售價</th>
                      <th className="py-2 px-2 font-medium text-center">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(part => {
                      const def = resolveLinkOf(part);
                      const stock = part.links.reduce((sum, l) => sum + l.stock, 0);
                      return (
                        <tr key={part.id} className="border-b last:border-0 hover:bg-muted/20">
                          <td className="py-2.5 px-2 align-top">
                            <div className="font-medium flex items-center gap-1.5 flex-wrap">
                              {partLabelOf(part, def)}
                              {!part.is_active && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">停用</Badge>}
                            </div>
                            {part.description && (
                              <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">{part.description}</p>
                            )}
                          </td>
                          <td className="py-2.5 px-2 align-top">
                            {part.tags.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {part.tags.map(t => (
                                  <span key={t} className="rounded-full border border-border bg-muted/40 px-1.5 py-0 text-[10px] text-muted-foreground">#{t}</span>
                                ))}
                              </div>
                            ) : <span className="text-muted-foreground/30">-</span>}
                          </td>
                          <td className="py-2.5 px-2 align-top text-xs">
                            {part.links.length === 0 ? (
                              <span className="text-amber-600 dark:text-amber-400">未綁定</span>
                            ) : (
                              <div className="space-y-0.5">
                                {part.links.slice(0, 2).map(l => (
                                  <div key={l.id} className="flex items-center gap-1">
                                    {l.is_default && <Star className="h-3 w-3 fill-amber-400 text-amber-500 shrink-0" />}
                                    <span className="truncate">{l.variant_name || l.product_name}</span>
                                    {l.sku && <span className="font-mono text-[10px] text-muted-foreground">{l.sku}</span>}
                                  </div>
                                ))}
                                {part.links.length > 2 && (
                                  <div className="text-[10px] text-muted-foreground">另有 {part.links.length - 2} 個規格</div>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-2 align-top text-right font-mono text-xs">
                            {stock}
                          </td>
                          <td className="py-2.5 px-2 align-top text-right font-mono text-xs text-muted-foreground">
                            {formatCurrency(part.default_unit_cost)} / {formatCurrency(part.default_unit_price)}
                          </td>
                          <td className="py-2.5 px-2 align-top">
                            <div className="flex items-center justify-center gap-1">
                              <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="編輯零件" title="編輯"
                                onClick={() => { setEditingPart(part); setPresetModelId(null); setFormOpen(true); }}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" aria-label="刪除零件" title="刪除"
                                onClick={() => handleDelete(part)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* 行動卡片 */}
              <div className="md:hidden space-y-3">
                {filtered.map(part => {
                  const def = resolveLinkOf(part);
                  const stock = part.links.reduce((sum, l) => sum + l.stock, 0);
                  return (
                    <div key={part.id} className="rounded-lg border p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-medium text-sm">{partLabelOf(part, def)}</div>
                          {part.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {part.tags.map(t => (
                                <span key={t} className="rounded-full border border-border bg-muted/40 px-1.5 py-0 text-[10px] text-muted-foreground">#{t}</span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="編輯零件"
                            onClick={() => { setEditingPart(part); setPresetModelId(null); setFormOpen(true); }}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" aria-label="刪除零件"
                            onClick={() => handleDelete(part)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Link2 className="h-3 w-3" />
                          {part.links.length === 0 ? '未綁定商品' : `${part.links.length} 個連結`}
                        </span>
                        <span>庫存 {stock}</span>
                        <span className="font-mono">{formatCurrency(part.default_unit_cost)} / {formatCurrency(part.default_unit_price)}</span>
                        {!part.is_active && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">停用</Badge>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <RepairPartFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editingPart={editingPart}
        presetDeviceModelId={presetModelId}
      />
      <RepairPartTagsManager open={tagsOpen} onOpenChange={setTagsOpen} />
      <RepairPartBatchCreateDialog open={batchOpen} onOpenChange={setBatchOpen} />
    </div>
  );
}
