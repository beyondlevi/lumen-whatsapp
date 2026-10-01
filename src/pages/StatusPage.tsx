import {
  Button,
  ButtonRail,
  Page,
  ScrollView,
  TextColor,
  TextStyle,
  TextView,
} from '@wearables-ui-toolkit/mrbd';
import type {ConfigField} from '../config/lumenConfig';
import type {EvolutionError} from '../evolution/client';
import {locale, t, type StringKey} from '../i18n/strings';
import {useWhatsApp, type Phase} from '../WhatsAppProvider';

const FIELD_LABELS: Record<ConfigField, StringKey> = {
  url: 'fieldUrl',
  instance: 'fieldInstance',
  apiKey: 'fieldApiKey',
};

const listFormat = () => new Intl.ListFormat(locale, {type: 'conjunction'});

function SetupPage({missing}: {missing: ConfigField[]}) {
  const {reloadConfig} = useWhatsApp();
  return (
    <Page headerText={t('setupHeader')} enableSystemBarInset={false}>
      <div className="action-page-shell">
        <ScrollView insetForHeader tabIndex={0} ariaLabel={t('setupLabel')}>
          <div className="content-inset">
            <TextView as="p" textStyle={TextStyle.BODY2_EMPHASIZED}>
              {t('setupTitle')}
            </TextView>
            <TextView as="p" textStyle={TextStyle.BODY2}>
              {t('setupBody')}
            </TextView>
            <TextView as="p" textStyle={TextStyle.LABEL} textColor={TextColor.SECONDARY}>
              {t('setupMissingLabel')}
            </TextView>
            <TextView as="p" textStyle={TextStyle.META1}>
              {listFormat().format(missing.map(field => t(FIELD_LABELS[field])))}
            </TextView>
          </div>
        </ScrollView>
        <div className="action-dock">
          <ButtonRail>
            <Button title={t('setupCheckAgain')} onClick={reloadConfig} />
          </ButtonRail>
        </div>
      </div>
    </Page>
  );
}

function ConnectingPage() {
  return (
    <Page headerText={t('loadingHeader')} headerIsLoading enableSystemBarInset={false}>
      <ScrollView insetForHeader ariaLabel={t('connectingLabel')}>
        <div className="content-inset" role="status" aria-label={t('connectingLabel')} />
      </ScrollView>
    </Page>
  );
}

function errorCopy(error: EvolutionError | null, instance: string | null): [string, string] {
  switch (error?.kind) {
    case undefined:
      return [t('errConfigTitle'), t('errConfigBody')];
    case 'network':
      return [t('errNetworkTitle'), t('errNetworkBody')];
    case 'auth':
      return [t('errAuthTitle'), t('errAuthBody')];
    case 'instance':
      return [t('errInstanceTitle'), t('errInstanceBody', {instance: instance ?? ''})];
    default:
      return [t('errServerTitle'), t('errServerBody')];
  }
}

function ErrorPage({error}: {error: EvolutionError | null}) {
  const {instance, retry} = useWhatsApp();
  const [title, body] = errorCopy(error, instance);
  return (
    <Page headerText={t('errorHeader')} enableSystemBarInset={false}>
      <div className="action-page-shell">
        <ScrollView insetForHeader tabIndex={0} ariaLabel={t('errorLabel')}>
          <div className="content-inset" role="alert">
            <TextView as="p" textStyle={TextStyle.BODY2_EMPHASIZED}>
              {title}
            </TextView>
            <TextView as="p" textStyle={TextStyle.BODY2}>
              {body}
            </TextView>
            {error?.status != null ? (
              <>
                <TextView as="p" textStyle={TextStyle.LABEL} textColor={TextColor.SECONDARY}>
                  {t('errorDetailLabel')}
                </TextView>
                <TextView as="p" textStyle={TextStyle.META1}>
                  {t('httpStatus', {status: error.status})}
                </TextView>
              </>
            ) : null}
          </div>
        </ScrollView>
        {error != null ? (
          <div className="action-dock">
            <ButtonRail>
              <Button title={t('retry')} onClick={retry} />
            </ButtonRail>
          </div>
        ) : null}
      </div>
    </Page>
  );
}

/** Full-screen state shown instead of the chat routes until the connection is ready. */
export function StatusPage({phase}: {phase: Exclude<Phase, {kind: 'ready'}>}) {
  switch (phase.kind) {
    case 'setup':
      return <SetupPage missing={phase.missing} />;
    case 'connecting':
      return <ConnectingPage />;
    case 'invalid-config':
      return <ErrorPage error={null} />;
    case 'error':
      return <ErrorPage error={phase.error} />;
  }
}
