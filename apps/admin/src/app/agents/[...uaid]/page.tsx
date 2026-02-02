import { notFound } from 'next/navigation';
import AgentDetailsPageLoader from '@/components/AgentDetailsPageLoader';

type DetailsPageParams = {
  params: Promise<{
    uaid: string[];
  }>;
};

export default async function AgentDetailsPage({ params }: DetailsPageParams) {
  const { uaid: uaidArray } = await params;

  // UAID is the canonical navigation identifier.
  const uaidRaw = Array.isArray(uaidArray) ? uaidArray.join('/') : uaidArray;
  const uaid = decodeURIComponent(String(uaidRaw ?? '').trim());
  if (!uaid || !uaid.startsWith('uaid:')) {
    notFound();
  }

  return <AgentDetailsPageLoader uaid={uaid} />;
}

