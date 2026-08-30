const escapePattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

export const formatSenpiFinalResponse = (sentinel, payload) =>
  `<${sentinel}>${JSON.stringify(payload)}</${sentinel}>`;

export const parseSenpiFinalResponse = (value, sentinel, name) => {
  if (typeof value !== 'string') {
    throw new TypeError(`${name} must be a string-valued Senpi final_response.`);
  }
  const escaped = escapePattern(sentinel);
  const opening = new RegExp(`<${escaped}>`, 'gu');
  const closing = new RegExp(`</${escaped}>`, 'gu');
  const openings = [...value.matchAll(opening)];
  const closings = [...value.matchAll(closing)];
  if (openings.length === 0 && closings.length === 0) {
    throw new TypeError(
      `${name} must contain exactly one ${sentinel} machine payload.`,
    );
  }
  if (openings.length !== 1 || closings.length !== 1) {
    throw new TypeError(`${name} must contain exactly one ${sentinel} machine payload.`);
  }
  const start = openings[0].index + openings[0][0].length;
  const end = closings[0].index;
  if (end <= start || value.slice(end + closings[0][0].length).includes(`<${sentinel}>`)) {
    throw new TypeError(`${name} machine payload is malformed.`);
  }
  let payload;
  try {
    payload = JSON.parse(value.slice(start, end));
  } catch {
    throw new TypeError(`${name} machine payload must contain valid JSON.`);
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new TypeError(`${name} machine payload must be a JSON object.`);
  }
  if (payload.sentinel !== sentinel) {
    throw new TypeError(`${name} machine payload sentinel does not match.`);
  }
  return payload;
};
