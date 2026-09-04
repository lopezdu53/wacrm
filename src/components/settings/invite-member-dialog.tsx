'use client';

// ============================================================
// InviteMemberDialog — now a direct "add member" form.
//
// Admin creates the login (name, email, password, role). The API
// marks the email confirmed so the teammate can sign in immediately
// — no invite URL, no email verification wait.
// ============================================================

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTranslations } from 'next-intl';

type InviteRole = 'admin' | 'agent' | 'viewer';

interface InviteMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful create so the parent re-fetches the roster. */
  onCreated: () => void;
}

export function InviteMemberDialog({
  open,
  onOpenChange,
  onCreated,
}: InviteMemberDialogProps) {
  const t = useTranslations('Settings.invite');
  const tRoles = useTranslations('Settings.roles');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState<InviteRole>('agent');
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setFullName('');
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setRole('agent');
    setSubmitting(false);
  }

  async function handleCreate() {
    const name = fullName.trim();
    if (!name) {
      toast.error(t('nameRequired'));
      return;
    }
    if (password.length < 6) {
      toast.error(t('passwordTooShort'));
      return;
    }
    if (password !== confirmPassword) {
      toast.error(t('passwordMismatch'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/account/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: name,
          email: email.trim(),
          password,
          role,
        }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || t('createFailed'));
        return;
      }

      toast.success(t('createdToast', { name, role: tRoles(role) }));
      reset();
      onCreated();
      onOpenChange(false);
    } catch (err) {
      console.error('[InviteMemberDialog] create error:', err);
      toast.error(t('createFailed'));
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
          <DialogTitle className="text-popover-foreground">
            {t('dialogTitle')}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t('dialogDesc')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-muted-foreground">{t('nameLabel')}</Label>
            <Input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder={t('namePlaceholder')}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">{t('emailLabel')}</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('emailPlaceholder')}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">{t('passwordLabel')}</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('passwordPlaceholder')}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              autoComplete="new-password"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">
              {t('confirmPasswordLabel')}
            </Label>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t('confirmPasswordPlaceholder')}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              autoComplete="new-password"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">{t('roleLabel')}</Label>
            <Select
              value={role}
              onValueChange={(v) => v && setRole(v as InviteRole)}
            >
              <SelectTrigger className="w-full bg-muted border-border text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">{tRoles('admin')}</SelectItem>
                <SelectItem value="agent">{tRoles('agent')}</SelectItem>
                <SelectItem value="viewer">{tRoles('viewer')}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {tRoles(`${role}Hint` as 'adminHint' | 'agentHint' | 'viewerHint')}
            </p>
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
            onClick={handleCreate}
            disabled={submitting}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t('creating')}
              </>
            ) : (
              t('addMember')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
