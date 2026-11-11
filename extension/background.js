const offscreenUrl = chrome.runtime.getURL('audio.html');
const pending = new Map();
let creating;

async function audioDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [offscreenUrl]
  });
  return contexts.length > 0;
}

async function ensureAudioDocument() {
  if (await audioDocument()) return;
  creating ??= chrome.offscreen.createDocument({
    url: 'audio.html',
    reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
    justification: 'Processar e reproduzir o áudio da aba escolhido pelo usuário.'
  }).finally(() => { creating = undefined; });
  await creating;
}

async function setBadge(tabId, active) {
  try {
    await chrome.action.setBadgeBackgroundColor({tabId, color: '#bcff78'});
    await chrome.action.setBadgeTextColor({tabId, color: '#15220b'});
    await chrome.action.setBadgeText({tabId, text: active ? 'EQ' : ''});
  } catch {
    // A aba pode ter sido fechada durante a atualização.
  }
}

async function handle(message) {
  const {type, tabId} = message;
  if (type === 'start') {
    const streamId = await chrome.tabCapture.getMediaStreamId({targetTabId: tabId});
    await ensureAudioDocument();
    message = {...message, streamId};
  } else if (!(await audioDocument())) {
    return {active: false};
  }
  return chrome.runtime.sendMessage({...message, target: 'audio'});
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message.target !== 'worker') return;
  if (sender.url === offscreenUrl && message.type === 'ended') {
    void setBadge(message.tabId, false);
    return;
  }
  if (sender.url !== chrome.runtime.getURL('popup.html') || !Number.isInteger(message.tabId)) return;
  const {tabId, type} = message;
  const operation = (pending.get(tabId) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const result = await handle(message);
    if (!result || result.error) throw new Error(result?.error);
    if (type === 'start' || type === 'stop') await setBadge(tabId, result.active);
    return result;
  });
  pending.set(tabId, operation);
  operation.then(reply, error => {
    console.warn('Pulso EQ:', error.message);
    reply({error: type === 'start'
      ? 'Não foi possível ativar nesta aba. Abra uma página com áudio e tente novamente.'
      : 'Não foi possível atualizar o áudio. Abra o painel novamente.'});
  }).finally(() => {
    if (pending.get(tabId) === operation) pending.delete(tabId);
  });
  return true;
});

chrome.tabCapture.onStatusChanged.addListener(({tabId, status}) => {
  if (status === 'stopped' || status === 'error') void setBadge(tabId, false);
});
