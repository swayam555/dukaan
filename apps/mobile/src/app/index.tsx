import { Redirect } from 'expo-router';
import { useSession } from '@/state/session';

export default function Index() {
  const status = useSession((s) => s.status);
  if (status === 'needs-setup') return <Redirect href="/setup" />;
  if (status === 'locked') return <Redirect href="/lock" />;
  return <Redirect href="/billing" />;
}
