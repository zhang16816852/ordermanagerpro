import { useState, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';
import { formatSpecValue } from '@/utils/specLogic';
import { generateProductExcel } from '@/utils/excelUtils';
import * as XLSX from 'xlsx';
import { useColorStore } from '@/store/useColorStore';
import { useDeviceModelStore } from '@/store/useDeviceModelStore';
import { useSpecStore } from '@/store/useSpecStore';
import { useProductImportParser } from './useProductImportParser';
import { useProductImportValidator } from './useProductImportValidator';
import { useProductImportUploader } from './useProductImportUploader';

export interface ImportRow {
    product_sku: string;
    product_name: string;
    description: string;
    category: string;
    category_id?: string;
    brand: string;
    brand_id?: string;
    model: string;
    series: string;
    base_wholesale_price: number;
    base_retail_price: number;
    product_status: 'active' | 'discontinued' | 'preorder' | 'sold_out';
    spec_values?: any;
    variant_sku?: string;
    variant_name?: string;
    option_1?: string;
    option_2?: string;
    option_3?: string;
    variant_wholesale_price?: number;
    variant_retail_price?: number;
    variant_status?: 'active' | 'discontinued' | 'preorder' | 'sold_out';
    variant_spec_values?: any;
    barcode?: string;
    device_models?: string;
    variant_device_models?: string;
    is_variant: boolean;
    product_id?: string;
    variant_id?: string;
    _specs?: Record<string, any>;
    category_ids?: string[];
    category_names?: string[];
    errors: string[];
    isValid: boolean;
    action?: 'create' | 'update';
    diff?: string[];
    has_variants?: boolean;

}

export function useProductImport(onSuccess: () => void) {
    const queryClient = useQueryClient();
    const [step, setStep] = useState<'upload' | 'preview'>('upload');
    const [importData, setImportData] = useState<ImportRow[]>([]);
    const [filterCategory, setFilterCategory] = useState<string>('all');
    const [filterStatus, setFilterStatus] = useState<string>('all');

    const { data: categories = [] } = useQuery({
        queryKey: ['categories'],
        queryFn: async () => {
            const { data } = await supabase.from('categories').select('*');
            return data || [];
        },
    });

    const { specDefinitions: specDefs, fetchSpecs } = useSpecStore();
    const { colors: allColors, fetchColors } = useColorStore();
    const { models: allDeviceModels, groups: allGroups, fetchData: fetchDeviceData } = useDeviceModelStore();

    useEffect(() => { fetchColors(); fetchDeviceData(true); fetchSpecs(); }, [fetchColors, fetchDeviceData, fetchSpecs]);

    const { data: allBrands = [] } = useQuery({
        queryKey: ['brands-all-for-import'],
        queryFn: async () => {
            const { data } = await supabase.from('brands').select('*');
            return (data as any[]) || [];
        },
    });

    const parser = useProductImportParser(specDefs, allBrands, allColors, categories);
    const validator = useProductImportValidator(allColors, allDeviceModels, allGroups, categories);

    const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            await fetchDeviceData(true);

            const rawParsed = await parser.handleFileUpload(file);
            if (rawParsed.length === 0) {
                toast.error('檔案中沒有有效的產品資料');
                return;
            }

            const enrichedData = await validator.enrichWithDiff(rawParsed);
            setImportData(enrichedData);
            setStep('preview');
        } catch (err: any) {
            console.error('File parsing error:', err);
            toast.error(`檔案解析失敗: ${getErrorMessage(err)}`);
        }
    }, [parser, validator, fetchDeviceData]);

    const resetState = useCallback(() => {
        setStep('upload');
        setImportData([]);
        setFilterCategory('all');
    }, []);

    const updateRow = useCallback((index: number, field: keyof ImportRow, value: any) => {
        setImportData(prev => {
            const next = [...prev];
            next[index] = { ...next[index], [field]: value };
            return next;
        });
    }, []);

    const removeRow = useCallback((index: number) => {
        setImportData(prev => prev.filter((_, i) => i !== index));
    }, []);

    const batchUpdateRows = useCallback((updates: { index: number; field: keyof ImportRow; value: any }[]) => {
        setImportData(prev => {
            const next = [...prev];
            for (const { index, field, value } of updates) {
                next[index] = { ...next[index], [field]: value };
            }
            return next;
        });
    }, []);

    const uploader = useProductImportUploader(
        importData, categories, allDeviceModels, allGroups,
        onSuccess, resetState
    );

    const filteredData = importData.filter(row => {
        const cats = row.category.split(',').map(s => s.trim());
        const categoryMatch = filterCategory === 'all' || cats.includes(filterCategory);
        const statusMatch = filterStatus === 'all' ||
            (filterStatus === 'changed' && row.diff && row.diff.length > 0) ||
            (filterStatus === 'new' && row.action === 'create') ||
            (filterStatus === 'error' && !row.isValid);
        return categoryMatch && statusMatch;
    });

    const downloadTemplate = useCallback(() => {
        const { categoryLinks } = useSpecStore.getState();
        const brandMap = Object.fromEntries(allBrands.map(b => [b.id, b.name]));
        const workbook = generateProductExcel([], categories, specDefs, categoryLinks, brandMap);
        const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
        const data = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(data);
        const a = document.createElement('a');
        a.href = url;
        a.download = '產品匯入範本.xlsx';
        a.click();
        URL.revokeObjectURL(url);
    }, [categories, specDefs, allBrands]);

    useEffect(() => {
        if (importData.length === 0) return;
        const timer = setTimeout(() => {
            setImportData(prev => prev.map(row => {
                const { errors } = validator.validateRow(row as any);
                return { ...row, errors, isValid: errors.length === 0 };
            }));
        }, 300);
        return () => clearTimeout(timer);
    }, [allColors, allDeviceModels, allGroups, validator]);

    return {
        step,
        importData,
        filteredData,
        filterCategory,
        setFilterCategory,
        filterStatus,
        setFilterStatus,
        categories,
        isLoading: uploader.importMutation.isPending,
        handleFileUpload,
        updateRow,
        batchUpdateRows,
        removeRow,
        importMutation: uploader.importMutation,
        downloadTemplate,
        resetState,
        allBrands,
        uploadProgress: uploader.uploadProgress,
        processedCount: uploader.processedCount,
        skippedCount: uploader.skippedCount,
        specDefs,
    };
}
