interface RepairPartTagsProps {
  tags?: string[] | null;
  className?: string;
}

/** 維修品項的型錄標籤列（僅綁定型錄零件時顯示） */
export function RepairPartTags({ tags, className = '' }: RepairPartTagsProps) {
  const list = (tags || []).filter(Boolean);
  if (list.length === 0) return null;
  return (
    <div className={`flex flex-wrap gap-1 mt-1 ${className}`}>
      {list.map(tag => (
        <span
          key={tag}
          className="rounded-full border border-border bg-muted/40 px-1.5 py-0 text-[10px] font-normal text-muted-foreground leading-4"
        >
          #{tag}
        </span>
      ))}
    </div>
  );
}
