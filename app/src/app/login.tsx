import LoginScreen from '../screens/LoginScreen';
import { useSession } from '../session';

export default function LoginRoute() {
  const { signIn } = useSession();
  return <LoginScreen onLogin={signIn} />;
}
