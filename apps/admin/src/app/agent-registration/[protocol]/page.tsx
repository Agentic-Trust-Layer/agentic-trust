import ProtocolRegistrationPage from '@/components/ProtocolRegistrationPage';

type PageProps = {
  params: Promise<{ protocol: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AgentProtocolRegistrationPage({ params, searchParams }: PageProps) {
  const { protocol } = await params;
  const sp = await searchParams;
  const uaidRaw = sp.uaid;
  const uaid = Array.isArray(uaidRaw) ? String(uaidRaw[0] ?? '') : String(uaidRaw ?? '');
  return <ProtocolRegistrationPage protocol={protocol} uaid={uaid} />;
}

