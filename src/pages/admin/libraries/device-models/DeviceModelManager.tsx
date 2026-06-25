import { useState } from 'react';
import { useDeviceModels } from '../../products/hooks/useDeviceModels';
import { FullDeviceModel as DeviceModel } from '@/types/device-models';
import { fetchAllRows } from '@/lib/utils';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ImportPreviewDialog, ImportColumn } from '@/components/shared/ImportPreviewDialog';
import { Badge } from '@/components/ui/badge';

// Import split components
import { DeviceModelActions } from './DeviceModelActions';
import { DeviceModelListView } from './DeviceModelListView';
import { DeviceModelGroupView } from './DeviceModelGroupView';
import { DeviceModelDialog } from './DeviceModelDialog';
import { DeviceModelGroupManager } from './DeviceModelGroupManager';

export function DeviceModelManager() {
  const queryClient = useQueryClient();
  const { models, isLoading, createMutation, updateMutation, deleteMutation } = useDeviceModels();

  const { data: deviceBrands = [] } = useQuery({
    queryKey: ['device_brands'],
    queryFn: async () => {
      const { data } = await supabase.from('device_brands').select('*').order('sort_order', { ascending: true });
      return data || [];
    }
  });

  const createBrandMutation = useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await supabase.from('device_brands').insert([{ name }]).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['device_brands'] });
    }
  });

  const [search, setSearch] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingData, setEditingData] = useState<Partial<DeviceModel> | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<any[]>([]);
  const [previewParseResult, setPreviewParseResult] = useState<{ modelsToCreate: any[]; modelsToUpdate: any[] } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  const [typeFilter, setTypeFilter] = useState('all');

  const uniqueTypes = Array.from(new Set(models.map(m => m.device_type).filter(Boolean))) as string[];

  const filteredModels = models.filter(m => {
    const matchSearch = m.name.toLowerCase().includes(search.toLowerCase());
    const matchType = typeFilter === 'all' || m.device_type === typeFilter;
    return matchSearch && matchType;
  });

  const handleSave = () => {
    if (!editingData?.name?.trim()) return;

    const payload = {
      name: editingData.name,
      sort_order: editingData.sort_order || 0,
      brand_id: editingData.brand_id || null,
      device_type: editingData.device_type || null,
      screen_size: editingData.screen_size || null,
      device_series: editingData.device_series || null,
      device_remarks: editingData.device_remarks || null,
      release_date: editingData.release_date || null,
      aliases: editingData.aliases || null
    };
    console.log("發送", payload)
    if (editingData.id) {
      updateMutation.mutate({ id: editingData.id, values: payload }, {
        onSuccess: () => setIsDialogOpen(false)
      });
    } else {
      createMutation.mutate({ ...payload, is_active: true }, {
        onSuccess: () => setIsDialogOpen(false)
      });
    }
  };

  const openEdit = (model?: DeviceModel) => {
    console.log("openEdit", model)
    if (model) {
      setEditingData(model);
    } else {
      setEditingData({ name: '', sort_order: 0, is_active: true, brand_id: null, device_type: '', screen_size: '', device_series: '', device_remarks: '', release_date: '' });
    }
    setIsDialogOpen(true);
  };

  const handleExport = () => {
    const exportData = models.map(m => ({
      '型號ID': m.id,
      '型號名稱': m.name || '',
      '別名': (m.aliases || []).join(', '),
      '廠牌': m.brand_id ? deviceBrands.find((b: any) => b.id === m.brand_id)?.name || '' : '',
      '系列': m.device_series || '',
      '設備類型': m.device_type || '',
      '螢幕尺寸': m.screen_size || '',
      '出廠日期': m.release_date || '',
      '備註': m.device_remarks || '',
      '排序': m.sort_order || 0,
      '啟用': m.is_active !== false ? '是' : '否'
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    // 隱藏第一欄 (型號ID)
    worksheet['!cols'] = [{ hidden: true }];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '型號標籤庫');

    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = '型號標籤庫.xlsx';
    link.click();
    URL.revokeObjectURL(url);
  };

  const compareFields = (a: any, b: any): boolean => {
    const fields = ['name', 'brand_id', 'aliases', 'device_type', 'device_series', 'screen_size', 'release_date', 'device_remarks', 'sort_order', 'is_active'];
    return fields.every(f => {
      const va = a[f] === '' ? null : a[f];
      const vb = b[f] === '' ? null : b[f];
      if (va == null && vb == null) return true;
      if (Array.isArray(va) && Array.isArray(vb)) {
        return va.length === vb.length && va.every((v, i) => v === vb[i]);
      }
      return va === vb;
    });
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setPreviewError(null);

      const result = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(new Error('檔案讀取失敗'));
        reader.readAsArrayBuffer(file);
      });

      const workbook = XLSX.read(result, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const rawRows = XLSX.utils.sheet_to_json(worksheet) as any[];

      if (rawRows.length === 0) throw new Error('檔案內無資料');

      const nonEmptyRows = rawRows.filter(r =>
        Object.values(r).some(v => v != null && String(v).trim() !== '')
      );

      const { data: currentBrands } = await supabase.from('device_brands').select('*');
      const existingBrandSet = new Set((currentBrands || []).map((b: any) => b.name.toLowerCase()));

      const uniqueBrands = Array.from(new Set(nonEmptyRows.map(r => (r['廠牌'] || r['brand'] || '').trim()).filter(Boolean)));
      const newBrands = uniqueBrands.filter(b => !existingBrandSet.has(b.toLowerCase()));

      if (newBrands.length > 0) {
        const { error: brandError } = await supabase.from('device_brands').insert(newBrands.map(name => ({ name })));
        if (brandError) throw brandError;
      }

      const { data: updatedBrands } = await supabase.from('device_brands').select('*');
      const brandMap = new Map((updatedBrands || []).map((b: any) => [b.name.toLowerCase(), b.id]));

      const existingModels = await fetchAllRows<any>('device_models', '*');
      const existingByName = new Map((existingModels || []).map((m: any) => [m.name.toLowerCase(), m]));
      const existingById = new Map((existingModels || []).map((m: any) => [m.id, m]));

      const modelsToCreate: any[] = [];
      const modelsToUpdate: any[] = [];
      const previewRows: any[] = [];
      const creatingNames = new Set<string>();
      let newCount = 0, updateCount = 0, unchangedCount = 0, duplicateCount = 0;

      for (const r of nonEmptyRows) {
        const name = String(r['型號名稱'] || r['name'] || '').trim();
        if (!name) continue;

        const modelId = r['型號ID'] || r['id'] || '';
        const bName = String(r['廠牌'] || r['brand'] || '').trim().toLowerCase();
        const brandId = bName ? brandMap.get(bName) || null : null;

        const aliasesStr = String(r['別名'] || r['aliases'] || '');
        const aliases = aliasesStr.split(',').map((a: string) => a.trim()).filter(Boolean);

        const modelData = {
          name,
          brand_id: brandId,
          aliases: aliases.length > 0 ? aliases : null,
          device_type: String(r['設備類型'] || r['device_type'] || '').trim() || null,
          device_series: String(r['系列'] || r['device_series'] || '').trim() || null,
          screen_size: String(r['螢幕尺寸'] || r['screen_size'] || '').trim() || null,
          release_date: (() => {
            const val = r['出廠日期'] ?? r['出廠年月'] ?? r['release_date'];
            if (val == null || val === '') return null;
            // Excel serial date number (days since 1899-12-30)
            if (typeof val === 'number' && val > 1) {
              const date = new Date(Date.UTC(1899, 11, 30) + val * 86400000);
              if (!isNaN(date.getTime())) {
                return date.toISOString().split('T')[0];
              }
            }
            // String: "2025/09/15" or "2025-09-15" or "2025-09"
            const raw = String(val).trim();
            if (!raw) return null;
            const cleaned = raw.replace(/\//g, '-');
            const parts = cleaned.split('-').filter(Boolean);
            if (parts.length === 3) return cleaned;
            if (parts.length === 2) return cleaned + '-01';
            return null;
          })(),
          device_remarks: String(r['備註'] || r['device_remarks'] || '').trim() || null,
          sort_order: parseInt(r['排序'] || r['sort_order'] || '0', 10) || 0,
          is_active: r['啟用'] !== '否'
        };

        const nameLower = name.toLowerCase();
        let status: string;
        let reason = '';

        if (modelId && existingById.has(modelId)) {
          const existing = existingById.get(modelId);
          if (compareFields(modelData, existing)) {
            status = '無變動';
            unchangedCount++;
          } else if (modelData.name.toLowerCase() !== existing.name.toLowerCase() && existingByName.has(modelData.name.toLowerCase())) {
            status = '重複名稱';
            reason = `名稱「${modelData.name}」已被其他型號使用`;
            duplicateCount++;
          } else {
            status = '更新';
            modelsToUpdate.push({ id: modelId, ...modelData });
            updateCount++;
          }
        } else if (creatingNames.has(nameLower) || existingByName.has(nameLower)) {
          status = '重複名稱';
          reason = creatingNames.has(nameLower) ? '檔案內重複' : `「${name}」已存在於資料庫`;
          duplicateCount++;
        } else {
          status = '新增';
          creatingNames.add(nameLower);
          modelsToCreate.push(modelData);
          newCount++;
        }

        const brandDisplayName = bName ? (updatedBrands || []).find((b: any) => b.id === brandId)?.name || bName : '';
        previewRows.push({
          _status: status,
          _reason: reason,
          name,
          brand_name: brandDisplayName,
          aliases_display: aliases.join(', '),
          device_type: modelData.device_type || '',
          device_series: modelData.device_series || '',
          screen_size: modelData.screen_size || '',
          release_date: modelData.release_date || '',
          device_remarks: modelData.device_remarks || '',
          sort_order: modelData.sort_order,
          is_active: modelData.is_active,
        });
      }

      setPreviewData(previewRows);
      setPreviewParseResult({ modelsToCreate, modelsToUpdate });
      setPreviewOpen(true);
    } catch (err: any) {
      setPreviewError(err.message);
    } finally {
      e.target.value = '';
    }
  };

  const handleConfirmImport = async () => {
    if (!previewParseResult) return;
    setIsConfirming(true);
    try {
      const { modelsToCreate, modelsToUpdate } = previewParseResult;

      if (modelsToUpdate.length > 0) {
        const batchSize = 50;
        for (let i = 0; i < modelsToUpdate.length; i += batchSize) {
          const batch = modelsToUpdate.slice(i, i + batchSize);
          const { error } = await supabase.from('device_models').upsert(batch);
          if (error) throw error;
        }
      }

      if (modelsToCreate.length > 0) {
        const batchSize = 50;
        for (let i = 0; i < modelsToCreate.length; i += batchSize) {
          const batch = modelsToCreate.slice(i, i + batchSize);
          const { error } = await supabase.from('device_models').insert(batch);
          if (error) throw error;
        }
      }

      const total = modelsToCreate.length + modelsToUpdate.length;
      toast.success(`成功匯入 ${total} 筆型號`);
      setPreviewOpen(false);
      queryClient.invalidateQueries({ queryKey: ['device_models'] });
      queryClient.invalidateQueries({ queryKey: ['device_brands'] });
    } catch (err: any) {
      setPreviewError(err.message);
    } finally {
      setIsConfirming(false);
    }
  };

  const importColumns: ImportColumn[] = [
    {
      key: '_status', header: '狀態', width: '90px',
      render: (val: string) => {
        const map: Record<string, { label: string, variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
          '新增': { label: '新增', variant: 'default' },
          '更新': { label: '更新', variant: 'secondary' },
          '無變動': { label: '無變動', variant: 'outline' },
          '重複名稱': { label: '重複', variant: 'destructive' },
        };
        const m = map[val] || { label: val, variant: 'outline' as const };
        return <Badge variant={m.variant}>{m.label}</Badge>;
      },
    },
    { key: 'name', header: '型號名稱', width: '160px' },
    { key: 'brand_name', header: '廠牌', width: '120px' },
    { key: 'aliases_display', header: '別名', width: '160px' },
    { key: 'device_type', header: '設備類型', width: '110px' },
    { key: 'device_series', header: '系列', width: '110px' },
    { key: 'screen_size', header: '螢幕尺寸', width: '100px' },
    { key: 'release_date', header: '出廠日期', width: '110px' },
    { key: 'device_remarks', header: '備註', width: '150px' },
    { key: 'sort_order', header: '排序', width: '60px', align: 'right' },
    { key: 'is_active', header: '啟用', width: '60px', render: (val: boolean) => val ? '是' : '否' },
  ];

  // Calculate unique series for the currently selected brand
  const uniqueSeriesByBrand = Array.from(
    new Set(
      models
        .filter(m => m.brand_id === editingData?.brand_id && m.device_series)
        .map(m => m.device_series as string)
    )
  );

  return (
    <div className="space-y-4">
      <DeviceModelActions
        search={search}
        setSearch={setSearch}
        typeFilter={typeFilter}
        setTypeFilter={setTypeFilter}
        uniqueTypes={uniqueTypes}
        openEdit={openEdit}
        isImporting={isImporting}
        handleImport={handleImport}
        handleExport={handleExport}
      />

      <Tabs defaultValue="list" className="w-full">
        <TabsList className="grid w-full grid-cols-3 max-w-[500px]">
          <TabsTrigger value="list">詳細清單</TabsTrigger>
          <TabsTrigger value="group">依品牌檢視</TabsTrigger>
          <TabsTrigger value="model-group">型號群組 (快捷鍵)</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="mt-4">
          <DeviceModelListView
            isLoading={isLoading}
            models={filteredModels}
            deviceBrands={deviceBrands}
            openEdit={openEdit}
            updateMutation={updateMutation}
            deleteMutation={deleteMutation}
          />
        </TabsContent>

        <TabsContent value="group" className="mt-4">
          <DeviceModelGroupView
            isLoading={isLoading}
            models={filteredModels}
            deviceBrands={deviceBrands}
            openEdit={openEdit}
            updateMutation={updateMutation}
            deleteMutation={deleteMutation}
          />
        </TabsContent>

        <TabsContent value="model-group" className="mt-4">
          <DeviceModelGroupManager />
        </TabsContent>
      </Tabs>

      <DeviceModelDialog
        isOpen={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        editingData={editingData}
        setEditingData={setEditingData}
        deviceBrands={deviceBrands}
        createBrandMutation={createBrandMutation}
        handleSave={handleSave}
        uniqueSeriesByBrand={uniqueSeriesByBrand}
      />

      <ImportPreviewDialog
        open={previewOpen}
        onOpenChange={(open) => { if (!isConfirming) { setPreviewOpen(open); if (!open) setPreviewError(null); } }}
        title="型號匯入預覽"
        description="請確認以下解析結果，確認無誤後按「確認匯入」寫入資料庫。"
        data={previewData}
        columns={importColumns}
        onConfirm={handleConfirmImport}
        isLoading={isConfirming}
        error={previewError}
        statusKey="_status"
      />
    </div>
  );
}
