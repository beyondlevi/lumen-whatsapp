// Every user-facing string lives in this file. English is the default;
// Portuguese (pt-BR copy) is chosen for any `pt-*` browser language.

const en = {
  appName: 'WhatsApp',
  chatsHeader: 'Chats',
  offlineMeta: 'Offline',
  chatListLabel: 'WhatsApp chats',
  emptyTitle: 'No chats yet',
  emptyBody: 'New WhatsApp conversations will appear here.',
  emptyLabel: 'No chats',

  setupHeader: 'Setup',
  setupTitle: 'Connect WhatsApp',
  setupBody:
    'Open the Lumen app on your phone and fill in the Evolution server URL, the instance, and the API key for this app.',
  setupMissingLabel: 'MISSING',
  setupLabel: 'Setup required',
  setupCheckAgain: 'Check again',
  setupStillMissing: 'Still not configured',
  fieldUrl: 'Server URL',
  fieldInstance: 'Instance',
  fieldApiKey: 'API key',

  loadingHeader: 'Loading…',
  connectingLabel: 'Connecting',

  errorHeader: 'Connection',
  errorLabel: 'Connection error',
  errorDetailLabel: 'DETAIL',
  retry: 'Try again',
  errNetworkTitle: "Can't reach the server",
  errNetworkBody:
    'Check the internet connection and the server URL. The Evolution server must also allow this app in CORS_ORIGIN.',
  errAuthTitle: 'API key rejected',
  errAuthBody:
    'The server refused the API key. Update it in the Lumen app on your phone.',
  errInstanceTitle: 'Instance not found',
  errInstanceBody:
    'The server has no instance named “{instance}”. Check the instance name and the server URL in the Lumen app on your phone.',
  errServerTitle: 'Server error',
  errServerBody: 'The Evolution server could not answer. Try again in a moment.',
  errConfigTitle: 'Invalid server URL',
  errConfigBody:
    'The server URL must start with http:// or https://. Fix it in the Lumen app on your phone.',
  httpStatus: 'HTTP {status}',

  threadLabel: 'Conversation with {name}',
  threadEmptyTitle: 'No recent messages',
  threadEmptyBody: 'Messages in this chat will appear here.',
  threadStatusLabel: 'Messages',
  replyHint: 'Reply',
  quoteHint: 'Reply to “{text}”',
  messageActionsLabel: 'Actions for message: {message}',
  replyAction: 'Reply',
  voiceAction: 'Voice',
  photosAction: 'Photos',
  viewAction: 'View',
  reactWith: 'React with {emoji}',
  reactionSent: 'Reacted {emoji}',
  reactionFailed: 'Reaction not sent: {reason}',
  replyFieldLabel: 'Reply to {name}',
  sendLabel: 'Send',
  sendingLabel: 'Sending',
  messageSent: 'Message sent',
  sendFailed: 'Not sent: {reason}',
  connectionLost: 'Connection lost. Retrying…',

  reasonNetwork: 'no connection',
  reasonAuth: 'API key rejected',
  reasonInstance: 'instance not found',
  reasonServer: 'server error',
  reasonRejected: 'rejected by the server',

  you: 'You',
  yesterday: 'Yesterday',
  unknownContact: 'Unknown contact',
  bubbleLabel: '{sender}: {text}, {time}',
  senderPrefix: '{sender}: {text}',
  markerWithCaption: '{marker}: {caption}',
  markerPhoto: 'Photo',
  markerVideo: 'Video',
  markerAudio: 'Audio',
  markerSticker: 'Sticker',
  markerDocument: 'Document',
  markerLocation: 'Location',
  markerContact: 'Contact',
  markerPoll: 'Poll',
  markerReaction: 'Reaction {emoji}',
  youReacted: 'You reacted {emoji}',
  reacted: 'Reacted {emoji}',
  reactedTo: 'Reacted {emoji} to “{text}”',
  reactionsLabel: 'reactions {list}',

  photoHeader: 'Photo',
  photoLabel: 'Photo from {name}',
  photoLoading: 'Loading photo',
  photoFailedTitle: "Couldn't load the photo",
  photoFailedBody: 'The server could not send this photo ({reason}).',

  audioLabel: 'Voice message, {duration}',
  audioPlaying: 'Playing, {position} of {duration}',
  audioPaused: 'Paused, {position} of {duration}',
  audioLoading: 'Loading audio',
  audioFailed: "Couldn't play the audio: {reason}",
  listenAction: 'Listen',
  pauseAction: 'Pause',
  transcribeAction: 'Transcribe',
  transcribeUnavailable: 'Transcribe (not available on this device)',

  recordingHeader: 'Recording',
  recordingLabel: 'Voice message recording',
  recordingStarting: 'Starting…',
  recordingNow: 'Recording',
  recordingLimit: 'Reached the {limit} limit',
  recordingLevel: 'Microphone level',
  recordingFinishing: 'Finishing…',
  recordingSending: 'Sending…',
  recordingFailedTitle: "Couldn't record",
  sendVoiceAction: 'Send',
  discardAction: 'Discard',
  voiceSent: 'Voice message sent',
  voiceFailed: 'Not sent: {reason}',

  transcriptHeader: 'Transcript',
  transcriptLabel: 'Transcript of a voice message from {name}',
  transcribing: 'Transcribing…',
  transcriptFailedTitle: "Couldn't transcribe",
  transcriptEmpty: 'No words were recognized.',

  audioBusy: 'The microphone is busy with another recording or dictation. Try again in a moment.',
  audioNoPhone: 'The glasses are not connected to the phone.',
  audioUnavailable: 'The phone could not use the glasses microphone.',
  audioTooLarge: 'This audio is too long to transcribe (over 5 minutes or 5 MB).',
  audioUnsupported: "This audio format can't be transcribed.",
  audioNoSpeech: 'No speech was found in this audio.',
  audioEngine: 'The transcription engine failed: {message}',
  audioTimeout: 'The phone took too long to answer.',
  audioOther: 'Something went wrong: {message}',

  reasonFormat: 'format not supported',
  markerDeleted: 'Message deleted',
  markerUnsupported: 'Unsupported message',
  markerNoPreview: 'No messages',

  voiceSearchRow: 'Voice search',
  voiceSearchHint: 'Say a name',
  searchHeader: 'Search',
  searchLabel: 'Voice search',
  searchListening: 'Listening…',
  searchSayName: 'Say the name of a chat or contact.',
  searchRecognizing: 'Recognizing…',
  searchSearching: 'Searching…',
  searchHeard: '“{text}”',
  searchDone: 'Done',
  searchAgain: 'Search again',
  searchResultsLabel: 'Chats and contacts for “{text}”',
  searchContact: 'Contact',
  searchContactPhone: 'Contact · {phone}',
  searchNoMatchTitle: 'No chat or contact matches “{text}”',
  searchNoMatchBody: 'Try again and say the name as it is saved.',
  searchNoSpeechTitle: "Didn't catch a name",
  searchNoSpeechBody: 'Try again and say the name of a chat or contact.',
  searchFailedTitle: 'Voice search failed',
  searchNetwork: 'The recognizer could not be reached.',
  searchUnavailableTitle: "Voice search isn't available",
  searchUnavailableBody: 'This device gives the app no speech recognition.',
  searchBack: 'Back',
};

export type StringKey = keyof typeof en;
type Strings = Record<StringKey, string>;

const pt: Strings = {
  appName: 'WhatsApp',
  chatsHeader: 'Conversas',
  offlineMeta: 'Sem conexão',
  chatListLabel: 'Conversas do WhatsApp',
  emptyTitle: 'Nenhuma conversa',
  emptyBody: 'As novas conversas do WhatsApp aparecem aqui.',
  emptyLabel: 'Sem conversas',

  setupHeader: 'Configuração',
  setupTitle: 'Conectar o WhatsApp',
  setupBody:
    'Abra o app Lumen no celular e preencha a URL do servidor Evolution, a instância e a API key deste app.',
  setupMissingLabel: 'FALTANDO',
  setupLabel: 'Configuração necessária',
  setupCheckAgain: 'Verificar de novo',
  setupStillMissing: 'Ainda não configurado',
  fieldUrl: 'URL do servidor',
  fieldInstance: 'Instância',
  fieldApiKey: 'API key',

  loadingHeader: 'Carregando…',
  connectingLabel: 'Conectando',

  errorHeader: 'Conexão',
  errorLabel: 'Erro de conexão',
  errorDetailLabel: 'DETALHE',
  retry: 'Tentar de novo',
  errNetworkTitle: 'Servidor inacessível',
  errNetworkBody:
    'Verifique a internet e a URL do servidor. O servidor Evolution também precisa liberar este app em CORS_ORIGIN.',
  errAuthTitle: 'API key recusada',
  errAuthBody:
    'O servidor recusou a API key. Atualize-a no app Lumen do celular.',
  errInstanceTitle: 'Instância não encontrada',
  errInstanceBody:
    'O servidor não tem uma instância chamada “{instance}”. Confira o nome da instância e a URL do servidor no app Lumen do celular.',
  errServerTitle: 'Erro no servidor',
  errServerBody: 'O servidor Evolution não conseguiu responder. Tente de novo daqui a pouco.',
  errConfigTitle: 'URL do servidor inválida',
  errConfigBody:
    'A URL do servidor precisa começar com http:// ou https://. Corrija-a no app Lumen do celular.',
  httpStatus: 'HTTP {status}',

  threadLabel: 'Conversa com {name}',
  threadEmptyTitle: 'Nenhuma mensagem recente',
  threadEmptyBody: 'As mensagens desta conversa aparecem aqui.',
  threadStatusLabel: 'Mensagens',
  replyHint: 'Responder',
  quoteHint: 'Responder a “{text}”',
  messageActionsLabel: 'Ações da mensagem: {message}',
  replyAction: 'Responder',
  voiceAction: 'Voz',
  photosAction: 'Fotos',
  viewAction: 'Ver',
  reactWith: 'Reagir com {emoji}',
  reactionSent: 'Reação {emoji} enviada',
  reactionFailed: 'Reação não enviada: {reason}',
  replyFieldLabel: 'Responder a {name}',
  sendLabel: 'Enviar',
  sendingLabel: 'Enviando',
  messageSent: 'Mensagem enviada',
  sendFailed: 'Não enviada: {reason}',
  connectionLost: 'Conexão perdida. Tentando de novo…',

  reasonNetwork: 'sem conexão',
  reasonAuth: 'API key recusada',
  reasonInstance: 'instância não encontrada',
  reasonServer: 'erro no servidor',
  reasonRejected: 'recusada pelo servidor',

  you: 'Você',
  yesterday: 'Ontem',
  unknownContact: 'Contato desconhecido',
  bubbleLabel: '{sender}: {text}, {time}',
  senderPrefix: '{sender}: {text}',
  markerWithCaption: '{marker}: {caption}',
  markerPhoto: 'Foto',
  markerVideo: 'Vídeo',
  markerAudio: 'Áudio',
  markerSticker: 'Figurinha',
  markerDocument: 'Documento',
  markerLocation: 'Localização',
  markerContact: 'Contato',
  markerPoll: 'Enquete',
  markerReaction: 'Reação {emoji}',
  youReacted: 'Você reagiu {emoji}',
  reacted: 'Reagiu {emoji}',
  reactedTo: 'Reagiu {emoji} a “{text}”',
  reactionsLabel: 'reações {list}',

  photoHeader: 'Foto',
  photoLabel: 'Foto de {name}',
  photoLoading: 'Carregando foto',
  photoFailedTitle: 'Não foi possível carregar a foto',
  photoFailedBody: 'O servidor não conseguiu enviar esta foto ({reason}).',

  audioLabel: 'Mensagem de voz, {duration}',
  audioPlaying: 'Tocando, {position} de {duration}',
  audioPaused: 'Pausado, {position} de {duration}',
  audioLoading: 'Carregando áudio',
  audioFailed: 'Não foi possível tocar o áudio: {reason}',
  listenAction: 'Ouvir',
  pauseAction: 'Pausar',
  transcribeAction: 'Transcrever',
  transcribeUnavailable: 'Transcrever (indisponível neste aparelho)',

  recordingHeader: 'Gravando',
  recordingLabel: 'Gravação de mensagem de voz',
  recordingStarting: 'Iniciando…',
  recordingNow: 'Gravando',
  recordingLimit: 'Chegou ao limite de {limit}',
  recordingLevel: 'Nível do microfone',
  recordingFinishing: 'Finalizando…',
  recordingSending: 'Enviando…',
  recordingFailedTitle: 'Não foi possível gravar',
  sendVoiceAction: 'Enviar',
  discardAction: 'Descartar',
  voiceSent: 'Mensagem de voz enviada',
  voiceFailed: 'Não enviada: {reason}',

  transcriptHeader: 'Transcrição',
  transcriptLabel: 'Transcrição de uma mensagem de voz de {name}',
  transcribing: 'Transcrevendo…',
  transcriptFailedTitle: 'Não foi possível transcrever',
  transcriptEmpty: 'Nenhuma palavra reconhecida.',

  audioBusy: 'O microfone está ocupado com outra gravação ou ditado. Tente de novo daqui a pouco.',
  audioNoPhone: 'Os óculos não estão conectados ao celular.',
  audioUnavailable: 'O celular não conseguiu usar o microfone dos óculos.',
  audioTooLarge: 'Este áudio é longo demais para transcrever (mais de 5 minutos ou 5 MB).',
  audioUnsupported: 'Este formato de áudio não pode ser transcrito.',
  audioNoSpeech: 'Nenhuma fala encontrada neste áudio.',
  audioEngine: 'O motor de transcrição falhou: {message}',
  audioTimeout: 'O celular demorou demais para responder.',
  audioOther: 'Algo deu errado: {message}',

  reasonFormat: 'formato não suportado',
  markerDeleted: 'Mensagem apagada',
  markerUnsupported: 'Mensagem não suportada',
  markerNoPreview: 'Sem mensagens',

  voiceSearchRow: 'Busca por voz',
  voiceSearchHint: 'Diga um nome',
  searchHeader: 'Buscar',
  searchLabel: 'Busca por voz',
  searchListening: 'Ouvindo…',
  searchSayName: 'Diga o nome de uma conversa ou contato.',
  searchRecognizing: 'Reconhecendo…',
  searchSearching: 'Procurando…',
  searchHeard: '“{text}”',
  searchDone: 'Pronto',
  searchAgain: 'Buscar de novo',
  searchResultsLabel: 'Conversas e contatos para “{text}”',
  searchContact: 'Contato',
  searchContactPhone: 'Contato · {phone}',
  searchNoMatchTitle: 'Nenhuma conversa ou contato com “{text}”',
  searchNoMatchBody: 'Tente de novo e diga o nome como está salvo.',
  searchNoSpeechTitle: 'Não ouvi nenhum nome',
  searchNoSpeechBody: 'Tente de novo e diga o nome de uma conversa ou contato.',
  searchFailedTitle: 'A busca por voz falhou',
  searchNetwork: 'Não foi possível falar com o reconhecedor de voz.',
  searchUnavailableTitle: 'Busca por voz indisponível',
  searchUnavailableBody: 'Este aparelho não oferece reconhecimento de voz ao app.',
  searchBack: 'Voltar',
};

const dictionaries = {en, pt} satisfies Record<string, Strings>;
export type Locale = keyof typeof dictionaries;

/** Picks the dictionary from the base language (`pt-PT` and `pt-BR` both map to `pt`). */
export function resolveLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const base = language.toLowerCase().split('-')[0];
    if (base in dictionaries) {
      return base as Locale;
    }
  }
  return 'en';
}

function browserLanguages(): string[] {
  if (typeof navigator === 'undefined') {
    return [];
  }
  // Only the primary language decides; `navigator.languages` may list extras.
  return navigator.language ? [navigator.language] : [];
}

const deviceLocale: Locale = resolveLocale(browserLanguages());

/** Language in use: the device's, or English while demo mode forces it. */
export let locale: Locale = deviceLocale;

/** Forces a language (demo mode) or, with null, goes back to the device's. */
export function setLocaleOverride(next: Locale | null): void {
  locale = next ?? deviceLocale;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
  }
}

export function translate(
  target: Locale,
  key: StringKey,
  params?: Record<string, string | number>,
): string {
  const template = dictionaries[target][key];
  if (params == null) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export function t(key: StringKey, params?: Record<string, string | number>): string {
  return translate(locale, key, params);
}
