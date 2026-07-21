'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  Loader2,
  QrCode,
  RefreshCw,
  Trash2,
  Plus,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';

type EvoState = 'open' | 'connecting' | 'close' | 'unknown';

interface Instance {
  id: string;
  instance: string;
  label: string;
  base_url: string;
  state: EvoState;
  connected: boolean;
}

/**
 * Settings panel for the Evolution transport — now multi-instance
 * (migration 039). Lists the account's connected numbers, lets you add a
 * new one (scan its QR), reconnect, or disconnect each. Talks only to
 * `/api/whatsapp/evolution`.
 */
export function EvolutionConfig() {
  const t = useTranslations('Settings.whatsapp.evolution');
  const { accountId, loading: authLoading, profileLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [instances, setInstances] = useState<Instance[]>([]);

  // Add / reconnect form.
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [instance, setInstance] = useState('');
  const [label, setLabel] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);

  // The instance currently showing a QR to scan.
  const [qrInstance, setQrInstance] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);

  const loadedRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadInstances = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/evolution', { method: 'GET' });
      const data = await res.json();
      setInstances((data.instances as Instance[]) ?? []);
      // Prefill the server URL from an existing instance for convenience.
      if (data.instances?.[0]?.base_url && !baseUrl) {
        setBaseUrl(data.instances[0].base_url);
      }
    } catch (err) {
      console.error('[evolution-config] load failed:', err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (authLoading || profileLoading) return;
    if (!accountId) {
      setLoading(false);
      return;
    }
    if (loadedRef.current === accountId) return;
    loadedRef.current = accountId;
    loadInstances();
  }, [authLoading, profileLoading, accountId, loadInstances]);

  // Poll the instance being connected until its phone links.
  const pollQr = useCallback(async (inst: string) => {
    try {
      const res = await fetch(
        `/api/whatsapp/evolution?instance=${encodeURIComponent(inst)}`,
        { method: 'GET' },
      );
      const data = await res.json();
      if (data.state === 'open' || data.connected) {
        setQr(null);
        setQrInstance(null);
        toast.success(t('toastConnected'));
        loadInstances();
        return;
      }
      setQr(data.qr ?? null);
      setPairingCode(data.pairingCode ?? null);
    } catch (err) {
      console.error('[evolution-config] pollQr failed:', err);
    }
  }, [t, loadInstances]);

  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (qrInstance) {
      pollRef.current = setInterval(() => pollQr(qrInstance), 3000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [qrInstance, pollQr]);

  async function handleConnect(reconnectInstance?: Instance) {
    const inst = reconnectInstance?.instance ?? instance.trim();
    const url = reconnectInstance?.base_url ?? baseUrl.trim();
    if (!url || !inst) {
      toast.error(t('errorRequired'));
      return;
    }
    if (!reconnectInstance && !apiKey.trim()) {
      toast.error(t('errorApiKeyRequired'));
      return;
    }

    try {
      setSaving(true);
      const res = await fetch('/api/whatsapp/evolution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base_url: url,
          api_key: reconnectInstance ? '' : apiKey.trim(),
          instance: inst,
          label: reconnectInstance?.label ?? (label.trim() || inst),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('toastConnectFailed'));
        return;
      }
      setQrInstance(inst);
      setQr(data.qr ?? null);
      setPairingCode(data.pairingCode ?? null);
      if (data.state === 'open') {
        toast.success(t('toastConnected'));
        setQrInstance(null);
      } else if (data.qr) {
        toast.success(t('toastScanQr'));
      }
      // Reset the add form after a new connection.
      if (!reconnectInstance) {
        setInstance('');
        setLabel('');
        setApiKey('');
      }
      loadInstances();
    } catch (err) {
      console.error('[evolution-config] connect failed:', err);
      toast.error(t('toastConnectFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect(inst: Instance) {
    if (!confirm(t('resetConfirm'))) return;
    try {
      const res = await fetch(
        `/api/whatsapp/evolution?instance=${encodeURIComponent(inst.instance)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || t('toastResetFailed'));
        return;
      }
      if (qrInstance === inst.instance) {
        setQrInstance(null);
        setQr(null);
      }
      toast.success(t('toastReset'));
      loadInstances();
    } catch (err) {
      console.error('[evolution-config] disconnect failed:', err);
      toast.error(t('toastResetFailed'));
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        {/* Connected instances */}
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground">{t('instancesTitle')}</CardTitle>
            <CardDescription className="text-muted-foreground">
              {t('instancesDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {instances.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noInstances')}</p>
            ) : (
              instances.map((inst) => (
                <div
                  key={inst.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {inst.connected ? (
                      <CheckCircle2 className="size-4 shrink-0 text-primary" />
                    ) : (
                      <XCircle className="size-4 shrink-0 text-red-500" />
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {inst.label}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {inst.instance} ·{' '}
                        {inst.connected ? t('statusConnected') : t('statusDisconnected')}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {!inst.connected && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleConnect(inst)}
                        disabled={saving}
                        className="h-8 text-primary hover:bg-primary/10"
                      >
                        <QrCode className="size-4" />
                        {t('reconnect')}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDisconnect(inst)}
                      className="h-8 w-8 text-red-400 hover:bg-red-950/40 hover:text-red-300"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Add a new instance */}
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground">{t('addInstanceTitle')}</CardTitle>
            <CardDescription className="text-muted-foreground">
              {t('credentialsDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-muted-foreground">{t('instanceLabel')}</Label>
              <Input
                placeholder={t('instanceLabelPlaceholder')}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground">{t('baseUrl')}</Label>
              <Input
                placeholder="https://evo.tudominio.com"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">{t('baseUrlHint')}</p>
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground">{t('apiKey')}</Label>
              <div className="relative">
                <Input
                  type={showKey ? 'text' : 'password'}
                  placeholder={t('apiKeyPlaceholder')}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground">{t('instance')}</Label>
              <Input
                placeholder="mi-empresa-2"
                value={instance}
                onChange={(e) => setInstance(e.target.value)}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
              <p className="text-xs text-muted-foreground">{t('instanceHint')}</p>
            </div>
            <Button
              onClick={() => handleConnect()}
              disabled={saving}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('connecting')}
                </>
              ) : (
                <>
                  <Plus className="size-4" />
                  {t('addInstance')}
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* QR / status sidebar */}
      <div>
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground text-base">{t('qrTitle')}</CardTitle>
            <CardDescription className="text-muted-foreground">
              {qrInstance ? t('qrDescFor', { name: qrInstance }) : t('qrDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {qr ? (
              <div className="flex flex-col items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qr}
                  alt={t('qrAlt')}
                  className="size-56 rounded-lg bg-white p-2"
                />
                <ol className="list-decimal list-inside space-y-1 text-xs text-muted-foreground">
                  <li>{t('qrStep1')}</li>
                  <li>{t('qrStep2')}</li>
                  <li>{t('qrStep3')}</li>
                </ol>
                {pairingCode && (
                  <p className="text-xs text-muted-foreground">
                    {t('pairingCode')}{' '}
                    <code className="font-mono text-foreground">{pairingCode}</code>
                  </p>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => qrInstance && pollQr(qrInstance)}
                  className="border-border text-muted-foreground hover:text-foreground"
                >
                  <RefreshCw className="size-3.5" />
                  {t('refreshQr')}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <QrCode className="size-10 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">{t('qrEmpty')}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
