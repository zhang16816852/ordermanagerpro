import { UseFormReturn } from 'react-hook-form';

interface PricingFieldsProps {
    form: UseFormReturn<any>;
}

export function PricingFields(_props: PricingFieldsProps) {
    return (
        <div className="col-span-2 p-4 rounded-md bg-blue-50 border border-blue-100 text-blue-800 text-sm">
            <p className="font-bold mb-1">💡 產品級價格已移除</p>
            <p>價格已移至變體層級，請前往「變體管理」分頁為各個變體設定獨立的批發價與零售價。</p>
        </div>
    );
}
