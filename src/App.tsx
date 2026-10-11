import {App} from '@wearables-ui-toolkit/mrbd';
import {
  ReactRouterNavigationProvider,
  ReactRouterPageTransition,
} from '@wearables-ui-toolkit/mrbd/react-router';
import {BrowserRouter, Navigate, Route, Routes, useLocation} from 'react-router-dom';
import {ChatList, ChatListRoute, transitionKey} from './pages/ChatListPage';
import {PhotoPage} from './pages/PhotoPage';
import {RecordPage} from './pages/RecordPage';
import {SearchPage, SEARCH_PATH} from './pages/SearchPage';
import {ThreadPage} from './pages/ThreadPage';
import {TranscriptPage} from './pages/TranscriptPage';

// Back (Escape) is handled by ReactRouterNavigationProvider: from a photo it
// returns to the conversation, in a thread to the list; on the list, with no history left, it is not consumed,
// so the platform closes the app.
export default function WhatsAppApp() {
  return (
    <BrowserRouter>
      <ReactRouterNavigationProvider>
        <Screens />
      </ReactRouterNavigationProvider>
    </BrowserRouter>
  );
}

// The chat list is not a route page: it stays mounted with the routes, on top
// of them on `/` and under them (they are opaque) elsewhere (see ChatList), so
// Back to it draws it at once, with nothing to build again. The conversation
// leaves under it; its focus and scroll are not kept for later, which spares
// that work on the way back (each opening of a conversation is a page of its
// own, see transitionKey).
function Screens() {
  const {pathname} = useLocation();
  return (
    <App>
      <ReactRouterPageTransition
        className="route-viewport"
        getTransitionKey={transitionKey}
        preservePageState={pathname !== '/'}>
        {({location}) => (
          <Routes location={location}>
            <Route path="/" element={<ChatListRoute />} />
            <Route path={SEARCH_PATH} element={<SearchPage />} />
            <Route path="/chat/:jid" element={<ThreadPage />} />
            <Route path="/chat/:jid/photo/:messageId" element={<PhotoPage />} />
            <Route path="/chat/:jid/record" element={<RecordPage />} />
            <Route path="/chat/:jid/transcript/:messageId" element={<TranscriptPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </ReactRouterPageTransition>
      <ChatList />
    </App>
  );
}
