export class HttpError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

type Rule<T> = (value: unknown, field: string) => T;

function fail(field: string, msg: string): never {
  throw new HttpError(400, `${field}: ${msg}`);
}

export const v = {
  string(opts: { min?: number; max?: number; trim?: boolean; pattern?: RegExp; oneOf?: string[]; default?: string } = {}): Rule<string> {
    const { min = 0, max = 10000, trim = true, pattern, oneOf } = opts;
    return (value, field) => {
      if (value === undefined || value === null || value === '') {
        if (opts.default !== undefined) return opts.default;
        fail(field, 'is required');
      }
      if (typeof value !== 'string') fail(field, 'must be a string');
      let s = trim ? value.trim() : value;
      if (s.length < min) fail(field, `must be at least ${min} characters`);
      if (s.length > max) fail(field, `must be at most ${max} characters`);
      if (pattern && !pattern.test(s)) fail(field, 'has an invalid format');
      if (oneOf && !oneOf.includes(s)) fail(field, `must be one of: ${oneOf.join(', ')}`);
      return s;
    };
  },
  int(opts: { min?: number; max?: number; default?: number } = {}): Rule<number> {
    const { min = -Infinity, max = Infinity } = opts;
    return (value, field) => {
      if (value === undefined || value === null || value === '') {
        if (opts.default !== undefined) return opts.default;
        fail(field, 'is required');
      }
      const n = typeof value === 'string' ? Number(value) : value;
      if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) fail(field, 'must be an integer');
      if (n < min || n > max) fail(field, `must be between ${min} and ${max}`);
      return n;
    };
  },
  num(opts: { min?: number; max?: number; default?: number } = {}): Rule<number> {
    const { min = -Infinity, max = Infinity } = opts;
    return (value, field) => {
      if (value === undefined || value === null || value === '') {
        if (opts.default !== undefined) return opts.default;
        fail(field, 'is required');
      }
      const n = typeof value === 'string' ? Number(value) : value;
      if (typeof n !== 'number' || !Number.isFinite(n)) fail(field, 'must be a number');
      if (n < min || n > max) fail(field, `must be between ${min} and ${max}`);
      return n;
    };
  },
  bool(opts: { default?: boolean } = {}): Rule<boolean> {
    return (value, field) => {
      if (value === undefined || value === null || value === '') {
        if (opts.default !== undefined) return opts.default;
        fail(field, 'is required');
      }
      if (typeof value === 'boolean') return value;
      if (value === 'true' || value === 1 || value === '1') return true;
      if (value === 'false' || value === 0 || value === '0') return false;
      fail(field, 'must be a boolean');
    };
  },
  array<T>(item: Rule<T>, opts: { min?: number; max?: number; default?: T[] } = {}): Rule<T[]> {
    const { min = 0, max = 10000 } = opts;
    return (value, field) => {
      if (value === undefined || value === null) {
        if (opts.default !== undefined) return opts.default;
        fail(field, 'is required');
      }
      if (!Array.isArray(value)) fail(field, 'must be an array');
      if (value.length < min || value.length > max) fail(field, `length must be between ${min} and ${max}`);
      return value.map((itemVal, i) => item(itemVal, `${field}[${i}]`));
    };
  },
  object<S extends Record<string, Rule<any>>>(shape: S): Rule<{ [K in keyof S]: S[K] extends Rule<infer T> ? T : never }> {
    return (value, field) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(field, 'must be an object');
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(shape)) {
        out[key] = (shape[key] as Rule<any>)((value as Record<string, unknown>)[key], `${field}.${key}`);
      }
      return out as any;
    };
  },
  optional<T>(rule: Rule<T>): Rule<T | undefined> {
    return (value, field) => {
      if (value === undefined || value === null || value === '') return undefined;
      return rule(value, field);
    };
  },
};

/** Validate a plain object against a shape, returning typed data or throwing HttpError(400). */
export function validate<S extends Record<string, Rule<any>>>(
  body: unknown,
  shape: S,
): { [K in keyof S]: S[K] extends Rule<infer T> ? T : never } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HttpError(400, 'Request body must be a JSON object');
  }
  return v.object(shape)(body, 'body') as any;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
