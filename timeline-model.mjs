const kinds = new Set([
  'Incident context', 'Incident note', 'Ownership updated',
  'Transfer approved', 'Transfer dispatched', 'Transfer received'
]);

export const fields = [
  { name: 'positionKey', label: 'Position key', type: 'text' },
  { name: 'eventType', label: 'Event type', type: 'text' },
  { name: 'occurredAt', label: 'Occurred at', type: 'datetime' },
  { name: 'actor', label: 'Actor', type: 'text' },
  { name: 'summary', label: 'Summary', type: 'text' },
  { name: 'details', label: 'Details', type: 'text' },
];

function unwrap(value) {
  if (Array.isArray(value)) return value.flatMap(unwrap);
  if (value && typeof value === 'object') {
    for (const name of ['value', 'defaultValue', 'values', 'selectedValues', 'val']) {
      const candidates = unwrap(value[name]);
      if (candidates.length) return candidates;
    }
    return [];
  }
  return typeof value === 'string' && value.trim() ? [value.trim()] : [];
}

export function selectedKey(variable) {
  const values = [...new Set(unwrap(variable))];
  return values.length === 1 ? values[0] : null;
}

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function columnId(binding) {
  if (Array.isArray(binding)) return binding.length === 1 ? columnId(binding[0]) : null;
  if (binding && typeof binding === 'object') {
    return columnId(binding.columnId ?? binding.columnIds);
  }
  return asText(binding) || null;
}

export function keyFromFilteredFeed(data, columns) {
  const keys = data?.[columns.positionKey];
  const types = data?.[columns.eventType];
  if (!Array.isArray(keys) || !Array.isArray(types)) return null;

  const distinctKeys = new Set(keys.map(asText).filter(Boolean));
  if (distinctKeys.size !== 1) return null;
  const key = distinctKeys.values().next().value;
  return types.some((kind, index) =>
    asText(kind) === 'Incident context' && asText(keys[index]) === key,
  ) ? key : null;
}

function asTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = Math.abs(value) < 100_000_000_000 ? value * 1000 : value;
    return Number.isFinite(new Date(millis).getTime()) ? millis : null;
  }
  const millis = typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
  return Number.isFinite(millis) ? millis : null;
}

export function timelineModel(data, columns, key) {
  if (!key) return { status: 'unselected', events: [] };
  if (!data) return { status: 'loading', key, events: [] };
  const keys = data[columns.positionKey];
  if (!Array.isArray(keys)) return { status: 'loading', key, events: [] };

  const events = [];
  const identities = new Set();
  let context = '';
  let hasContext = false;
  for (let index = 0; index < keys.length; index += 1) {
    if (asText(keys[index]) !== key) continue;
    const values = name => data[columns[name]]?.[index];
    const kind = asText(values('eventType'));
    if (!kinds.has(kind)) continue;
    const summary = asText(values('summary'));
    if (kind === 'Incident context') {
      hasContext = true;
      context ||= summary;
      continue;
    }
    const timestamp = asTimestamp(values('occurredAt'));
    if (timestamp === null) continue;
    const actor = asText(values('actor'));
    const details = asText(values('details'));
    const id = JSON.stringify([kind, timestamp, actor, summary, details]);
    if (identities.has(id)) continue;
    identities.add(id);
    events.push({ kind, timestamp, actor, summary, details });
  }

  // Wait for the new incident's anchor before showing any data after a switch.
  if (!hasContext) return { status: 'loading', key, events: [] };
  events.sort((a, b) => b.timestamp - a.timestamp || a.kind.localeCompare(b.kind));
  return { status: events.length ? 'ready' : 'empty', key, context, events };
}
