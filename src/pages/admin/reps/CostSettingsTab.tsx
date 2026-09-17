import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, ChevronRight, ChevronDown, Save, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Dispatch, SetStateAction } from 'react';
import type { ProductWithDetails } from '@/types/product';
import type { RepRecord, ProfileRecord, CostRow, CostItemInput } from '../repsTypes';

interface CostSettingsTabProps {
  reps: RepRecord[];
  profileOf: (userId: string) => ProfileRecord | undefined;
  costRepId: string;
  setCostRepId: (v: string) => void;
  costSearch: string;
  setCostSearch: (v: string) => void;
  filteredCostProducts: ProductWithDetails[];
  repCosts: CostRow[];
  expandedCostProducts: Set<string>;
  setExpandedCostProducts: Dispatch<SetStateAction<Set<string>>>;
  costDrafts: Record<string, string>;
  setCostDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  savePending: boolean;
  onSave: (repId: string, items: CostItemInput[]) => void;
}

export function CostSettingsTab({
  reps,
  profileOf,
  costRepId,
  setCostRepId,
  costSearch,
  setCostSearch,
  filteredCostProducts,
  repCosts,
  expandedCostProducts,
  setExpandedCostProducts,
  costDrafts,
  setCostDrafts,
  savePending,
  onSave,
}: CostSettingsTabProps) {
  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <CardTitle>業務進貨成本</CardTitle>
        <div className="flex flex-col sm:flex-row gap-2">
          <Select value={costRepId} onValueChange={(v) => { setCostRepId(v); setCostDrafts({}); }}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="選擇業務" />
            </SelectTrigger>
            <SelectContent>
              {reps.map((r) => {
                const p = profileOf(r.user_id);
                return (
                  <SelectItem key={r.user_id} value={r.user_id}>{p?.full_name || p?.email || r.user_id}</SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <div className="relative w-56">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜尋產品"
              className="pl-10"
              value={costSearch}
              onChange={(e) => setCostSearch(e.target.value)}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!costRepId ? (
          <p className="text-muted-foreground text-center py-8">請先選擇業務</p>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-muted-foreground">
                共 {filteredCostProducts.length} 個產品
              </p>
              <Button
                size="sm"
                disabled={savePending}
                onClick={() => {
                  const dirtyEntries = Object.entries(costDrafts).filter(([k, v]) => {
                    const costRow = repCosts.find(c => {
                      if (k.includes(':')) {
                        const [, vid] = k.split(':');
                        return c.product_id === k.split(':')[0] && c.variant_id === vid;
                      }
                      return c.product_id === k && c.variant_id === null;
                    });
                    const saved = costRow ? String(costRow.cost) : '';
                    return v !== saved;
                  });
                  if (dirtyEntries.length === 0) { toast.info('無變更'); return; }
                  const items = dirtyEntries
                    .map(([key, val]): CostItemInput | null => {
                      const [pid, vid] = key.includes(':') ? key.split(':') : [key, null];
                      if (val === '') return { product_id: pid, variant_id: vid, cost: null };
                      const num = Number(val);
                      if (Number.isNaN(num) || num < 0) return null;
                      return { product_id: pid, variant_id: vid, cost: num };
                    })
                    .filter((x): x is CostItemInput => x !== null);
                  if (items.length === 0) { toast.info('沒有有效的變更'); return; }
                  onSave(costRepId, items);
                }}
              >
                {savePending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
                全部儲存
              </Button>
            </div>
            <div className="max-h-[600px] overflow-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>產品 / 變體</TableHead>
                    <TableHead className="w-48">業務成本</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCostProducts.length === 0 ? (
                    <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">無產品</TableCell></TableRow>
                  ) : (
                    filteredCostProducts.map((p) => {
                      const variants = p.variants || [];
                      const hasVariants = variants.length > 0;
                      const isExpanded = expandedCostProducts.has(p.id);
                      const costKey = p.id;
                      const costRow = repCosts.find(c => c.product_id === p.id && c.variant_id === null);
                      const draft = costDrafts[costKey] ?? (costRow ? String(costRow.cost) : '');
                      const totalVariantCost = variants.reduce((sum, v) => {
                        const vr = repCosts.find(c => c.product_id === p.id && c.variant_id === v.id);
                        return sum + (vr ? Number(vr.cost) || 0 : 0);
                      }, 0);

                      return (
                        <div key={`product-${p.id}`}>
                          <TableRow
                            className={hasVariants ? 'cursor-pointer hover:bg-muted/50' : ''}
                            onClick={() => {
                              if (hasVariants) {
                                setExpandedCostProducts(prev => {
                                  const next = new Set(prev);
                                  if (next.has(p.id)) next.delete(p.id); else next.add(p.id);
                                  return next;
                                });
                              }
                            }}
                          >
                            <TableCell className="w-8">
                              {hasVariants ? (
                                isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <span className="inline-block w-4" />
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="font-medium">{p.name}</div>
                              {p.code && <div className="text-xs text-muted-foreground">{p.code}</div>}
                              {hasVariants && (
                                <div className="text-xs text-muted-foreground mt-0.5">
                                  {variants.length} 個變體
                                  {totalVariantCost > 0 && <span className="ml-1">（合計 ${totalVariantCost.toLocaleString()}）</span>}
                                </div>
                              )}
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <Input
                                type="number"
                                min={0}
                                placeholder={hasVariants ? '統一設定' : '未設定'}
                                value={draft}
                                onChange={(e) => setCostDrafts(prev => ({ ...prev, [costKey]: e.target.value }))}
                                className="h-8"
                              />
                            </TableCell>
                          </TableRow>
                          {hasVariants && isExpanded && variants.map((v) => {
                            const vKey = `${p.id}:${v.id}`;
                            const vCostRow = repCosts.find(c => c.product_id === p.id && c.variant_id === v.id);
                            const vDraft = costDrafts[vKey] ?? (vCostRow ? String(vCostRow.cost) : '');
                            const vWholesale = Number(v.wholesale_price) || 0;
                            return (
                              <TableRow key={`variant-${v.id}`} className="bg-muted/20">
                                <TableCell />
                                <TableCell>
                                  <div className="pl-6 text-sm">
                                    {v.name || v.sku || `變體`}
                                    {v.sku && v.name && <span className="text-muted-foreground ml-1">({v.sku})</span>}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Input
                                    type="number"
                                    min={0}
                                    placeholder={vWholesale > 0 ? `預設 $${vWholesale.toLocaleString()}（進貨成本）` : '未設定'}
                                    value={vDraft}
                                    onChange={(e) => setCostDrafts(prev => ({ ...prev, [vKey]: e.target.value }))}
                                    className="h-8"
                                  />
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </div>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}