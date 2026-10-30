import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, ArrowDown, Save, Plus, Trash2, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { BLOCK_META, type StorefrontBlock, type BlockType } from "@/storefront/blocks/schema";
import { storefrontBlocks as defaultBlocks } from "@/config/site";

const BLOCK_TYPES: BlockType[] = ["hero", "categoryRail", "featuredProducts", "statement"];

function newBlock(type: BlockType): any {
  switch (type) {
    case "hero":
      return { type, enabled: true, eyebrow: "", title: "新主視覺", lead: "", primaryCta: null, secondaryCta: null, media: { src: null, alt: "", hue: 28 }, align: "left", tone: "paper" };
    case "categoryRail":
      return { type, enabled: true, anchor: "categories", eyebrow: "依分類瀏覽", title: "商品分類", categoryIds: [], columns: 4 };
    case "featuredProducts":
      return { type, enabled: true, anchor: "featured", eyebrow: "精選商品", title: "精選商品", lead: "", source: { kind: "category", categoryId: "", productIds: [] }, layout: "grid", columns: 4, limit: 8 };
    case "statement":
      return { type, enabled: true, anchor: "about", eyebrow: "", text: "引言文字", attribution: "" };
  }
}

export default function StorefrontEditorPage() {
  const qc = useQueryClient();
  const [blocks, setBlocks] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);

  const { data: dbBlocks, isLoading } = useQuery({
    queryKey: ["storefront-page", "home", "admin"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("storefront_pages")
        .select("blocks")
        .eq("slug", "home")
        .maybeSingle();
      if (error) throw error;
      return (data?.blocks as any[]) ?? [];
    },
  });

  useEffect(() => {
    if (loaded) return;
    if (isLoading) return;
    const src = (dbBlocks && dbBlocks.length > 0 ? dbBlocks : defaultBlocks) as any[];
    setBlocks(JSON.parse(JSON.stringify(src)));
    setLoaded(true);
  }, [dbBlocks, isLoading, loaded]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any)
        .from("storefront_pages")
        .upsert({ slug: "home", blocks, updated_at: new Date().toISOString() }, { onConflict: "slug" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["storefront-page"] });
      toast.success("首頁內容已儲存");
    },
    onError: (e: any) => toast.error("儲存失敗：" + (e?.message ?? e)),
  });

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    setBlocks(next);
  };

  const remove = (i: number) => setBlocks(blocks.filter((_, idx) => idx !== i));

  const toggle = (i: number) =>
    setBlocks(blocks.map((b, idx) => (idx === i ? { ...b, enabled: !b.enabled } : b)));

  const updateField = (i: number, key: string, value: any) =>
    setBlocks(blocks.map((b, idx) => (idx === i ? { ...b, [key]: value } : b)));

  const addBlock = (type: BlockType) => setBlocks([...blocks, newBlock(type)]);

  if (isLoading || !loaded) {
    return <div className="p-6 text-muted-foreground">載入中...</div>;
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">首頁內容管理</h1>
          <p className="text-sm text-muted-foreground">編輯公開首頁的區塊內容、順序與啟用狀態。儲存後前台重新整理即反映。</p>
        </div>
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          <Save className="mr-2 h-4 w-4" /> 儲存
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {BLOCK_TYPES.map((t) => (
          <Button key={t} variant="outline" size="sm" onClick={() => addBlock(t)}>
            <Plus className="mr-1 h-3 w-3" /> 新增 {BLOCK_META[t].label}
          </Button>
        ))}
      </div>

      <div className="space-y-4">
        {blocks.map((b, i) => (
          <Card key={i} className={!b.enabled ? "opacity-50" : ""}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{BLOCK_META[b.type as BlockType]?.label ?? b.type}</Badge>
                <CardTitle className="text-base">{b.title || b.type}</CardTitle>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={() => toggle(i)} title={b.enabled ? "停用" : "啟用"}>
                  {b.enabled ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </Button>
                <Button variant="ghost" size="icon" onClick={() => move(i, -1)} disabled={i === 0}>
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => move(i, 1)} disabled={i === blocks.length - 1}>
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => remove(i)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {b.type === "hero" && (
                <>
                  <Input placeholder="eyebrow" value={b.eyebrow ?? ""} onChange={(e) => updateField(i, "eyebrow", e.target.value)} />
                  <Input placeholder="title" value={b.title ?? ""} onChange={(e) => updateField(i, "title", e.target.value)} />
                  <Textarea placeholder="lead" value={b.lead ?? ""} onChange={(e) => updateField(i, "lead", e.target.value)} />
                  <div className="flex gap-2">
                    <Input placeholder="primaryCta.label" value={b.primaryCta?.label ?? ""} onChange={(e) => updateField(i, "primaryCta", e.target.value ? { label: e.target.value, href: b.primaryCta?.href ?? "#" } : null)} />
                    <Input placeholder="primaryCta.href" value={b.primaryCta?.href ?? ""} onChange={(e) => updateField(i, "primaryCta", b.primaryCta ? { ...b.primaryCta, href: e.target.value } : null)} />
                  </div>
                  <div className="flex gap-2">
                    <Input placeholder="tone (paper/ink)" value={b.tone ?? "paper"} onChange={(e) => updateField(i, "tone", e.target.value)} />
                    <Input placeholder="align (left/center)" value={b.align ?? "left"} onChange={(e) => updateField(i, "align", e.target.value)} />
                  </div>
                </>
              )}
              {(b.type === "categoryRail" || b.type === "featuredProducts") && (
                <>
                  <Input placeholder="anchor" value={b.anchor ?? ""} onChange={(e) => updateField(i, "anchor", e.target.value)} />
                  <Input placeholder="eyebrow" value={b.eyebrow ?? ""} onChange={(e) => updateField(i, "eyebrow", e.target.value)} />
                  <Input placeholder="title" value={b.title ?? ""} onChange={(e) => updateField(i, "title", e.target.value)} />
                  <Input placeholder="lead" value={b.lead ?? ""} onChange={(e) => updateField(i, "lead", e.target.value)} />
                </>
              )}
              {b.type === "featuredProducts" && (
                <>
                  <div className="flex gap-2">
                    <Input placeholder="source.categoryId" value={b.source?.categoryId ?? ""} onChange={(e) => updateField(i, "source", { ...(b.source ?? {}), kind: "category", categoryId: e.target.value })} />
                    <Input placeholder="limit" type="number" value={b.limit ?? 8} onChange={(e) => updateField(i, "limit", Number(e.target.value) || 8)} />
                    <Input placeholder="columns" type="number" value={b.columns ?? 4} onChange={(e) => updateField(i, "columns", Number(e.target.value) || 4)} />
                  </div>
                  <Input placeholder="layout (grid/rail)" value={b.layout ?? "grid"} onChange={(e) => updateField(i, "layout", e.target.value)} />
                </>
              )}
              {b.type === "categoryRail" && (
                <Input placeholder="columns" type="number" value={b.columns ?? 4} onChange={(e) => updateField(i, "columns", Number(e.target.value) || 4)} />
              )}
              {b.type === "statement" && (
                <>
                  <Input placeholder="anchor" value={b.anchor ?? ""} onChange={(e) => updateField(i, "anchor", e.target.value)} />
                  <Textarea placeholder="text" value={b.text ?? ""} onChange={(e) => updateField(i, "text", e.target.value)} />
                  <Input placeholder="attribution" value={b.attribution ?? ""} onChange={(e) => updateField(i, "attribution", e.target.value)} />
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}