-- ============================================================
-- 053_product_library.sql
--
-- Product library administered from Odoo (wacrm_sync) and sent
-- from the WhatsApp inbox. Odoo is the source of truth; wacrm
-- stores a copy so agents can pick assets without calling Odoo.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.product_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  odoo_id text,
  name text NOT NULL,
  sku text,
  description text,
  website_url text,
  youtube_url text,
  inventory_product_ref text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS product_library_account_odoo_uidx
  ON public.product_library (account_id, odoo_id)
  WHERE odoo_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS product_library_account_name_idx
  ON public.product_library (account_id, name);

CREATE TABLE IF NOT EXISTS public.product_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.product_library(id) ON DELETE CASCADE,
  odoo_id text,
  kind text NOT NULL CHECK (kind IN ('pdf', 'image', 'video', 'youtube', 'website')),
  name text NOT NULL,
  url text,
  storage_path text,
  filename text,
  mime_type text,
  sort_order integer NOT NULL DEFAULT 10,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS product_assets_account_odoo_uidx
  ON public.product_assets (account_id, odoo_id)
  WHERE odoo_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS product_assets_product_idx
  ON public.product_assets (product_id, sort_order);

ALTER TABLE public.product_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can read product library" ON public.product_library;
CREATE POLICY "Members can read product library"
  ON public.product_library FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_id = product_library.account_id
    )
  );

DROP POLICY IF EXISTS "Members can read product assets" ON public.product_assets;
CREATE POLICY "Members can read product assets"
  ON public.product_assets FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_id = product_assets.account_id
    )
  );

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-media',
  'product-media',
  TRUE,
  16777216,
  ARRAY[
    'image/png', 'image/jpeg', 'image/webp',
    'video/mp4', 'video/3gpp',
    'application/pdf'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Product media is publicly readable" ON storage.objects;
CREATE POLICY "Product media is publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'product-media');

DROP POLICY IF EXISTS "Members can upload product media" ON storage.objects;
CREATE POLICY "Members can upload product media"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'product-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can delete product media" ON storage.objects;
CREATE POLICY "Members can delete product media"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'product-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );
