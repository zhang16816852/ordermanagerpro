import { useMemo, useState, useEffect } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Pencil, Trash2, Link2, Star, Package, Loader2, Wrench, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { formatCurrency } from '@/lib/formatters';
import { useDeviceModels } from '@/hooks/useDeviceModels';
import {
  useRepairParts,
  useRepairPartMutations,
  useRepairPartProductOptions,
  partLabelOf,
  resolveLinkOf,
  RepairPart,
} from '@/hooks/useRepairParts';


import { RepairPartBatchCreateDialog } from './RepairPartBatchCreateDialog';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import QuickCreatePrototype from './RepairPartQuickCreate';
import { CategoryTab } from '@/pages/admin/categories/components/CategoryTab';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FolderTree } from 'lucide-react';
import { toast } from 'sonner';

type ModelFilter = 'all' | 'mine' | 'generic';

export default function RepairPartsPage() {
  const { parts, isLoading } = useRepairParts();
  const { deleteMutation, updateMutation, createMutation } = useRepairPartMutations();
  const { data: models } = useDeviceModels();

  const [keyword, setKeyword] = useState('');
  const [modelFilter, setModelFilter] = useState<ModelFilter>('all');
  const [modelId, setModelId] = useState<string | null>(null);

  const [showInactive, setShowInactive] = useState(false);
  const [stockFilter, setStockFilter] = useState<'all' | 'in' | 'out' | 'low'>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const pageSize = 20;



  const [batchOpen, setBatchOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingPartId, setEditingPartId] = useState<string | null>(null);

  const modelOptions = useMemo(
    () => models.map(m => ({ id: m.id, name: m.name })),
    [models],
  );

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    const base = parts.filter(p => {
      if (!showInactive && !p.is_active) return false;
      if (modelFilter === 'mine' && !p.device_model_id) return false;
      if (modelFilter === 'generic' && p.device_model_id) return false;
      if (modelFilter === 'all' && modelId && !(p.device_models || []).some((m: any) => m.id === modelId) && p.device_model_id !== modelId) return false;
      const stock = p.links.reduce((sum: number, l: any) => sum + (l.stock || 0), 0);
      if (stockFilter === 'in' && stock <= 0) return false;
      if (stockFilter === 'out' && stock > 0) return false;
      if (stockFilter === 'low' && !(stock > 0 && stock <= 5)) return false;
      if (!q) return true;
      const haystack = [
        p.name,
        p.description,
        p.device_model?.name,
        ...p.links.map(l => [l.product_name, l.variant_name, l.sku, l.product_code].filter(Boolean).join(' ')),
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    });
    return [...base].sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }, [parts, keyword, modelFilter, modelId, showInactive, stockFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pagedFiltered = filtered.slice((page - 1) * pageSize, page * pageSize);

  // reset page when filters change
  // (handled via useEffect-like: clamp page)
  const safePage = Math.min(page, totalPages);

  const noLinkCount = filtered.filter(p => p.links.length === 0).length;
  const inactiveCount = parts.filter(p => !p.is_active).length;

  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  useEffect(() => { setPage(1); }, [keyword, modelFilter, modelId, showInactive, stockFilter]);

  const handleDelete = (part: RepairPart) => {
    if (part.links.length > 0) {
      toast.error(`「${part.name}」仍綁定 ${part.links.length} 個庫存商品，請先移除連結`);
      return;
    }
    if (!window.confirm(`確定刪除零件「${partLabelOf(part)}」？已使用此零件的維修單品項不會被刪除。`)) return;
    deleteMutation.mutate(part.id);
  };

  const [activeTab, setActiveTab] = useState('parts');

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

          <Button variant="outline" onClick={() => setBatchOpen(true)}>
            <Package className="h-4 w-4 mr-1.5" />
            批次建立
          </Button>
          {selectedIds.size === 1 && (
            <Button variant="outline" onClick={() => {
              const p = parts.find(x => x.id === Array.from(selectedIds)[0]);
              if (!p) return;
              createMutation.mutate({
                name: `${p.name} (複製)`,
                description: p.description,
                device_model_id: p.device_model_id,

                is_active: p.is_active,
                default_unit_cost: p.default_unit_cost,
                default_unit_price: p.default_unit_price,
                spec_values: p.spec_values,
              } as any, {
                onSuccess: () => setSelectedIds(new Set()),
              });
            }}>
              複製零件
            </Button>
          )}
          {selectedIds.size > 0 && (
            <>
              <Button variant="outline" size="sm" onClick={() => {
                selectedIds.forEach(id => {
                  const p = parts.find(x => x.id === id) as any;
                  if (!p) return;
                  const input: any = {
                    device_model_id: p.device_model_id || null,
                    name: p.name,

                    description: p.description || null,
                    supplier_id: p.supplier_id || null,
                    default_unit_cost: p.default_unit_cost || 0,
                    default_unit_price: p.default_unit_price || 0,
                    is_active: !p.is_active,
                    sort_order: p.sort_order || 0,
                    version: p.version || null,
                    links: (p.links || []).map((l: any) => ({
                      id: l.id,
                      product_id: l.product_id,
                      variant_id: l.variant_id || null,
                      spec_label: l.spec_label || null,
                      is_default: !!l.is_default,
                    })),
                  };
                  updateMutation.mutate({ id: p.id, input, keepIds: (p.links || []).map((l: any) => l.id) });
                });
                setSelectedIds(new Set());
              }}>
                批次切換啟用
              </Button>
              <Button variant="outline" size="sm" className="text-destructive" onClick={() => {
                if (!window.confirm(`確定刪除 ${selectedIds.size} 個零件？`)) return;
                selectedIds.forEach(id => {
                  const p = parts.find(x => x.id === id);
                  if (p && p.links.length === 0) deleteMutation.mutate(id);
                });
                setSelectedIds(new Set());
              }}>
                批次刪除
              </Button>
            </>
          )}
          <Button variant="outline" asChild>
            <a href="/admin/repair-parts/quick-create">
              <Sparkles className="h-4 w-4 mr-1.5" />
              快速建立零件
            </a>
          </Button>
          <Button asChild>
            <a href="/admin/repair-parts/quick-create">
              <Sparkles className="h-4 w-4 mr-1.5" />
              新增零件（新版）
            </a>
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        <div className="inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground">
          <button
            type="button"
            onClick={() => setActiveTab('parts')}
            className={`inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all ${activeTab === 'parts' ? 'bg-background text-foreground shadow-sm' : ''}`}
          >
            <Wrench className="h-4 w-4 mr-2" />
            零件列表
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('categories')}
            className={`inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all ${activeTab === 'categories' ? 'bg-background text-foreground shadow-sm' : ''}`}
          >
            <FolderTree className="h-4 w-4 mr-2" />
            維修零件分類
          </button>
        </div>

        {activeTab === 'parts' && (
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
            <div className="flex items-center gap-1 rounded-full border p-0.5 text-xs">
              {([['all', '全部庫存'], ['in', '有庫存'], ['out', '零庫存'], ['low', '低庫存']] as [typeof stockFilter, string][]).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setStockFilter(v)}
                  className={`rounded-full px-2.5 py-1 transition-colors ${stockFilter === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>



          <p className="text-xs text-muted-foreground">
            共 {filtered.length} 項符合
            
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
                      <th className="py-2 px-2 w-8">
                         <Checkbox
                           checked={filtered.length > 0 && filtered.every(p => selectedIds.has(p.id))}
                           onCheckedChange={(c) => {
                             if (c) setSelectedIds(new Set(filtered.map(p => p.id)));
                             else setSelectedIds(new Set());
                           }}
                         />
                       </th>
                       <th className="py-2 px-2 font-medium">零件</th>
                      
                      <th className="py-2 px-2 font-medium">庫存連結</th>
                      <th className="py-2 px-2 font-medium text-right">自有庫存</th>
                      <th className="py-2 px-2 font-medium text-right">成本 / 售價</th>
                      <th className="py-2 px-2 font-medium text-center">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedFiltered.map(part => {
                      const def = resolveLinkOf(part);
                      const stock = part.links.reduce((sum, l) => sum + l.stock, 0);
                      return (
                        <tr key={part.id} className="border-b last:border-0 hover:bg-muted/20">
                           <td className="py-2.5 px-2 align-top w-8">
                             <Checkbox
                               checked={selectedIds.has(part.id)}
                               onCheckedChange={(c) => {
                                 const next = new Set(selectedIds);
                                 if (c) next.add(part.id); else next.delete(part.id);
                                 setSelectedIds(next);
                               }}
                             />
                           </td>
                          <td className="py-2.5 px-2 align-top">
                            <div className="font-medium flex items-center gap-1.5 flex-wrap">
                              {partLabelOf(part, def)}
                              {!part.is_active && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">停用</Badge>}
                            </div>
                            {part.spec_values && Object.keys(part.spec_values).length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-0.5">
                                {Object.entries(part.spec_values).map(([k, v]) => (
                                  <Badge key={k} variant="outline" className="text-[10px] px-1 py-0">
                                    {k}: {Array.isArray(v) ? v.join('、') : String(v)}
                                  </Badge>
                                ))}
                              </div>
                            )}
                            {part.description && (
                              <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">{part.description}</p>
                            )}
                          </td>
                          <td className="py-2.5 px-2 align-top text-xs max-w-[220px]">
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
                                onClick={() => { setEditingPartId(part.id); setEditDialogOpen(true); }}>
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
                {pagedFiltered.map(part => {
                  const def = resolveLinkOf(part);
                  const stock = part.links.reduce((sum, l) => sum + l.stock, 0);
                  return (
                    <div key={part.id} className="rounded-lg border p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-medium text-sm">{partLabelOf(part, def)}</div>

                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="編輯零件"
                            onClick={() => { setEditingPartId(part.id); setEditDialogOpen(true); }}>
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
        )}

        {activeTab === 'parts' && filtered.length > pageSize && (
          <div className="flex items-center justify-center gap-2 pt-2">
            <Button variant="outline" size="sm" disabled={safePage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>上一頁</Button>
            <span className="text-xs text-muted-foreground">第 {safePage} / {totalPages} 頁</span>
            <Button variant="outline" size="sm" disabled={safePage >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>下一頁</Button>
          </div>
        )}

        {activeTab === 'categories' && (
          <CategoryTab repairPartOnly={true} />
        )}
      </div>



      <RepairPartBatchCreateDialog open={batchOpen} onOpenChange={setBatchOpen} />
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto p-0">
          <QuickCreatePrototype editingId={editingPartId} onSaved={() => { setEditDialogOpen(false); setEditingPartId(null); }} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
