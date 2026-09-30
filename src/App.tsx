import {App} from '@wearables-ui-toolkit/mrbd';
import {
  ReactRouterNavigationProvider,
  ReactRouterPageTransition,
} from '@wearables-ui-toolkit/mrbd/react-router';
import {BrowserRouter, Navigate, Route, Routes} from 'react-router-dom';
import {ChatListPage} from './pages/ChatListPage';
import {ThreadPage} from './pages/ThreadPage';

// Back (Escape) is handled by ReactRouterNavigationProvider: in a thread it
// returns to the list; on the list, with no history left, it is not consumed,
// so the platform closes the app.
export default function WhatsAppApp() {
  return (
    <BrowserRouter>
      <ReactRouterNavigationProvider>
        <App>
          <ReactRouterPageTransition>
            {({location}) => (
              <Routes location={location}>
                <Route path="/" element={<ChatListPage />} />
                <Route path="/chat/:jid" element={<ThreadPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            )}
          </ReactRouterPageTransition>
        </App>
      </ReactRouterNavigationProvider>
    </BrowserRouter>
  );
}
