import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ImagePlus, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getErrorMessage } from '@/lib/errorMessages';
import { cn } from "@/lib/utils";

const MAX_IMAGES = 2;
const MAX_SIZE_MB = 5;

interface MarketImageUploaderProps {
  value: string[];
  onChange: (urls: string[]) => void;
  disabled?: boolean;
}

export function MarketImageUploader({ value, onChange, disabled }: MarketImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;

    const remaining = MAX_IMAGES - value.length;
    if (remaining <= 0) {
      toast.error(`最多只能上傳 ${MAX_IMAGES} 張圖片`);
      return;
    }
    const toUpload = files.slice(0, remaining);

    // Validate size
    for (const f of toUpload) {
      if (f.size > MAX_SIZE_MB * 1024 * 1024) {
        toast.error(`${f.name} 超過 ${MAX_SIZE_MB}MB 限制`);
        return;
      }
    }

    setUploading(true);
    try {
      const uploaded: string[] = [];
      for (const file of toUpload) {
        const ext = file.name.split(".").pop();
        const path = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const { error } = await supabase.storage.from("market_images").upload(path, file, {
          cacheControl: "3600",
          upsert: false,
        });
        if (error) throw error;

        const { data } = supabase.storage.from("market_images").getPublicUrl(path);
        uploaded.push(data.publicUrl);
      }
      onChange([...value, ...uploaded]);
      toast.success(`成功上傳 ${uploaded.length} 張圖片`);
    } catch (err: any) {
      toast.error("上傳失敗：" + getErrorMessage(err));
    } finally {
      setUploading(false);
      // Reset input so same file can be re-selected
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleRemove = async (url: string) => {
    // Extract path from URL
    const path = url.split("/market_images/")[1];
    if (path) {
      await supabase.storage.from("market_images").remove([path]);
    }
    onChange(value.filter((u) => u !== url));
  };

  return (
    <div className="space-y-3">
      {/* Preview grid */}
      <div className="flex gap-3 flex-wrap">
        {value.map((url, idx) => (
          <div key={url} className="relative group w-24 h-24 rounded-xl overflow-hidden border border-white/10">
            <img src={url} alt={`圖片 ${idx + 1}`} className="w-full h-full object-cover" />
            <button
              type="button"
              onClick={() => handleRemove(url)}
              disabled={disabled}
              className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X className="h-5 w-5 text-white" />
            </button>
          </div>
        ))}

        {/* Upload slot */}
        {value.length < MAX_IMAGES && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={disabled || uploading}
            className={cn(
              "w-24 h-24 rounded-xl border-2 border-dashed border-white/20 flex flex-col items-center justify-center gap-1 transition-colors hover:border-primary/50 hover:bg-primary/5",
              (disabled || uploading) && "opacity-50 cursor-not-allowed"
            )}
          >
            {uploading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <>
                <ImagePlus className="h-5 w-5 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground">
                  {value.length}/{MAX_IMAGES}
                </span>
              </>
            )}
          </button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        最多 {MAX_IMAGES} 張，每張不超過 {MAX_SIZE_MB}MB，支援 JPG / PNG / WEBP
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
