import {Navigate, useLocation, useNavigate, useParams} from 'react-router-dom';
import {useWhatsApp} from '../WhatsAppProvider';
import {StatusPage} from './StatusPage';
import {Thread} from './Thread';

export {photoPath} from './Thread';

export function ThreadPage() {
  const {jid} = useParams();
  const {phase} = useWhatsApp();
  const location = useLocation();
  const navigate = useNavigate();

  if (!jid) {
    return <Navigate to="/" replace />;
  }
  if (phase.kind !== 'ready') {
    return <StatusPage phase={phase} />;
  }
  const composerOpen =
    location.state != null &&
    typeof location.state === 'object' &&
    'replyComposer' in location.state &&
    location.state.replyComposer === true;
  return <Thread jid={jid} pathname={location.pathname} locationKey={location.key} composerOpen={composerOpen} navigate={navigate} />;
}
