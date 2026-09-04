'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTranslations } from 'next-intl';

interface DeleteOwnerAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountName: string;
  memberCount: number;
  onDeleted: () => void;
}

export function DeleteOwnerAccountDialog({
  open,
  onOpenChange,
  accountName,
  memberCount,
  onDeleted,
}: DeleteOwnerAccountDialogProps) {
  const t = useTranslations('Settings.members');
  const [confirmName, setConfirmName] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const nameMatches = confirmName.trim() === accountName.trim();
  const canSubmit = nameMatches && password.length > 0 && !submitting;

  function reset() {
    setConfirmName('');
    setPassword('');
    setSubmitting(false);
  }

  async function handleDelete() {
    if (!nameMatches) {
      toast.error(t('deleteConfirmMismatch'));
      return;
    }
    if (!password) {
      toast.error(t('deletePasswordRequired'));
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmName: confirmName.trim(), password }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || t('deleteAccountFailed'));
        return;
      }
      toast.success(t('deleteAccountSuccess'));
      reset();
      onOpenChange(false);
      onDeleted();
    } catch (err) {
      console.error('[DeleteOwnerAccountDialog] delete error:', err);
      toast.error(t('deleteAccountFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="bg-popover border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-popover-foreground">
            <AlertTriangle className="size-4 text-red-400" />
            {t('deleteDialogTitle')}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t('deleteDialogDesc')}
          </DialogDescription>
        </DialogHeader>

        {memberCount > 1 ? (
          <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {t('deleteDialogMembersWarning', { count: memberCount })}
          </p>
        ) : null}

        <div className="space-y-4 py-1">
          <div className="space-y-2">
            <Label className="text-muted-foreground" htmlFor="delete-account-name">
              {t('deleteConfirmNameLabel')}
            </Label>
            <p className="text-xs font-medium text-foreground">{accountName}</p>
            <Input
              id="delete-account-name"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={t('deleteConfirmNamePlaceholder', { name: accountName })}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground" htmlFor="delete-account-password">
              {t('deletePasswordLabel')}
            </Label>
            <Input
              id="delete-account-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('deletePasswordPlaceholder')}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              autoComplete="current-password"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSubmit) void handleDelete();
              }}
            />
          </div>
        </div>

        <DialogFooter className="bg-popover border-border">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            {t('cancel')}
          </Button>
          <Button
            onClick={() => void handleDelete()}
            disabled={!canSubmit}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t('deletingAccount')}
              </>
            ) : (
              t('deleteAccountBtn')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
