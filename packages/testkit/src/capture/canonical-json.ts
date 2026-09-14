function isJsonObject(value: object): value is Record<string, unknown> {
  return Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null;
}

function serialize(value: unknown, ancestors: Set<object>): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number': {
      if (!Number.isFinite(value))
        throw new TypeError('Canonical JSON cannot encode non-finite numbers');
      return JSON.stringify(value);
    }
    case 'object':
      break;
    default:
      throw new TypeError(`Canonical JSON cannot encode ${typeof value}`);
  }

  if (ancestors.has(value)) throw new TypeError('Canonical JSON cannot encode cyclic values');
  ancestors.add(value);

  let output: string;
  if (Array.isArray(value)) {
    output = `[${value.map((entry) => serialize(entry, ancestors)).join(',')}]`;
  } else if (isJsonObject(value)) {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${serialize(value[key], ancestors)}`);
    output = `{${entries.join(',')}}`;
  } else {
    throw new TypeError('Canonical JSON only accepts JSON objects and arrays');
  }

  ancestors.delete(value);
  return output;
}

/** Serialize JSON values with recursively sorted object keys and preserved array order. */
export function canonicalJson(value: unknown): string {
  return serialize(value, new Set<object>());
}

export function canonicalJsonLine(value: unknown): string {
  return `${canonicalJson(value)}\n`;
}
