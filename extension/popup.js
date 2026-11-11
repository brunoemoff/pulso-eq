import {frequencies, normalize, presets} from './settings.js';

const byId = id => document.getElementById(id);
const power = byId('power');
const volume = byId('volume');
const status = byId('status');
let settings = normalize();
let saved = [];
let tabId;
let active = false;
let busy = false;

function showStatus(message, error = false) {
  status.dataset.active = active;
  status.dataset.error = error;
  status.textContent = message ?? (active ? 'Processando o áudio desta aba' : 'Ative para aplicar os ajustes nesta aba');
}

function send(type) {
  return chrome.runtime.sendMessage({target: 'worker', type, tabId, settings});
}

async function updateAudio() {
  if (!active && !busy) return;
  try {
    const result = await send('update');
    if (result.error) throw new Error(result.error);
    if (!busy && active && !result.active) {
      active = false;
      render();
      showStatus('A sessão de áudio terminou.');
    }
  } catch (error) {
    showStatus(error.message, true);
  }
}

function change(next) {
  settings = normalize(next);
  render();
  void updateAudio();
}

const sliders = frequencies.map((frequency, index) => {
  const band = document.createElement('label');
  band.className = 'band';
  const input = document.createElement('input');
  input.type = 'range';
  input.min = -12;
  input.max = 12;
  input.id = 'band-' + index;
  input.setAttribute('aria-label', frequency + ' Hz');
  const name = document.createElement('span');
  name.textContent = frequency >= 1000 ? frequency / 1000 + 'k' : frequency + ' Hz';
  const output = document.createElement('output');
  output.htmlFor = input.id;
  input.addEventListener('input', () => {
    const bands = [...settings.bands];
    bands[index] = Number(input.value);
    change({...settings, bands});
  });
  band.append(output, input, name);
  byId('bands').append(band);
  return {input, output};
});

function button(label, action) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.addEventListener('click', action);
  return element;
}

const presetButtons = Object.entries(presets).map(([label, bands]) => {
  const element = button(label, () => change({...settings, bands}));
  byId('presets').append(element);
  return {element, bands};
});

function render() {
  power.textContent = active ? 'Desativar nesta aba' : 'Ativar nesta aba';
  power.setAttribute('aria-pressed', active);
  power.disabled = busy || !Number.isInteger(tabId);
  volume.value = settings.volume;
  volume.setAttribute('aria-valuetext', settings.volume + '%');
  byId('volume-value').textContent = settings.volume + '%';
  sliders.forEach(({input, output}, index) => {
    const value = settings.bands[index];
    input.value = value;
    output.textContent = (value > 0 ? '+' : '') + value + ' dB';
    input.setAttribute('aria-valuetext', output.textContent);
  });
  const points = settings.bands.map((value, index) => [25 + index * 50, 38 - value * 2.65]);
  let path = 'M0 ' + points[0][1] + ' L' + points[0].join(' ');
  points.slice(1).forEach(([x, y], index) => {
    const [px, py] = points[index];
    const middle = (px + x) / 2;
    path += ' C' + [middle, py, middle, y, x, y].join(' ');
  });
  path += ' L350 ' + points.at(-1)[1];
  byId('line').setAttribute('d', path);
  byId('area').setAttribute('d', path + ' V76 H0 Z');
  for (const {element, bands} of presetButtons) {
    element.setAttribute('aria-pressed', bands.every((value, index) => value === settings.bands[index]));
  }
}

function renderSaved() {
  byId('saved').replaceChildren(...saved.map(preset => {
    const group = document.createElement('span');
    group.className = 'custom';
    const remove = button('×', () => storePresets(saved.filter(item => item.id !== preset.id), 'Preset removido.'));
    remove.setAttribute('aria-label', 'Remover preset ' + preset.name);
    group.append(button(preset.name, () => change(preset.settings)), remove);
    return group;
  }));
}

async function storePresets(next, message) {
  const submit = byId('save').querySelector('button');
  submit.disabled = true;
  byId('saved').inert = true;
  try {
    await chrome.storage.local.set({presets: next});
    saved = next;
    renderSaved();
    showStatus(message);
    return true;
  } catch {
    showStatus('Não foi possível salvar a alteração.', true);
    return false;
  } finally {
    submit.disabled = false;
    byId('saved').inert = false;
  }
}

byId('save').addEventListener('submit', async event => {
  event.preventDefault();
  const field = byId('name');
  const name = field.value.trim();
  if (!name) return;
  const previous = saved.find(item => item.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'));
  const preset = {id: previous?.id ?? crypto.randomUUID(), name, settings};
  const next = previous ? saved.map(item => item === previous ? preset : item) : [...saved, preset];
  const original = field.value;
  if (await storePresets(next, previous ? 'Preset atualizado.' : 'Preset salvo.') && field.value === original) {
    field.value = '';
  }
});

volume.addEventListener('input', () => change({...settings, volume: Number(volume.value)}));
byId('reset').addEventListener('click', () => change(normalize()));

power.addEventListener('click', async () => {
  busy = true;
  render();
  try {
    const result = await send(active ? 'stop' : 'start');
    if (result.error) throw new Error(result.error);
    active = result.active;
    showStatus();
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    busy = false;
    render();
  }
});

async function initialize() {
  render();
  try {
    const [tabs, storage] = await Promise.all([
      chrome.tabs.query({active: true, currentWindow: true}),
      chrome.storage.local.get({presets: []})
    ]);
    saved = storage.presets;
    renderSaved();
    const candidate = tabs[0]?.id;
    if (!Number.isInteger(candidate)) throw new Error('Nenhuma aba disponível.');
    tabId = candidate;
    const result = await send('status');
    if (result.error) throw new Error(result.error);
    active = result.active;
    if (active) settings = normalize(result.settings);
    showStatus();
  } catch (error) {
    showStatus(error.message, true);
  }
  render();
}

void initialize();
