import type { Metadata } from 'next';
import { AutomationView } from '@/components/AutomationView';

export const metadata: Metadata = { title: 'Automation & alerts · ROYALWEB AUTOPILOT' };

export default function AutomationPage() {
  return <AutomationView />;
}
