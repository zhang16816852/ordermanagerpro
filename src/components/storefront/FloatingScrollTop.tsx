import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * 浮動置頂按鈕（右下角）
 * - 滾動超過 300px 才顯示
 * - 點擊平滑滾動到頂部
 * - 預留擴展：未來可加入更多功能（如快速搜尋、回到篩選等）
 */
export function FloatingScrollTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 300);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <Button
      type="button"
      size="icon"
      className="fixed bottom-6 right-6 z-40 h-12 w-12 rounded-full shadow-lg"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="回到頂部"
    >
      <ArrowUp className="h-5 w-5" />
    </Button>
  );
}
