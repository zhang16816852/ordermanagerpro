import type { CategorySpec } from '@/hooks/useCategorySpecs';

// 選項值「其他」＝允許自訂輸入的閾值選項；自訂內容視為個例，不會回寫到 spec.options
export const OTHER_OPTION = '其他';

export interface SpecValueEditorProps {
    spec: CategorySpec;
    value: any;
    onChange: (val: any) => void;
    sourceValue?: any;
    isQuantityDetail?: boolean;
    variantMode?: boolean;
}