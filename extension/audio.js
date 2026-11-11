import {frequencies, normalize} from './settings.js';

const sessions = new Map();

function update(session, settings) {
  session.settings = normalize(settings);
  const now = session.context.currentTime;
  session.filters.forEach((filter, index) => {
    filter.gain.setTargetAtTime(session.settings.bands[index], now, 0.02);
  });
  session.gain.gain.setTargetAtTime(session.settings.volume / 100, now, 0.025);
}

async function stop(tabId) {
  const session = sessions.get(tabId);
  if (!session) return;
  sessions.delete(tabId);
  session.stream.getTracks().forEach(track => track.stop());
  await session.context.close();
}

async function start({tabId, streamId, settings}) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {mandatory: {chromeMediaSource: 'tab', chromeMediaSourceId: streamId}},
    video: false
  });
  let context;
  try {
    context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const filters = frequencies.map(frequency => new BiquadFilterNode(context, {
      type: 'peaking', frequency, Q: 0.95
    }));
    const gain = new GainNode(context, {gain: 0});
    const compressor = new DynamicsCompressorNode(context, {
      threshold: -6, knee: 6, ratio: 16, attack: 0.003, release: 0.16
    });
    [source, ...filters, gain, compressor].reduce((previous, node) => previous.connect(node));
    compressor.connect(context.destination);
    const session = {context, stream, filters, gain};
    const track = stream.getAudioTracks()[0];
    track.addEventListener('ended', async () => {
      if (sessions.get(tabId) !== session) return;
      await stop(tabId);
      await chrome.runtime.sendMessage({target: 'worker', type: 'ended', tabId}).catch(() => {});
    });
    update(session, settings);
    await context.resume();
    if (track.readyState !== 'live') throw new Error('A captura terminou durante a ativação.');
    sessions.set(tabId, session);
  } catch (error) {
    stream.getTracks().forEach(track => track.stop());
    if (context && context.state !== 'closed') await context.close();
    throw error;
  }
}

async function handle(message) {
  const {tabId, type, settings} = message;
  if (type === 'start' && !sessions.has(tabId)) await start(message);
  if (type === 'stop') await stop(tabId);
  const session = sessions.get(tabId);
  if (!session) return {active: false};
  if (type === 'update') update(session, settings);
  return {active: true, settings: session.settings};
}

chrome.runtime.onMessage.addListener((message, _, reply) => {
  if (message.target !== 'audio') return;
  handle(message).then(reply, error => reply({error: error.message}));
  return true;
});
