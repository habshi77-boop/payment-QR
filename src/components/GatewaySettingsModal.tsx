import React, {useState} from 'react';
import {Bell, Check, ShieldCheck, Volume2, Webhook, X} from 'lucide-react';
import type {GatewayConfig} from '../types/payment';
import {requestNotificationPermission} from '../utils/soundbox';

interface GatewaySettingsModalProps {
  isOpen: boolean;
  config: GatewayConfig;
  notificationPermission: NotificationPermission;
  onNotificationPermissionChange: (perm: NotificationPermission) => void;
  onClose: () => void;
  onSaveConfig: (next: GatewayConfig) => Promise<void>;
  onTriggerTestWebhook: () => Promise<void>;
}

export const GatewaySettingsModal: React.FC<GatewaySettingsModalProps> = ({
  isOpen,
  config,
  notificationPermission,
  onNotificationPermissionChange,
  onClose,
  onSaveConfig,
  onTriggerTestWebhook,
}) => {
  const [draft, setDraft] = useState<GatewayConfig>(config);
  const [saving, setSaving] = useState(false);
  const [webhookStatus, setWebhookStatus] = useState('');

  React.useEffect(() => {
    setDraft(config);
  }, [config, isOpen]);

  if (!isOpen) return null;

  const webhookEndpoint =
    typeof window !== 'undefined' ? `${window.location.origin}/api/payments/webhook` : '/api/payments/webhook';

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSaveConfig(draft);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleEnableNotifications = async () => {
    const perm = await requestNotificationPermission();
    onNotificationPermissionChange(perm);
  };

  const handleWebhookTest = async () => {
    setWebhookStatus('Dispatching gateway webhook…');
    try {
      await onTriggerTestWebhook();
      setWebhookStatus('Webhook captured!');
      onClose();
    } catch {
      setWebhookStatus('Webhook test failed');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Payment Gateway Settings"
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/65 p-0 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white shadow-[0_24px_60px_-12px_rgba(15,23,42,0.35)] sm:rounded-3xl">
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-slate-200 sm:hidden" aria-hidden="true" />
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-50 text-[#00A859]">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-bold tracking-tight text-slate-900">Payment Gateway &amp; Soundbox</h2>
              <p className="text-xs text-slate-500">Configure merchant VPA, gateway provider &amp; alerts</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close gateway settings"
            className="flex h-11 w-11 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-5 p-5">
          {/* Active UPI Gateway */}
          <div className="flex items-center justify-between rounded-2xl bg-emerald-50/80 px-4 py-3">
            <div>
              <span className="block text-xs font-semibold text-emerald-800">Active Payment Gateway</span>
              <span className="mt-0.5 block text-sm font-bold text-slate-900">UPI Gateway</span>
            </div>
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#00A859]">
              <Check className="h-4 w-4" />
              UPI Only
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="gw-merchant-name" className="block text-xs font-semibold text-slate-600">
                Merchant Business Name
              </label>
              <input
                id="gw-merchant-name"
                type="text"
                value={draft.merchantName}
                onChange={(e) => setDraft({...draft, merchantName: e.target.value})}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-sm text-slate-900 outline-none transition-all focus:border-[#00A859] focus:bg-white focus:ring-4 focus:ring-emerald-500/10"
              />
            </div>
            <div>
              <label htmlFor="gw-vpa" className="block text-xs font-semibold text-slate-600">
                Merchant UPI VPA
              </label>
              <input
                id="gw-vpa"
                type="text"
                value={draft.merchantVpa}
                onChange={(e) => setDraft({...draft, merchantVpa: e.target.value})}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 font-mono text-sm text-slate-900 outline-none transition-all focus:border-[#00A859] focus:bg-white focus:ring-4 focus:ring-emerald-500/10"
              />
            </div>
          </div>

          <div>
            <label htmlFor="gw-key-id" className="block text-xs font-semibold text-slate-600">
              Gateway Key / Merchant ID
            </label>
            <input
              id="gw-key-id"
              type="text"
              value={draft.keyId}
              onChange={(e) => setDraft({...draft, keyId: e.target.value})}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 font-mono text-sm text-slate-900 outline-none transition-all focus:border-[#00A859] focus:bg-white focus:ring-4 focus:ring-emerald-500/10"
            />
          </div>

          {/* Soundbox & Vibration Controls */}
          <div className="space-y-3 border-t border-slate-100 pt-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Volume2 className="h-4 w-4 text-[#00A859]" />
                <div>
                  <div className="text-sm font-semibold text-slate-900">Loud Soundbox Voice</div>
                  <div className="text-xs text-slate-500">Chime + voice announcement on confirmation</div>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={draft.soundboxEnabled}
                onClick={() => setDraft({...draft, soundboxEnabled: !draft.soundboxEnabled})}
                className={`relative h-7 w-12 rounded-full transition-colors ${
                  draft.soundboxEnabled ? 'bg-[#00A859]' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`block h-5 w-5 rounded-full bg-white shadow-xs transition-transform ${
                    draft.soundboxEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">Speaker-Synced Vibration</div>
                <div className="text-xs text-slate-500">Haptic pulse synced to soundbox output</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={draft.vibrationEnabled}
                onClick={() => setDraft({...draft, vibrationEnabled: !draft.vibrationEnabled})}
                className={`relative h-7 w-12 rounded-full transition-colors ${
                  draft.vibrationEnabled ? 'bg-[#00A859]' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`block h-5 w-5 rounded-full bg-white shadow-xs transition-transform ${
                    draft.vibrationEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">Voice Language</div>
                <div className="text-xs text-slate-500">Soundbox spoken announcement language</div>
              </div>
              <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => setDraft({...draft, voiceLanguage: 'en-IN'})}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                    draft.voiceLanguage === 'en-IN' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  English
                </button>
                <button
                  type="button"
                  onClick={() => setDraft({...draft, voiceLanguage: 'hi-IN'})}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                    draft.voiceLanguage === 'hi-IN' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  Hindi
                </button>
              </div>
            </div>
          </div>

          {/* Background Notification & Webhook Test */}
          <div className="space-y-3 border-t border-slate-100 pt-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Bell className="h-4 w-4 text-[#00A859]" />
                <div>
                  <div className="text-sm font-semibold text-slate-900">Background OS Notifications</div>
                  <div className="text-xs text-slate-500">
                    Status: {notificationPermission === 'granted' ? 'Enabled' : notificationPermission}
                  </div>
                </div>
              </div>
              {notificationPermission !== 'granted' ? (
                <button
                  type="button"
                  onClick={handleEnableNotifications}
                  className="min-h-[38px] rounded-xl bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                >
                  Enable Alerts
                </button>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                  <Check className="h-3.5 w-3.5" />
                  Active
                </span>
              )}
            </div>

            <div className="rounded-2xl bg-slate-50/90 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                  <Webhook className="h-3.5 w-3.5 text-[#00A859]" />
                  Gateway Webhook Endpoint
                </span>
                <button
                  type="button"
                  onClick={handleWebhookTest}
                  className="rounded-lg bg-[#00A859] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#00944E]"
                >
                  Test Webhook
                </button>
              </div>
              <p className="mt-1.5 truncate font-mono text-[11px] text-slate-500">{webhookEndpoint}</p>
              {webhookStatus && <p className="mt-1 text-xs font-medium text-emerald-700">{webhookStatus}</p>}
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="flex min-h-[48px] w-full items-center justify-center rounded-2xl bg-gradient-to-b from-[#06B863] to-[#00A859] px-4 py-3 text-sm font-bold text-white shadow-[0_8px_20px_-4px_rgba(0,168,89,0.45)] transition-all hover:brightness-105 active:scale-[0.98] disabled:opacity-60"
          >
            {saving ? 'Saving Gateway Settings…' : 'Save Gateway Configuration'}
          </button>
        </form>
      </div>
    </div>
  );
};
