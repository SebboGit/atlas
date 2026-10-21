import { NotificationSettingsForm } from '@/components/features/settings/notification-settings-form';
import { SectionEyebrow } from '@/components/section-eyebrow';
import { Card, CardContent } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/session';
import { deploymentTopic, notificationsConfigured } from '@/lib/notifications';
import { getNotificationSettings } from '@/lib/notifications/repo';

export const metadata = {
  title: 'Settings · Atlas',
};

export default async function SettingsPage() {
  const user = await requireUser();
  const configured = notificationsConfigured();
  const settings = configured ? await getNotificationSettings(user.id) : null;
  const defaultTopic = deploymentTopic();

  return (
    <main className="mx-auto w-full max-w-6xl px-6 pt-8 pb-24 sm:px-8 sm:pt-20">
      <header className="atlas-rise mb-8" style={{ animationDelay: '20ms' }}>
        <SectionEyebrow>Section 05 · Settings</SectionEyebrow>
        <h1 className="heading-page">Settings.</h1>
      </header>

      <div className="atlas-rule-double mb-10" aria-hidden />

      {/* Label column beside the card on laptop; stacked on phone. */}
      <section
        aria-labelledby="settings-notifications"
        className="atlas-rise grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-10"
        style={{ animationDelay: '120ms' }}
      >
        <div>
          <h2
            id="settings-notifications"
            className="font-display text-foreground text-2xl font-medium tracking-tight"
          >
            Notifications
          </h2>
          <p className="text-muted-foreground mt-2 text-sm">Pushed through ntfy.</p>
        </div>

        <Card variant="paper">
          <CardContent className="p-5 sm:p-6">
            {configured && settings ? (
              <NotificationSettingsForm
                initial={{
                  enabled: settings.enabled,
                  topic: settings.topic ?? '',
                  prefs: settings.prefs,
                }}
                defaultTopic={defaultTopic}
              />
            ) : (
              <p className="text-muted-foreground text-sm">
                No ntfy server configured. Set <code className="font-mono">NTFY_URL</code> on the
                server to turn this on.
              </p>
            )}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
