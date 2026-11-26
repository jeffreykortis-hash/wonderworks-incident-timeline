import { columnId, fields, keyFromFilteredFeed, selectedKey, timelineModel } from './timeline-model.mjs?v=3';

// Listen before loading the SDK so an editor config update cannot start the
// subscriptions ahead of the host's initialization reply.
const initialized = new Promise(resolve => {
  function onInit(event) {
    if (event.source !== window.parent || event.data?.type !== 'wb:plugin:init' || !event.data.result?.id) return;
    window.removeEventListener('message', onInit);
    // Let the SDK's message listener apply the instance ID before using it.
    setTimeout(resolve, 0);
  }
  window.addEventListener('message', onInit);
});
await import('./vendor/sigmacomputing-plugin.umd.js');
const { client } = window.SigmaPlugin;
const sourceLabel = 'Incident Timeline Feed';
const filteredFeedId = 'pjpaGaDuC0';
const filteredFeedColumns = { positionKey: 'APvOhCozeH', eventType: 'bplybC3qTW' };
const events = document.querySelector('#events');
const incident = document.querySelector('#incident');
const date = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Chicago',
});

const editorPanel = [
  { name: 'source', label: sourceLabel, type: 'element' },
  { name: 'selection', label: 'Selected incident control', type: 'variable', allowedTypes: ['text', 'text-list'] },
  ...fields.map(field => ({
    name: field.name, label: field.label, type: 'column', source: 'source',
    allowMultiple: false, allowedTypes: [field.type],
  })),
];

const state = { data: null, key: null, columns: {}, filteredFeed: false, binding: '', generation: 0, waiting: 'waiting' };
let disposeData = () => {};
let disposeSelection = () => {};
let feedTimer;

function el(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value) element.textContent = value;
  return element;
}

function render(model) {
  incident.textContent = model.context
    ? [model.context, model.key].join(' · ')
    : model.key || '';
  const states = {
    setup: 'Connect the Incident Timeline Feed and selected incident control.',
    unselected: 'Select an incident to view its activity.',
    loading: 'Loading activity for the selected incident…',
    empty: 'No recorded activity for this incident.',
    connecting: 'Connecting to Sigma…',
    standalone: 'Open the timeline from the Sigma workbook to see incident activity.',
    waiting: 'Waiting for rows from Incident Timeline Feed…',
    feedTimeout: 'Sigma found the timeline source but did not send rows.',
    sourceTimeout: 'Sigma did not respond to the timeline source request.',
    sourceRejected: 'Sigma could not read the configured timeline source.',
    noContext: 'The feed has no single incident context. Check the source element and select a queue row.',
    unavailable: 'The timeline source is unavailable.',
  };
  if (model.status !== 'ready') {
    events.replaceChildren(el('p', 'state', states[model.status]));
    return;
  }

  const list = el('ol', 'events');
  for (const event of model.events) {
    const row = el('li', 'event');
    const time = el('time', 'time', date.format(event.timestamp) + ' CT');
    time.dateTime = new Date(event.timestamp).toISOString();
    const body = el('div', 'event-body');
    const typeClass = event.kind.startsWith('Transfer')
      ? 'kind transfer' : (event.kind === 'Ownership updated' ? 'kind ownership' : 'kind');
    body.append(el('span', typeClass, event.kind));
    if (event.summary) body.append(el('h2', '', event.summary));
    if (event.details) body.append(el('p', 'details', event.details));
    if (event.actor) body.append(el('p', 'actor', event.actor));
    row.append(time, body);
    list.append(row);
  }
  events.replaceChildren(list);
}

function refresh() {
  let key = state.key;
  if (state.filteredFeed && !state.data) {
    render({ status: state.waiting, key });
    return;
  }
  // These columns belong to the workbook feed filtered by the selected incident.
  // A context row provides that incident when Sigma does not send a usable control value.
  if (!key && state.filteredFeed) {
    key = keyFromFilteredFeed(state.data, state.columns);
    if (!key) {
      render({ status: 'noContext' });
      return;
    }
  }
  render(timelineModel(state.data, state.columns, key));
}

function bind(config) {
  const { source, selection } = config ?? {};
  const columns = Object.fromEntries(fields.map(({ name }) => [name, columnId(config?.[name])]));
  const binding = JSON.stringify([source, selection, columns]);
  if (state.binding === binding) return;

  state.binding = binding;
  const generation = ++state.generation;
  clearTimeout(feedTimer);
  disposeData();
  disposeSelection();
  disposeData = () => {};
  disposeSelection = () => {};
  state.data = null;
  state.waiting = 'waiting';
  state.key = null;
  state.columns = columns;
  const sourceId = typeof source === 'string' ? source : source?.elementId ?? source?.id;
  state.filteredFeed = sourceId === filteredFeedId
    || Object.entries(filteredFeedColumns).every(([name, id]) => columns[name] === id);

  if (!source || !selection || fields.some(({ name }) => !columns[name])) {
    render({ status: 'setup' });
    return;
  }

  try {
    let sourceStatus = 'sourceTimeout';
    function updateSourceStatus(status) {
      sourceStatus = status;
      if (generation !== state.generation || state.data || state.waiting === 'waiting') return;
      state.waiting = status;
      refresh();
    }
    feedTimer = setTimeout(() => {
      if (generation !== state.generation || state.data) return;
      state.waiting = sourceStatus;
      refresh();
    }, 10000);
    client.elements.getElementColumns('source').then(
      columns => updateSourceStatus(columns == null ? 'sourceRejected' : 'feedTimeout'),
      () => updateSourceStatus('sourceRejected'),
    );
    state.key = selectedKey(client.config.getVariable('selection'));
    disposeSelection = client.config.subscribeToWorkbookVariable('selection', variable => {
      if (generation !== state.generation) return;
      state.key = selectedKey(variable);
      refresh();
    });
    disposeData = client.elements.subscribeToElementData('source', payload => {
      if (generation !== state.generation) return;
      clearTimeout(feedTimer);
      const value = Array.isArray(payload) && payload.length === 1 ? payload[0] : payload;
      const data = value?.data && !Array.isArray(value.data) ? value.data : value;
      if (!data) {
        state.data = null;
        state.waiting = 'sourceRejected';
        render({ status: state.waiting, key: state.key });
        return;
      }
      state.data = data;
      refresh();
    });
    refresh();
  } catch {
    clearTimeout(feedTimer);
    render({ status: 'unavailable' });
  }
}

render({ status: window.parent === window ? 'standalone' : 'connecting' });
let disposeConfig = () => {};
if (window.parent !== window) {
  await initialized;
  client.config.configureEditorPanel(editorPanel);
  disposeConfig = client.config.subscribe(bind);
  bind(client.config.get());
}
window.addEventListener('pagehide', () => {
  state.generation += 1;
  clearTimeout(feedTimer);
  disposeConfig();
  disposeData();
  disposeSelection();
}, { once: true });
