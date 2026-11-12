import { notFound } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { get } from '@/lib/db';
import { CampaignDetail } from '@/components/CampaignDetail';

export const dynamic = 'force-dynamic';

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return null;
  const { id } = await params;
  const campaign = get<{ id: string; name: string }>(
    'SELECT id, name FROM campaigns WHERE id = ? AND user_id = ?',
    id,
    session.user.id
  );
  if (!campaign) notFound();
  return <CampaignDetail campaignId={id} />;
}
