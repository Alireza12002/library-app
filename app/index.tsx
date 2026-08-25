import { Redirect } from 'expo-router';

/**
 * Entry route: the library is the home screen.
 */
export default function Index() {
  return <Redirect href="/(library)" />;
}
