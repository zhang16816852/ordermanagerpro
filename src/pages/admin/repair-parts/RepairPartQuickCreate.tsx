import { useState, useMemo, useCallback, useEffect } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, ArrowLeft, Sparkles, Plus, Trash2, X, Pencil, Check, Link2, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ModelPicker } from '@/components/repair/ModelPicker';
import { useDeviceModels } from '@/hooks/useDeviceModels';
import { useQuickCreateRepairPart } from '@/hooks/useQuickCreateRepairPart';
import { useRepairParts, useRepairPartMutations } from '@/hooks/useRepairParts';
import { useRepairPartCategories } from '@/hooks/useRepairPartCategories';
import { useRepairPartSpecs } from '@/hooks/useRepairPartSpecs';

// ---------- Mock 資料：大分類 + 對應規格定義 ----------
// Trigger: source spec 作為觸發者，定義「當我有某值時，顯示 target spec」
interface TriggerDef {
  id: string;
  triggerValue: string;  // 當 source 有此值時
  targetSpec: string;    // 顯示目標規格
  relationType: 'visibility' | 'quantity';
}

interface SpecDef {
  id: string;
  name: string;
  options: string[];
  required?: boolean;
  triggers: TriggerDef[]; // 此 spec 作為 source 時的 triggers
}

interface CategoryDef {
  id: string;
  name: string;
  specs: SpecDef[];
}

const MOCK_CATEGORIES_ORIGINAL: CategoryDef[] = [
  {
    id: 'screen',
    name: '螢幕總成',
    specs: [
      { id: 's1', name: '品質', options: ['換蓋板', '副廠OLED', '副廠TFT'], required: true, triggers: [
        { id: 't1', triggerValue: '副廠OLED', targetSpec: '品牌', relationType: 'visibility' },
      ] },
      { id: 's2', name: '品牌', options: ['三星', 'LG', '京東方', '華星光'], triggers: [] },
      { id: 's3', name: '顏色', options: ['黑', '白', '金', '玫瑰金'], triggers: [] },
    ],
  },
  {
    id: 'battery',
    name: '電池',
    specs: [
      { id: 'b1', name: '品質', options: ['原廠', '副廠'], required: true, triggers: [] },
      { id: 'b2', name: '容量', options: ['標準', '加大'], triggers: [] },
    ],
  },
  {
    id: 'flex',
    name: '排線',
    specs: [
      { id: 'f1', name: '功能', options: ['充電排線', '音量+電源排線', '音量+電源+閃光燈排線', '指紋排線', '感應排線', '天線'], required: true, triggers: [] },
      { id: 'f2', name: '品質', options: ['副廠', '原拆', '原廠'], triggers: [] },
      { id: 'f3', name: '顏色', options: ['黑', '白', '金', '玫瑰金', '藍'], triggers: [] },
    ],
  },
  {
    id: 'midframe',
    name: '中框外殼背玻',
    specs: [
      { id: 'm1', name: '類型', options: ['中框', '外殼', '背玻', '中框+背玻'], required: true, triggers: [
        { id: 't2', triggerValue: '中框', targetSpec: '材質', relationType: 'visibility' },
        { id: 't3', triggerValue: '背玻', targetSpec: '玻璃類型', relationType: 'visibility' },
      ] },
      { id: 'm2', name: '材質', options: ['鋁合金', '塑膠', '玻璃', '不鏽鋼'], triggers: [] },
      { id: 'm3', name: '玻璃類型', options: ['2.5D', '3D', '平面'], triggers: [] },
      { id: 'm4', name: '顏色', options: ['黑', '白', '金', '藍', '紫', '玫瑰金'], triggers: [] },
      { id: 'm5', name: '品質', options: ['原廠', '副廠'], triggers: [] },
    ],
  },
  {
    id: 'camera',
    name: '鏡頭',
    specs: [
      { id: 'c1', name: '位置', options: ['前鏡頭', '後主鏡', '後副鏡', '微距', '廣角', 'ToF'], required: true, triggers: [] },
      { id: 'c2', name: '品質', options: ['原廠', '副廠'], triggers: [] },
    ],
  },
  {
    id: 'speaker',
    name: '喇叭聽筒',
    specs: [
      { id: 'sp1', name: '位置', options: ['上喇叭', '下喇叭', '聽筒', '震動馬達'], required: true, triggers: [] },
      { id: 'sp2', name: '品質', options: ['原廠', '副廠'], triggers: [] },
    ],
  },
];

const MOCK_VERSIONS = ['a版', 'b版', 'c版', 'dtp', 'c3f', '原廠', '副廠'];

// ---------- Sortable spec field wrapper ----------
function SortableSpecField({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <div ref={setNodeRef} style={style} className="rounded-md border bg-muted/20 p-3 space-y-2">
      <div className="flex items-center gap-1.5">
        <button type="button" {...attributes} {...listeners} className="cursor-grab text-muted-foreground hover:text-foreground">
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}

// ---------- Sortable selected value tag ----------
function SortableSelectedTag({ id, value, onRemove }: { id: string; value: string; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <span ref={setNodeRef} style={style} className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs text-primary font-medium cursor-grab">
      <button type="button" {...attributes} {...listeners} className="text-muted-foreground hover:text-foreground">
        <GripVertical className="h-3 w-3" />
      </button>
      {value}
      <button type="button" onClick={onRemove} className="text-muted-foreground hover:text-destructive">
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

export default function QuickCreatePrototype({ onCreated, onSaved, editingId: editingIdProp }: { onCreated?: (partId: string) => void; onSaved?: () => void; editingId?: string | null } = {}) {
  const { id: editId } = useParams<{ id?: string }>();
  const [searchParams] = useSearchParams();
  const idFromQuery = searchParams.get('id');
  const editingId = editingIdProp || editId || idFromQuery;
  const isEdit = !!editingId;

  const { data: models } = useDeviceModels();
  const { createMutation } = useQuickCreateRepairPart();
  const { parts } = useRepairParts();
  const { updateMutation } = useRepairPartMutations();
  const editingPart = isEdit ? parts.find(p => p.id === editingId) || null : null;

  const { categories: dbCategories, isLoading: categoriesLoading } = useRepairPartCategories();

  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const { specs: dbSpecs, isLoading: specsLoading } = useRepairPartSpecs(selectedCategoryIds);

  // 將 DB categories 轉為 repairCategories 格式
  const repairCategories = dbCategories.length > 0
    ? dbCategories.map(c => ({
        id: c.id,
        name: c.name,
        specs: [] as SpecDef[], // specs loaded separately via useRepairPartSpecs
      }))
    : MOCK_CATEGORIES_ORIGINAL;
  const [specDefs, setSpecDefs] = useState<SpecDef[]>([]);
  const [specValues, setSpecValues] = useState<Record<string, string[]>>({});
  const [specValueOrder, setSpecValueOrder] = useState<Record<string, string[]>>({});
  const [specOrder, setSpecOrder] = useState<string[]>([]);
  const [newSpecName, setNewSpecName] = useState('');
  const [newOptionInputs, setNewOptionInputs] = useState<Record<string, string>>({});
  const [editingSpecId, setEditingSpecId] = useState<string | null>(null);
  const [editingSpecName, setEditingSpecName] = useState('');
  const [customInput, setCustomInput] = useState<Record<string, string>>({});

  const [deviceModelIds, setDeviceModelIds] = useState<string[]>([]);
  const [defaultCost, setDefaultCost] = useState(0);
  const [defaultPrice, setDefaultPrice] = useState(0);
  const [version, setVersion] = useState('');
  const [versionInput, setVersionInput] = useState('');
  const [loadedSpecValues, setLoadedSpecValues] = useState<Record<string, string[]> | null>(null);
  const [createProduct, setCreateProduct] = useState(true);
  const [nameOverride, setNameOverride] = useState('');
  const [nameAuto, setNameAuto] = useState(true);
  const [expandedTriggers, setExpandedTriggers] = useState<Record<string, boolean>>({});
  const [newTriggerState, setNewTriggerState] = useState<Record<string, { triggerValue: string; targetSpec: string; relationType: 'visibility' | 'quantity' }>>({});

  // 編輯模式：預填基本欄位
  useEffect(() => {
    if (!editingPart) return;
    setNameOverride(editingPart.name || '');
    setNameAuto(false);

    setDefaultCost(editingPart.default_unit_cost || 0);
    setDefaultPrice(editingPart.default_unit_price || 0);
    setVersion(editingPart.version || '');
    const modelIds = (editingPart.device_models && editingPart.device_models.length > 0)
      ? editingPart.device_models.map((m: any) => m.id)
      : (editingPart.device_model_id ? [editingPart.device_model_id] : []);
    setDeviceModelIds(modelIds);
    if (editingPart.device_model_id) setSelectedCategoryIds([]); // keep simple

    // 編輯模式：載入分類與規格
    const productId = editingPart.links && editingPart.links.length > 0 ? editingPart.links[0].product_id : null;
    if (productId) {
      (async () => {
        try {
          const { data: catLinks } = await (supabase as any).from('product_category_links').select('category_id').eq('product_id', productId);
          const catIds = (catLinks || []).map((c: any) => c.category_id);
          if (catIds.length > 0) setSelectedCategoryIds(catIds);
          const { data: specRows } = await (supabase as any).from('entity_spec_values').select('spec_id, value, spec:spec_id(name)').eq('entity_id', productId).eq('entity_type', 'product').is('deleted_at', null);
          const sv: Record<string, string[]> = {};
          (specRows || []).forEach((r: any) => {
            const v = r.value;
            const name = r.spec?.name;
            if (name) sv[name] = Array.isArray(v) ? v.map(String) : [String(v)];
          });
          setLoadedSpecValues(sv);
        } catch (e) {
          console.warn('載入編輯資料失敗', e);
        }
      })();
    } else {
      setLoadedSpecValues({});
    }
  }, [editingPart]);

  const selectedCategories = useMemo(
    () => repairCategories.filter(c => selectedCategoryIds.includes(c.id)),
    [selectedCategoryIds, repairCategories],
  );

  useEffect(() => {
    if (dbSpecs.length === 0) {
      // Fallback to mock specs if no DB specs
      const seen = new Set<string>();
      const result: SpecDef[] = [];
      MOCK_CATEGORIES_ORIGINAL.filter(c => selectedCategoryIds.includes(c.id) || selectedCategoryIds.length === 0).forEach(cat => {
        cat.specs.forEach(spec => {
          if (seen.has(spec.name)) return;
          seen.add(spec.name);
          result.push({ ...spec, triggers: [...spec.triggers] });
        });
      });
      // If no categories selected, show all mock specs
      if (selectedCategoryIds.length === 0) {
        const allSpecs = MOCK_CATEGORIES_ORIGINAL.flatMap(c => c.specs);
        const seen2 = new Set<string>();
        const result2: SpecDef[] = [];
        allSpecs.forEach(spec => {
          if (seen2.has(spec.name)) return;
          seen2.add(spec.name);
          result2.push({ ...spec, triggers: [...spec.triggers] });
        });
        setSpecDefs(result2);
        setSpecOrder(result2.map(s => s.id));
      } else {
        setSpecDefs(result);
        setSpecOrder(result.map(s => s.id));
      }
      setSpecValues({});
      return;
    }
    // Use real DB specs
    const result: SpecDef[] = dbSpecs.map(s => ({
      id: s.id,
      name: s.name,
      options: s.options || [],
      required: s.required || false,
      triggers: s.triggers || [],
    }));
    setSpecDefs(result);
    setSpecOrder(result.map(s => s.id));
    if (isEdit && loadedSpecValues) {
      const sv: Record<string, string[]> = {};
      result.forEach(s => {
        if (loadedSpecValues[s.name]) sv[s.id] = loadedSpecValues[s.name];
      });
      setSpecValues(sv);
    } else {
      setSpecValues({});
    }
  }, [selectedCategoryIds, dbSpecs, isEdit, loadedSpecValues]);

  const orderedSpecs = useMemo(() => {
    if (specOrder.length === 0) return specDefs;
    const map = new Map(specDefs.map(s => [s.id, s]));
    const ordered = specOrder.map(id => map.get(id)).filter(Boolean) as SpecDef[];
    specDefs.forEach(s => {
      if (!specOrder.includes(s.id)) ordered.push(s);
    });
    return ordered;
  }, [specDefs, specOrder]);

  // 連動：spec 是否可見，由其他 spec 的 triggers 決定
  const visibleSpecs = useMemo(() => {
    return orderedSpecs.filter(spec => {
      // 找出所有指向此 spec 的 triggers
      const incomingTriggers = orderedSpecs.flatMap(s =>
        s.triggers.filter(t => t.targetSpec === spec.name).map(t => ({ sourceSpec: s.name, trigger: t }))
      );
      // 如果沒有 incoming triggers，永遠顯示（根節點）
      if (incomingTriggers.length === 0) return true;
      // 如果有 incoming triggers，檢查是否有任何 trigger 的條件滿足
      return incomingTriggers.some(({ sourceSpec, trigger }) => {
        const sourceVal = specValues[sourceSpec];
        if (!sourceVal || sourceVal.length === 0) return false;
        return sourceVal.includes(trigger.triggerValue);
      });
    });
  }, [orderedSpecs, specValues]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = visibleSpecs.findIndex(s => s.id === active.id);
    const newIndex = visibleSpecs.findIndex(s => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const newOrder = arrayMove(visibleSpecs.map(s => s.id), oldIndex, newIndex);
    setSpecOrder(newOrder);
  };

  const toggleCategory = (catId: string) => {
    setSelectedCategoryIds(prev =>
      prev.includes(catId) ? prev.filter(id => id !== catId) : [...prev, catId],
    );
  };

  const toggleSpecValue = (specName: string, value: string) => {
    setSpecValues(prev => {
      const next = { ...prev };
      const cur = next[specName] || [];
      if (cur.includes(value)) {
        const filtered = cur.filter(v => v !== value);
        if (filtered.length > 0) next[specName] = filtered;
        else delete next[specName];
      } else {
        next[specName] = [...cur, value];
      }
      return next;
    });
  };

  const handleUnifiedInput = (spec: SpecDef, val: string) => {
    const trimmed = val.trim();
    if (!trimmed) return;
    if (!spec.options.includes(trimmed)) {
      setSpecDefs(prev => prev.map(s => {
        if (s.id !== spec.id) return s;
        return { ...s, options: [...s.options, trimmed] };
      }));
    }
    toggleSpecValue(spec.name, trimmed);
  };

  const handleAddOption = (specId: string) => {
    const val = (newOptionInputs[specId] || '').trim();
    if (!val) return;
    setSpecDefs(prev => prev.map(s => {
      if (s.id !== specId) return s;
      if (s.options.includes(val)) return s;
      return { ...s, options: [...s.options, val] };
    }));
    setNewOptionInputs(prev => ({ ...prev, [specId]: '' }));
  };

  const handleRemoveOption = (specId: string, option: string) => {
    setSpecDefs(prev => prev.map(s => {
      if (s.id !== specId) return s;
      return { ...s, options: s.options.filter(o => o !== option) };
    }));
    setSpecValues(prev => {
      const spec = specDefs.find(s => s.id === specId);
      if (!spec) return prev;
      const next = { ...prev };
      const cur = next[spec.name] || [];
      const filtered = cur.filter(v => v !== option);
      if (filtered.length > 0) next[spec.name] = filtered;
      else delete next[spec.name];
      return next;
    });
  };

  const handleRenameSpec = (specId: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setSpecDefs(prev => prev.map(s => {
      if (s.id !== specId) return s;
      setSpecValues(pv => {
        const next = { ...pv };
        if (pv[s.name] && pv[s.name].length > 0) {
          next[trimmed] = pv[s.name];
          delete next[s.name];
        }
        return next;
      });
      setSpecDefs(prev2 => prev2.map(s2 => ({
        ...s2,
        triggers: s2.triggers.map(t => t.targetSpec === s.name ? { ...t, targetSpec: trimmed } : t),
      })));
      return { ...s, name: trimmed };
    }));
    setEditingSpecId(null);
  };

  const handleAddSpec = () => {
    const name = newSpecName.trim();
    if (!name) return;
    const newSpec: SpecDef = { id: `new-${Date.now()}`, name, options: [], triggers: [] };
    setSpecDefs(prev => [...prev, newSpec]);
    setSpecOrder(prev => [...prev, newSpec.id]);
    setNewSpecName('');
  };

  const handleRemoveSpec = (specId: string) => {
    const spec = specDefs.find(s => s.id === specId);
    if (!spec) return;
    setSpecDefs(prev => prev.filter(s => s.id !== specId));
    setSpecOrder(prev => prev.filter(id => id !== specId));
    setSpecValues(prev => {
      const next = { ...prev };
      delete next[spec.name];
      return next;
    });
    setSpecDefs(prev => prev.map(s => ({
      ...s,
      triggers: s.triggers.filter(t => t.targetSpec !== spec.name),
    })));
  };

  const handleAddTrigger = (sourceSpecId: string) => {
    const state = newTriggerState[sourceSpecId] || { triggerValue: '', targetSpec: '', relationType: 'visibility' as const };
    if (!state.triggerValue || !state.targetSpec) return;
    setSpecDefs(prev => prev.map(s => {
      if (s.id !== sourceSpecId) return s;
      const newTrigger: TriggerDef = {
        id: `trig-${Date.now()}`,
        triggerValue: state.triggerValue,
        targetSpec: state.targetSpec,
        relationType: state.relationType,
      };
      return { ...s, triggers: [...s.triggers, newTrigger] };
    }));
    setNewTriggerState(prev => ({ ...prev, [sourceSpecId]: { triggerValue: '', targetSpec: '', relationType: 'visibility' } }));
  };

  const handleRemoveTrigger = (sourceSpecId: string, triggerId: string) => {
    setSpecDefs(prev => prev.map(s => {
      if (s.id !== sourceSpecId) return s;
      return { ...s, triggers: s.triggers.filter(t => t.id !== triggerId) };
    }));
  };

  const handleTagDragEnd = (specName: string, event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const vals = specValues[specName] || [];
    const oldIndex = vals.indexOf(active.id as string);
    const newIndex = vals.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;
    const newOrder = arrayMove(vals, oldIndex, newIndex);
    setSpecValues(prev => ({ ...prev, [specName]: newOrder }));
  };

  const autoName = useMemo(() => {
    const parts: string[] = [];
    if (deviceModelIds.length > 0) {
      const modelNames = deviceModelIds
        .map(id => models?.find(m => m.id === id))
        .filter(Boolean)
        .map(m => (m!.brand_name ? `${m!.brand_name} ${m!.name}` : m!.name));
      if (modelNames.length > 0) parts.push(modelNames.join(' / '));
    }
    if (selectedCategories.length > 0) {
      parts.push(selectedCategories.map(c => c.name).join('、'));
    }
    if (version.trim()) {
      parts.push(`(${version.trim()})`);
    }
    visibleSpecs.forEach(s => {
      const v = specValues[s.name];
      if (v && v.length > 0) parts.push(v.join('、'));
    });
    return parts.join(' - ');
  }, [deviceModelIds, models, selectedCategories, visibleSpecs, specValues, version]);

  const displayName = nameAuto ? autoName : nameOverride;

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center gap-3">
          <Link to="/admin/repair-parts" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> 返回零件管理
          </Link>
          <div className="flex-1">
            <h1 className="text-lg font-semibold">快速建立零件</h1>
            <p className="text-xs text-muted-foreground">建立維修零件型錄，同時自動建立庫存商品</p>
          </div>
          <Badge variant="outline" className="text-green-600 border-green-300">正式版</Badge>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {/* 1. 適用裝置型號 */}
          <div className="rounded-lg border bg-card p-4 space-y-2">
            <Label>適用裝置型號 <span className="text-[11px] text-muted-foreground font-normal">（可多選）</span></Label>
            <ModelPicker models={models || []} value={deviceModelIds} onChange={(v) => setDeviceModelIds(Array.isArray(v) ? v : v ? [v] : [])} multi />
            <p className="text-[11px] text-muted-foreground">留空代表通用零件。</p>
          </div>

          {/* 2. 大分類 */}
          <div className="rounded-lg border bg-card p-4 space-y-2">
            <Label>大分類 <span className="text-destructive">*</span> <span className="text-[11px] text-muted-foreground font-normal">（可多選）</span></Label>
            <div className="flex flex-wrap gap-1.5">
              {repairCategories.map(cat => {
                const selected = selectedCategoryIds.includes(cat.id);
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => toggleCategory(cat.id)}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                      selected ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
                    }`}
                  >
                    {cat.name}
                  </button>
                );
              })}
            </div>
            {selectedCategoryIds.length === 0 && (
              <p className="text-[11px] text-muted-foreground">請先選擇至少一個大分類。</p>
            )}
          </div>

          {/* 3. 規格管理 */}
          {selectedCategoryIds.length > 0 && (
            <div className="rounded-lg border bg-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" /> 規格管理（每規格一行，拖曳排序）
                </h2>
                <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={handleAddSpec}>
                  <Plus className="h-3 w-3 mr-1" /> 新增規格定義
                </Button>
              </div>

              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={visibleSpecs.map(s => s.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-3">
                    {visibleSpecs.map(spec => {
                      const selectedVals = specValues[spec.name] || [];
                      const customVal = customInput[spec.name] || '';
                      const isEditing = editingSpecId === spec.id;
                      const trigState = newTriggerState[spec.id] || { triggerValue: '', targetSpec: '', relationType: 'visibility' as const };
                      const specNames = specDefs.map(s => s.name).filter(n => n !== spec.name);
                      return (
                        <SortableSpecField key={spec.id} id={spec.id}>
                          {/* 抬頭 */}
                          <div className="flex items-center gap-2 mb-2">
                            {isEditing ? (
                              <div className="flex items-center gap-1 flex-1">
                                <Input
                                  value={editingSpecName}
                                  onChange={(e) => setEditingSpecName(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') { e.preventDefault(); handleRenameSpec(spec.id, editingSpecName); }
                                    if (e.key === 'Escape') setEditingSpecId(null);
                                  }}
                                  className="h-7 text-xs font-medium"
                                  autoFocus
                                />
                                <Button type="button" size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleRenameSpec(spec.id, editingSpecName)}>
                                  <Check className="h-3.5 w-3.5 text-green-600" />
                                </Button>
                                <Button type="button" size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditingSpecId(null)}>
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1 flex-1">
                                <Label className="text-xs font-medium">
                                  {spec.name}
                                  {spec.required && <span className="text-destructive ml-0.5">*</span>}
                                </Label>
                                <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => { setEditingSpecId(spec.id); setEditingSpecName(spec.name); }}>
                                  <Pencil className="h-3 w-3" />
                                </button>
                              </div>
                            )}
                            <Button type="button" size="icon" variant="ghost" className="h-6 w-6 text-destructive hover:bg-destructive/10" onClick={() => handleRemoveSpec(spec.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>

                          {/* 已選值 tag（可拖曳排序） */}
                          {selectedVals.length > 0 && (
                            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => handleTagDragEnd(spec.name, e)}>
                              <SortableContext items={selectedVals} strategy={horizontalListSortingStrategy}>
                                <div className="flex flex-wrap gap-1.5 mb-2">
                                  {selectedVals.map(v => (
                                    <SortableSelectedTag key={v} id={v} value={v} onRemove={() => toggleSpecValue(spec.name, v)} />
                                  ))}
                                </div>
                              </SortableContext>
                            </DndContext>
                          )}

                          {/* Input + 提示框 */}
                          <div className="relative mb-2">
                            <Input
                              value={customInput[spec.name] || ''}
                              onChange={(e) => setCustomInput(prev => ({ ...prev, [spec.name]: e.target.value }))}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  const val = (customInput[spec.name] || '').trim();
                                  if (!val) return;
                                  if (!spec.options.includes(val)) {
                                    setSpecDefs(prev => prev.map(s => s.id !== spec.id ? s : { ...s, options: [...s.options, val] }));
                                  }
                                  toggleSpecValue(spec.name, val);
                                  setCustomInput(prev => ({ ...prev, [spec.name]: '' }));
                                }
                                if (e.key === 'Tab' && spec.options.length > 0) {
                                  const sugg = spec.options.filter(o => !(specValues[spec.name] || []).includes(o));
                                  if (sugg.length > 0) {
                                    e.preventDefault();
                                    toggleSpecValue(spec.name, sugg[0]);
                                    setCustomInput(prev => ({ ...prev, [spec.name]: '' }));
                                  }
                                }
                              }}
                              placeholder={`輸入或選擇${spec.name}（Enter 新增/選取，Tab 填入建議）`}
                              className="h-8 text-xs w-full"
                            />
                            {customInput[spec.name]?.trim() && spec.options.filter(o => !(specValues[spec.name] || []).includes(o) && o.toLowerCase().includes((customInput[spec.name] || '').toLowerCase())).length > 0 && (
                              <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-40 overflow-auto">
                                {spec.options
                                  .filter(o => !(specValues[spec.name] || []).includes(o) && o.toLowerCase().includes((customInput[spec.name] || '').toLowerCase()))
                                  .slice(0, 8)
                                  .map(o => (
                                    <button
                                      key={o}
                                      type="button"
                                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent"
                                      onMouseDown={() => {
                                        toggleSpecValue(spec.name, o);
                                        setCustomInput(prev => ({ ...prev, [spec.name]: '' }));
                                      }}
                                    >
                                      {o}
                                    </button>
                                  ))}
                                {!spec.options.includes((customInput[spec.name] || '').trim()) && (
                                  <button
                                    type="button"
                                    className="w-full text-left px-3 py-1.5 text-xs text-primary hover:bg-accent border-t"
                                    onMouseDown={() => {
                                      const val = (customInput[spec.name] || '').trim();
                                      setSpecDefs(prev => prev.map(s => {
                                        if (s.id !== spec.id) return s;
                                        if (s.options.includes(val)) return s;
                                        return { ...s, options: [...s.options, val] };
                                      }));
                                      toggleSpecValue(spec.name, val);
                                      setCustomInput(prev => ({ ...prev, [spec.name]: '' }));
                                    }}
                                  >
                                    + 新增「{(customInput[spec.name] || '').trim()}」為新選項
                                  </button>
                                )}
                              </div>
                            )}
                          </div>

                          {/* 預設選項 tag（可點選/刪除，已選的不顯示） */}
                          {spec.options.filter(o => !(specValues[spec.name] || []).includes(o)).length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mb-2">
                              {spec.options.filter(o => !(specValues[spec.name] || []).includes(o)).map(o => (
                                <button
                                  key={o}
                                  type="button"
                                  onClick={() => toggleSpecValue(spec.name, o)}
                                  className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground hover:bg-muted transition-colors"
                                >
                                  <Plus className="h-3 w-3" /> {o}
                                  <span role="button" tabIndex={0} className="ml-0.5 text-muted-foreground/60 hover:text-destructive" onClick={(e) => { e.stopPropagation(); handleRemoveOption(spec.id, o); }}>
                                    <X className="h-3 w-3" />
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}

                          {/* Triggers 管理（source spec 管理「我會產生哪些 target」） */}
                          <div className="border-t pt-2 mt-2">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                                <Link2 className="h-3 w-3" /> Triggers（我會產生哪些規格）
                              </span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-6 text-[10px] px-2"
                                onClick={() => setExpandedTriggers(prev => ({ ...prev, [spec.id]: !prev[spec.id] }))}
                              >
                                {expandedTriggers[spec.id] ? '收合' : '展開'}
                              </Button>
                            </div>

                            {expandedTriggers[spec.id] && (
                              <div className="space-y-2">
                                {spec.triggers.length > 0 && (
                                  <div className="space-y-1.5">
                                    {spec.triggers.map(trig => (
                                      <div key={trig.id} className="flex items-center gap-2 rounded border bg-background px-2 py-1 text-[11px]">
                                        <span className="text-muted-foreground">當我 =</span>
                                        <Badge variant="outline" className="text-[10px]">{trig.triggerValue}</Badge>
                                        <span className="text-muted-foreground">→ 顯示</span>
                                        <Badge variant="secondary" className="text-[10px]">{trig.targetSpec}</Badge>
                                        <span className="text-muted-foreground text-[10px]">({trig.relationType})</span>
                                        <Button type="button" size="icon" variant="ghost" className="h-5 w-5 ml-auto text-destructive" onClick={() => handleRemoveTrigger(spec.id, trig.id)}>
                                          <X className="h-3 w-3" />
                                        </Button>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {/* 新增 Trigger 表單 */}
                                <div className="grid grid-cols-2 gap-2">
                                  <Select
                                    value={newTriggerState[spec.id]?.triggerValue || ''}
                                    onValueChange={(v) => setNewTriggerState(prev => ({ ...prev, [spec.id]: { ...(prev[spec.id] || { targetSpec: '', relationType: 'visibility' }), triggerValue: v } }))}
                                  >
                                    <SelectTrigger className="h-7 text-[11px]">
                                      <SelectValue placeholder="觸發值（我的值）" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {spec.options.map(o => (
                                        <SelectItem key={o} value={o}>{o}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <Select
                                    value={newTriggerState[spec.id]?.targetSpec || ''}
                                    onValueChange={(v) => setNewTriggerState(prev => ({ ...prev, [spec.id]: { ...(prev[spec.id] || { triggerValue: '', relationType: 'visibility' }), targetSpec: v } }))}
                                  >
                                    <SelectTrigger className="h-7 text-[11px]">
                                      <SelectValue placeholder="目標規格" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {specDefs.filter(s => s.name !== spec.name).map(s => (
                                        <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Select
                                    value={newTriggerState[spec.id]?.relationType || 'visibility'}
                                    onValueChange={(v) => setNewTriggerState(prev => ({ ...prev, [spec.id]: { ...(prev[spec.id] || { triggerValue: '', targetSpec: '' }), relationType: v as 'visibility' | 'quantity' } }))}
                                  >
                                    <SelectTrigger className="h-7 text-[11px] w-28">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="visibility">visibility</SelectItem>
                                      <SelectItem value="quantity">quantity</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-[11px]"
                                    onClick={() => handleAddTrigger(spec.id)}
                                    disabled={!(newTriggerState[spec.id]?.triggerValue) || !(newTriggerState[spec.id]?.targetSpec)}
                                  >
                                    <Plus className="h-3 w-3 mr-1" /> 新增 Trigger
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        </SortableSpecField>
                      );
                    })}
                  </div>
                </SortableContext>
              </DndContext>

              {/* 新增規格定義 */}
              <div className="flex items-center gap-2 pt-2 border-t">
                <Input
                  value={newSpecName}
                  onChange={(e) => setNewSpecName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddSpec(); } }}
                  placeholder="輸入新規格名稱後按 Enter"
                  className="h-8 text-xs flex-1"
                />
                <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={handleAddSpec} disabled={!newSpecName.trim()}>
                  <Plus className="h-3 w-3 mr-1" /> 新增規格定義
                </Button>
              </div>
            </div>
          )}

          {/* 4. 版本（可選，自由文字 + 自動完成） */}
          <div className="rounded-lg border bg-card p-4 space-y-2">
            <Label>版本 <span className="text-[11px] text-muted-foreground font-normal">（可選，如 a版、b版、dtp、c3f）</span></Label>
            <div className="relative">
              <Input
                value={versionInput}
                onChange={(e) => setVersionInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const val = versionInput.trim();
                    if (val) setVersion(val);
                    setVersionInput('');
                  }
                }}
                onBlur={() => {
                  const val = versionInput.trim();
                  if (val) setVersion(val);
                  setVersionInput('');
                }}
                placeholder="輸入版本號後按 Enter（如 a版、b版、dtp、c3f）"
                className="h-8 text-xs"
              />
              {versionInput.trim() && MOCK_VERSIONS.filter(v => v.toLowerCase().includes(versionInput.toLowerCase()) && v !== version).length > 0 && (
                <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-40 overflow-auto">
                  {MOCK_VERSIONS
                    .filter(v => v.toLowerCase().includes(versionInput.toLowerCase()) && v !== version)
                    .slice(0, 8)
                    .map(v => (
                      <button
                        key={v}
                        type="button"
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent"
                        onMouseDown={() => {
                          setVersion(v);
                          setVersionInput('');
                        }}
                      >
                        {v}
                      </button>
                    ))}
                </div>
              )}
            </div>
            {version && (
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  {version}
                  <button type="button" onClick={() => setVersion('')} className="ml-1 text-muted-foreground hover:text-destructive">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
                <span className="text-[11px] text-muted-foreground">已選版本</span>
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              <span className="text-[10px] text-muted-foreground">已用版本：</span>
              {MOCK_VERSIONS.map(v => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setVersion(v)}
                  className={`rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                    version === v ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">留空代表無版本區分。版本會自動寫入庫存商品連結的 spec_label。</p>
          </div>

          {/* 5. 零件名稱 */}
          <div className="rounded-lg border bg-card p-4 space-y-2">
            <div className="flex items-center justify-between">
              <Label>零件名稱 <span className="text-destructive">*</span></Label>
              <button
                type="button"
                className="text-xs text-primary underline underline-offset-2"
                onClick={() => setNameAuto(prev => !prev)}
              >
                {nameAuto ? '切換手動輸入' : '切換自動組合'}
              </button>
            </div>
            {nameAuto ? (
              <div className="flex items-center gap-2">
                <Input value={autoName} readOnly className="h-9 bg-muted/40" />
                <Badge variant="secondary" className="shrink-0 text-[10px]">自動</Badge>
              </div>
            ) : (
              <Input
                value={nameOverride}
                onChange={(e) => setNameOverride(e.target.value)}
                placeholder="手動輸入零件名稱"
                className="h-9"
              />
            )}
            <p className="text-[11px] text-muted-foreground">
              自動組合規則：型號 - 大分類 - 規格值（多選用「、」連接）。可切換手動覆寫。
            </p>
          </div>

          {/* 5. 預設成本/售價 */}
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cost">預設成本</Label>
                <Input id="cost" type="number" value={defaultCost} onChange={(e) => setDefaultCost(parseFloat(e.target.value) || 0)} className="h-9 text-sm text-right" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="price">預設售價</Label>
                <Input id="price" type="number" value={defaultPrice} onChange={(e) => setDefaultPrice(parseFloat(e.target.value) || 0)} className="h-9 text-sm text-right" />
              </div>
            </div>
          </div>



          {/* 7. 庫存商品連結 */}
          <div className="rounded-lg border bg-card p-4 space-y-2">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5"><Plus className="h-3.5 w-3.5" />庫存商品連結</Label>
              <Button type="button" variant="outline" size="sm" className="h-7 text-xs">新增連結</Button>
            </div>
            {isEdit && editingPart?.links && editingPart.links.length > 0 ? (
              <div className="space-y-1">
                {editingPart.links.map((l: any) => (
                  <div key={l.id} className="text-xs rounded-md border px-3 py-2 flex items-center justify-between">
                    <span className="truncate">{l.variant_name || l.product_name}{l.sku ? ` (${l.sku})` : ''}</span>
                    {l.is_default && <span className="text-amber-500 text-[10px]">預設</span>}
                  </div>
                ))}
                <p className="text-[10px] text-muted-foreground">編輯連結請至零件列表頁操作。</p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground rounded-md border border-dashed px-3 py-3 text-center">
                尚未綁定庫存商品。未綁定的零件無法扣庫存或叫料。
              </p>
            )}
          </div>

          {/* 8. 同時建立庫存商品（僅新建模式） */}
          {!isEdit && (
          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <div>
              <Label htmlFor="create-product">同時建立庫存商品</Label>
              <p className="text-[11px] text-muted-foreground">勾選後，建立零件時自動建立 product + variant（item_type=repair_part），並綁定庫存連結。</p>
            </div>
            <Switch id="create-product" checked={createProduct} onCheckedChange={setCreateProduct} />
          </div>
          )}
        </div>

        {/* 右：預覽 */}
        <div className="lg:col-span-1">
          <div className="sticky top-20 rounded-lg border bg-card p-4 space-y-3">
            <h2 className="text-sm font-semibold flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-primary" /> 零件預覽
            </h2>
            <div className="space-y-2 text-sm">
              <div>
                <p className="text-[11px] text-muted-foreground">名稱</p>
                <p className="font-medium">{displayName || '（未填寫）'}</p>
              </div>
              {selectedCategoryIds.length > 0 && (
                <div>
                  <p className="text-[11px] text-muted-foreground">大分類</p>
                  <div className="flex flex-wrap gap-1">
                    {selectedCategories.map(c => <Badge key={c.id} variant="secondary">{c.name}</Badge>)}
                  </div>
                </div>
              )}
              {version && (
                <div>
                  <p className="text-[11px] text-muted-foreground">版本</p>
                  <Badge variant="secondary">{version}</Badge>
                </div>
              )}
              {deviceModelIds.length > 0 && (
                <div>
                  <p className="text-[11px] text-muted-foreground">適用機型（{deviceModelIds.length}）</p>
                  <div className="flex flex-wrap gap-1">
                    {deviceModelIds.map(id => {
                      const m = models?.find(x => x.id === id);
                      return <Badge key={id} variant="outline" className="text-[10px]">{m ? (m.brand_name ? `${m.brand_name} ${m.name}` : m.name) : id}</Badge>;
                    })}
                  </div>
                </div>
              )}
              {visibleSpecs.length > 0 && (
                <div>
                  <p className="text-[11px] text-muted-foreground">規格</p>
                  <div className="space-y-1">
                    {visibleSpecs.map(s => {
                      const v = specValues[s.name];
                      if (!v || v.length === 0) return null;
                      return (
                        <div key={s.name} className="text-xs">
                          <span className="text-muted-foreground">{s.name}：</span>
                          <span className="font-medium">{v.join('、')}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 pt-2 border-t">
                <div>
                  <p className="text-[11px] text-muted-foreground">成本</p>
                  <p className="text-sm font-medium">${defaultCost}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">售價</p>
                  <p className="text-sm font-medium">${defaultPrice}</p>
                </div>
              </div>
              {createProduct && (
                <div className="rounded-md bg-primary/5 border border-primary/20 px-2 py-1.5 text-[11px] text-primary">
                  ✓ 建立時將自動建立庫存商品（item_type=repair_part）
                </div>
              )}
            </div>
            <div className="pt-3 border-t space-y-2">
              <Button
                className="w-full"
                disabled={!displayName || createMutation.isPending || updateMutation.isPending}
                onClick={() => {
                  const specValuesObj: Record<string, string[]> = {};
                  for (const [k, v] of Object.entries(specValues)) {
                    if (v && v.length > 0) specValuesObj[k] = v;
                  }
                  if (isEdit && editingId) {
                     updateMutation.mutate({
                       id: editingId,
                       input: {
                         device_model_id: deviceModelIds.length > 0 ? deviceModelIds[0] : null,
                         name: displayName,
                         description: null,
                         supplier_id: null,
                         default_unit_cost: defaultCost,
                         default_unit_price: defaultPrice,
                         is_active: true,
                         sort_order: editingPart?.sort_order || 0,
                         version: version || null,
                         links: editingPart?.links?.map((l: any) => ({
                           id: l.id,
                           product_id: l.product_id,
                           variant_id: l.variant_id || null,
                           spec_label: l.spec_label || null,
                           is_default: !!l.is_default,
                         })) || [],
                       },
                       keepIds: (editingPart?.links || []).map((l: any) => l.id),
                       deviceModelIds: deviceModelIds,
                     }, {
                       onSuccess: async () => {
                          const productId = editingPart?.links?.[0]?.product_id;
                          if (productId && selectedCategoryIds.length > 0) {
                            const specData: Record<string, any> = {};
                            for (const [specId, values] of Object.entries(specValues)) {
                              const specDef = specDefs.find(s => s.id === specId);
                              if (specDef && values && (values as string[]).length > 0) {
                                const v = values as string[];
                                specData[specDef.name] = v.length === 1 ? v[0] : v;
                              }
                            }
                            if (Object.keys(specData).length > 0) {
                              try {
                                await (supabase as any).rpc('sync_product_specs_v6', {
                                  p_entity_id: productId,
                                  p_entity_type: 'product',
                                  p_category_id: selectedCategoryIds[0],
                                  p_new_data: specData,
                                });
                              } catch (e) {
                                console.warn('Spec sync warning:', e);
                              }
                            }
                          }
                          onSaved?.();
                        },
                     });
                   } else {
                     createMutation.mutate({
                    device_model_id: deviceModelIds.length > 0 ? deviceModelIds[0] : null,
                    name: displayName,
                    description: null,
                    supplier_id: null,
                    default_unit_cost: defaultCost,
                    default_unit_price: defaultPrice,
                    is_active: true,
                    sort_order: 0,
                    version: version || null,
                    category_ids: selectedCategoryIds,
                    spec_values: specValuesObj,
                    create_product: createProduct,
                    links: [],
                  }, {
                    onSuccess: (result: any) => { onCreated?.(result?.partId); onSaved?.(); },
                  });
                   }
                }}
              >
                { (createMutation.isPending || updateMutation.isPending) ? '儲存中...' : (isEdit ? '儲存零件' : '建立零件（寫入 DB）')}
              </Button>
              <p className="text-[10px] text-muted-foreground text-center">
                建立後將自動建立庫存商品（item_type=repair_part）
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}// touch
