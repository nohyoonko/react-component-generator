import type { GeneratedComponent } from '../types';

export const COMPONENTS_STORAGE_KEY = 'react-component-generator:components';

export function serializeComponents(components: GeneratedComponent[]): string {
  return JSON.stringify(components);
}

export function deserializeComponents(raw: string | null): GeneratedComponent[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map(toGeneratedComponent)
    .filter((c): c is GeneratedComponent => c !== null);
}

function toGeneratedComponent(item: unknown): GeneratedComponent | null {
  if (typeof item !== 'object' || item === null) return null;
  const { id, prompt, code, createdAt } = item as Record<string, unknown>;
  if (
    typeof id !== 'string' ||
    typeof prompt !== 'string' ||
    typeof code !== 'string' ||
    typeof createdAt !== 'string'
  ) {
    return null;
  }
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return { id, prompt, code, createdAt: date };
}
