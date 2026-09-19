"use client";

import { useEffect, useMemo, useState } from "react";
import { FileText, Image as ImageIcon, Link2, Loader2, Package, Play, Video } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  filterProductSendables,
  listProductSendables,
  type ProductLibraryItem,
  type ProductSendItem,
} from "@/lib/inbox/product-library";

interface ProductLibraryPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSend: (items: ProductSendItem[]) => void;
}

function kindIcon(kind: ProductSendItem["kind"]) {
  if (kind === "pdf") return FileText;
  if (kind === "image") return ImageIcon;
  if (kind === "video") return Video;
  if (kind === "youtube") return Play;
  return Link2;
}

export function ProductLibraryPicker({
  open,
  onOpenChange,
  onSend,
}: ProductLibraryPickerProps) {
  const t = useTranslations("Inbox.composer");
  const [products, setProducts] = useState<ProductLibraryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [keys, setKeys] = useState<string[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setSelectedId(null);
    setKeys([]);
    setQuery("");
    void (async () => {
      try {
        const res = await fetch("/api/products", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) {
          setProducts((data.products as ProductLibraryItem[]) ?? []);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => {
      return (
        p.name.toLowerCase().includes(q) ||
        (p.sku ?? "").toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q)
      );
    });
  }, [products, query]);

  const selected = products.find((p) => p.id === selectedId) ?? null;
  const sendables = selected ? listProductSendables(selected) : [];

  function toggleKey(key: string) {
    setKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  function chooseProduct(product: ProductLibraryItem) {
    setSelectedId(product.id);
    setKeys(listProductSendables(product).map((item) => item.key));
  }

  function send(mode: "all" | "selected") {
    if (!selected) return;
    const items = filterProductSendables(
      selected,
      mode === "all" ? "all" : keys,
    );
    if (!items.length) return;
    onSend(items);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("productLibrary")}</DialogTitle>
        </DialogHeader>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("productSearch")}
          className="h-9 w-full rounded-md border border-border bg-muted px-3 text-sm text-foreground outline-none focus:border-primary/50"
        />
        <div className="max-h-[50vh] overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("productLibraryEmpty")}
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {filtered.map((product) => (
                <li key={product.id}>
                  <button
                    type="button"
                    onClick={() => chooseProduct(product)}
                    className={`flex w-full items-start gap-2 rounded-md border p-2.5 text-left ${
                      selectedId === product.id
                        ? "border-primary/50 bg-muted"
                        : "border-border bg-muted/40 hover:border-primary/40"
                    }`}
                  >
                    <Package className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {product.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[product.sku, product.description]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {selected && sendables.length > 0 && (
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-xs font-medium text-muted-foreground">
              {t("productChooseAssets")}
            </p>
            <ul className="flex flex-col gap-1">
              {sendables.map((item) => {
                const Icon = kindIcon(item.kind);
                return (
                  <li key={item.key}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm text-foreground hover:bg-muted">
                      <input
                        type="checkbox"
                        checked={keys.includes(item.key)}
                        onChange={() => toggleKey(item.key)}
                      />
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 truncate">{item.label}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            disabled={!selected || sendables.length === 0}
            onClick={() => send("all")}
          >
            {t("productSendAll")}
          </Button>
          <Button
            type="button"
            disabled={!selected || keys.length === 0}
            onClick={() => send("selected")}
          >
            {t("productSendSelected")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
