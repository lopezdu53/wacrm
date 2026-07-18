'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  Loader2,
  RotateCcw,
  QrCode,
  RefreshCw,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

const MASKED = '••••••••••••••••';

type EvoState = 'open' | 'connecting' | 'close' | 'unknown';

/**
 * Settings panel for the Evolution API transport (the QR-based WhatsApp
 * connection, see migration 037). Self-contained: it talks only to
 * `/api/whatsapp/evolution` (POST connect, GET poll, DELETE reset) plus a
 * direct read of the config row for the non-secret fields (base URL +
 * instance) so returning users see what's saved.
 */
export function EvolutionConfig() {
  const t = useTranslations('Settings.whatsapp.evolution');
  const supabase = createClient();
  const { accountId, loading: authLoading, profileLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [instance, setInstance] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const [hasConfig, setHasConfig] = useState(false);

  const [state, setState] = useState<EvoState>('unknown');
  const [qr, setQr] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);

  const loadedRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const connected = state === 'open';

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/evolution', { method: 'GET' });
      const data = await res.json();
      if (data.reason === 'no_config') {
        setState('unknown');
        setQr(null);
        return;
      }
      setState((data.state as EvoState) ?? (data.connected ? 'open' : 'unknown'));
      setQr(data.qr ?? null);
      setPairingCode(data.pairingCode ?? null);
    } catch (err) {
      console.error('[evolution-config] refreshStatus failed:', err);
    }
  }, []);

  const loadRow = useCallback(
    async (acct: string) => {
      setLoading(true);
      try {
        const { data } = await supabase
          .from('whatsapp_config')
          .select('provider, evolution_base_url, evolution_instance')
          .eq('account_id', acct)
          .maybeSingle();

        if (data && data.provider === 'evolution') {
          setHasConfig(true);
          setBaseUrl(data.evolution_base_url || '');
          setInstance(data.evolution_instance || '');
          setApiKey(MASKED);
          setKeyEdited(false);
          await refreshStatus();
        } else {
          setHasConfig(false);
          setBaseUrl('');
          setInstance('');
          setApiKey('');
          setKeyEdited(false);
          setState('unknown');
          setQr(null);
        }
      } finally {
        setLoading(false);
      }
    },
    [supabase, refreshStatus],
  );

  useEffect(() => {
    if (authLoading || profileLoading) return;
    if (!accountId) {
      setLoading(false);
      return;
    }
    if (loadedRef.current === accountId) return;
    loadedRef.current = accountId;
    loadRow(accountId);
  }, [authLoading, profileLoading, accountId, loadRow]);

  // Poll while we have a QR up / are connecting, until the phone links.
  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (hasConfig && state !== 'open') {
      pollRef.current = setInterval(refreshStatus, 3000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [hasConfig, state, refreshStatus]);

  // Toast once when the connection flips to open.
  const prevStateRef = useRef<EvoState>('unknown');
  useEffect(() => {
    if (state === 'open' && prevStateRef.current !== 'open') {
      setQr(null);
      toast.success(t('toastConnected'));
    }
    prevStateRef.current = state;
  }, [state, t]);

  async function handleConnect() {
    if (!baseUrl.trim() || !instance.trim()) {
      toast.error(t('errorRequired'));
      return;
    }
    if (!hasConfig && (!apiKey.trim() || !keyEdited)) {
      toast.error(t('errorApiKeyRequired'));
      return;
    }
    if (hasConfig && !keyEdited) {
      toast.error(t('errorReenterKey'));
      return;
    }

    try {
      setSaving(true);
      const res = await fetch('/api/whatsapp/evolution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base_url: baseUrl.trim(),
          api_key: apiKey.trim(),
          instance: instance.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('toastConnectFailed'));
        return;
      }
      setHasConfig(true);
      setApiKey(MASKED);
      setKeyEdited(false);
      setState((data.state as EvoState) ?? 'connecting');
      setQr(data.qr ?? null);
      setPairingCode(data.pairingCode ?? null);
      if (data.qr) {
        toast.success(t('toastScanQr'));
      } else if (data.state === 'open') {
        toast.success(t('toastConnected'));
      } else {
        toast.success(t('toastSaved'));
      }
    } catch (err) {
      console.error('[evolution-config] connect failed:', err);
      toast.error(t('toastConnectFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!confirm(t('resetConfirm'))) return;
    try {
      setResetting(true);
      const res = await fetch('/api/whatsapp/evolution', { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || t('toastResetFailed'));
        return;
      }
      setHasConfig(false);
      setBaseUrl('');
      setApiKey('');
      setInstance('');
      setKeyEdited(false);
      setState('unknown');
      setQr(null);
      setPairingCode(null);
      toast.success(t('toastReset'));
    } catch (err) {
      console.error('[evolution-config] reset failed:', err);
      toast.error(t('toastResetFailed'));
    } finally {
      setResetting(false);
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
      {/* Credentials + connect */}
      <div className="space-y-6">
        {/* Connection status */}
        <Alert className="bg-card border-border">
          <div className="flex items-center gap-2">
            {connected ? (
              <CheckCircle2 className="size-4 text-primary" />
            ) : (
              <XCircle className="size-4 text-red-500" />
            )}
            <AlertTitle className="text-foreground mb-0">
              {connected
                ? t('statusConnected')
                : state === 'connecting'
                  ? t('statusConnecting')
                  : t('statusDisconnected')}
            </AlertTitle>
          </div>
          <AlertDescription className="text-muted-foreground">
            {connected ? t('statusConnectedDesc') : t('statusDisconnectedDesc')}
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle className="text-foreground">{t('credentialsTitle')}</CardTitle>
            <CardDescription className="text-muted-foreground">
              {t('credentialsDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setKeyEdited(true);
                  }}
                  onFocus={() => {
                    if (apiKey === MASKED) {
                      setApiKey('');
                      setKeyEdited(true);
                    }
                  }}
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
              {hasConfig && !keyEdited && (
                <p className="text-xs text-muted-foreground">{t('apiKeyHidden')}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground">{t('instance')}</Label>
              <Input
                placeholder="mi-empresa"
                value={instance}
                onChange={(e) => setInstance(e.target.value)}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
              <p className="text-xs text-muted-foreground">{t('instanceHint')}</p>
            </div>

            <div className="flex flex-wrap gap-3 pt-1">
              <Button
                onClick={handleConnect}
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
                    <QrCode className="size-4" />
                    {hasConfig ? t('reconnect') : t('connect')}
                  </>
                )}
              </Button>
              {hasConfig && (
                <Button
                  variant="outline"
                  onClick={handleReset}
                  disabled={resetting}
                  className="border-red-900 text-red-400 hover:text-red-300 hover:bg-red-950/40"
                >
                  {resetting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RotateCcw className="size-4" />
                  )}
                  {t('reset')}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* QR / status sidebar */}
      <div>
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground text-base">{t('qrTitle')}</CardTitle>
            <CardDescription className="text-muted-foreground">
              {t('qrDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {connected ? (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <CheckCircle2 className="size-12 text-primary" />
                <p className="text-sm text-foreground font-medium">{t('linkedTitle')}</p>
                <p className="text-xs text-muted-foreground">{t('linkedDesc')}</p>
              </div>
            ) : qr ? (
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
                  onClick={refreshStatus}
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
