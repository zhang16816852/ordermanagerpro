import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { ImportRow } from '../../hooks/useProductImport';

interface EditableTextCellProps {
    value: string | undefined;
    placeholder?: string;
    onChange: (value: string) => void;
    isDiff?: boolean;
    className?: string;
    mono?: boolean;
}

export function EditableTextCell({ value, placeholder, onChange, isDiff, className, mono }: EditableTextCellProps) {
    return (
        <Input
            value={value || ''}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            className={cn(
                mono ? "h-8 font-mono text-[11px]" : "h-8 text-xs",
                "border-none bg-transparent focus-visible:bg-background",
                isDiff && "bg-amber-500/10 text-amber-900",
                className
            )}
        />
    );
}
