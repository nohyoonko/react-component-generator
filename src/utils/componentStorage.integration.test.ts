import { describe, it, expect, beforeEach } from 'vitest';
import {
  COMPONENTS_STORAGE_KEY,
  serializeComponents,
  deserializeComponents,
} from './componentStorage';
import type { GeneratedComponent } from '../types';

describe('componentStorage 통합 테스트 - localStorage 시뮬레이션', () => {
  let store: Record<string, string> = {};

  beforeEach(() => {
    store = {};
  });

  it('컴포넌트를 저장했다가 불러올 수 있다', () => {
    const component: GeneratedComponent = {
      id: 'test-1',
      prompt: '버튼 만들어줘',
      code: '<button>Click</button>',
      createdAt: new Date('2026-01-15T10:30:00Z'),
    };
    const components = [component];

    const serialized = serializeComponents(components);
    store[COMPONENTS_STORAGE_KEY] = serialized;

    const restored = deserializeComponents(store[COMPONENTS_STORAGE_KEY]);
    expect(restored).toHaveLength(1);
    expect(restored[0].id).toBe('test-1');
    expect(restored[0].prompt).toBe('버튼 만들어줘');
    expect(restored[0].code).toBe('<button>Click</button>');
    expect(restored[0].createdAt).toBeInstanceOf(Date);
    expect(restored[0].createdAt.toISOString()).toBe('2026-01-15T10:30:00.000Z');
  });

  it('여러 컴포넌트를 저장했다가 모두 불러올 수 있다', () => {
    const components: GeneratedComponent[] = [
      {
        id: 'id-1',
        prompt: '첫 번째',
        code: 'code1',
        createdAt: new Date('2026-01-15T10:00:00Z'),
      },
      {
        id: 'id-2',
        prompt: '두 번째',
        code: 'code2',
        createdAt: new Date('2026-01-15T11:00:00Z'),
      },
      {
        id: 'id-3',
        prompt: '세 번째',
        code: 'code3',
        createdAt: new Date('2026-01-15T12:00:00Z'),
      },
    ];

    const serialized = serializeComponents(components);
    store[COMPONENTS_STORAGE_KEY] = serialized;

    const restored = deserializeComponents(store[COMPONENTS_STORAGE_KEY]);
    expect(restored).toHaveLength(3);
    expect(restored.map((c) => c.id)).toEqual(['id-1', 'id-2', 'id-3']);
  });

  it('저장된 데이터가 없으면 빈 배열을 반환한다', () => {
    const restored = deserializeComponents(store[COMPONENTS_STORAGE_KEY] || null);
    expect(restored).toEqual([]);
  });

  it('손상된 저장 데이터는 안전하게 빈 배열로 처리된다', () => {
    store[COMPONENTS_STORAGE_KEY] = 'corrupted{data}';
    const restored = deserializeComponents(store[COMPONENTS_STORAGE_KEY]);
    expect(restored).toEqual([]);
  });
});
