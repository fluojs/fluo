import { SONGS } from '../../../../fixture/domain.mjs';
import JukeboxShell from './shell';

export default function Layout({ children }) {
  return <JukeboxShell songs={SONGS}>{children}</JukeboxShell>;
}
