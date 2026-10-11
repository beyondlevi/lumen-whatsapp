import {useRef} from 'react';
import {
  Navigate,
  useLocation,
  useNavigate,
  useParams,
  type Location,
  type NavigateFunction,
} from 'react-router-dom';
import {KeptPage} from '../components/KeptPage';
import {PhotoInput} from '../photo/PhotoInput';
import {usePhotoFlow} from '../photo/usePhotoFlow';
import {chatDisplayName} from '../format';
import {useWhatsApp} from '../WhatsAppProvider';
import {PhotoSend} from './PhotoSendPage';
import {StatusPage} from './StatusPage';
import {Thread, type ThreadProps} from './Thread';

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
  return <Conversation jid={jid} location={location} navigate={navigate} />;
}

/** The conversation, and the photo just taken drawn over it (see usePhotoFlow). */
function Conversation({jid, location, navigate}: {jid: string; location: Location; navigate: NavigateFunction}) {
  const {sendPhoto, chatFor, contactName} = useWhatsApp();
  const photos = usePhotoFlow({jid, pathname: location.pathname, state: location.state, navigate, sendPhoto});
  const composerOpen =
    location.state != null &&
    typeof location.state === 'object' &&
    'replyComposer' in location.state &&
    location.state.replyComposer === true;
  const threadProps: ThreadProps = {
    jid,
    pathname: location.pathname,
    locationKey: location.key,
    composerOpen,
    navigate,
    onTakePhoto: photos.take,
    photoButtonRef: photos.photoButtonRef,
  };
  // Under the photo the conversation keeps its props, so Back draws nothing again.
  const kept = useRef(threadProps);
  if (!photos.open) {
    kept.current = threadProps;
  }
  return (
    <>
      <KeptPage shown={!photos.open} onLive={photos.conversationLive}>
        <Thread {...kept.current} />
      </KeptPage>
      {photos.photo != null ? (
        <PhotoSend
          key={photos.session}
          shown={photos.open}
          photo={photos.photo}
          name={chatDisplayName(jid, chatFor(jid)?.name ?? contactName(jid))}
          onSend={photos.send}
          onRetake={photos.retake}
          onCancel={photos.cancel}
        />
      ) : null}
      <PhotoInput ref={photos.inputRef} onPhoto={photos.photoTaken} />
      <div ref={photos.focusParkRef} className="focus-park" tabIndex={-1} aria-hidden="true" />
    </>
  );
}
