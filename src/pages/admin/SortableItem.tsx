// SortableItem.tsx 範例
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Database } from 'lucide-react';

export function SortableItem({ id, children }) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
    } = useSortable({ id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    };

    // 注意：這裡只把 attributes 和 listeners 傳給內部的「拖拽手柄」
    // 而不是外層容器
    return (
        <div ref={setNodeRef} style={style}>
            {/* 這裡我們不直接展開 {...listeners} */}
            {/* 我們需要讓 children 自己決定哪裡可以拖拽 */}
            {/* 或者透過 React.cloneElement 傳下去，但更簡單的做法是：*/}
            <div className="flex gap-2 items-center">
                <div {...attributes} {...listeners} className="cursor-move">
                    <Database className="h-4 w-4" />
                </div>
                {children}
            </div>
        </div>
    );
}