import { getSession } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { CampaignWizard } from '@/components/CampaignWizard';
import { PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function NewCampaignPage() {
  const session = await getSession();
  if (!session) return null;
  const settings = getSettings(session.user.id);

  return (
    <div>
      <PageHeader
        eyebrow="Campaign"
        title="Create a campaign"
        description="Upload the poster, add the offer details, choose platforms and let the AI prepare each version. Nothing is published until you approve it."
      />
      <CampaignWizard
        defaults={{
          websiteUrl: settings.websiteUrl,
          whatsappUrl: settings.publicContactVisible ? settings.whatsappUrl : '',
          cta: settings.ctaPrimary,
          language: settings.defaultLanguage,
          timezone: settings.defaultTimezone,
          priceMin: settings.priceMin,
          priceMax: settings.priceMax,
          services: settings.services,
          targetCustomers: settings.targetCustomers,
          publicContactVisible: settings.publicContactVisible,
        }}
      />
    </div>
  );
}
