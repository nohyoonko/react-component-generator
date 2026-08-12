import { describe, it, expect } from 'vitest';
import {
  COMPONENTS_STORAGE_KEY,
  serializeComponents,
  deserializeComponents,
} from './componentStorage';
import type { GeneratedComponent } from '../types';

describe('deserializeComponents', () => {
  it('null을 받으면 빈 배열을 반환한다', () => {
    expect(deserializeComponents(null)).toEqual([]);
  });

  it('빈 문자열을 받으면 빈 배열을 반환한다', () => {
    expect(deserializeComponents('')).toEqual([]);
  });

  it('손상된 JSON은 빈 배열을 반환한다', () => {
    expect(deserializeComponents('{ broken')).toEqual([]);
  });

  it('배열이 아닌 유효 JSON은 빈 배열을 반환한다', () => {
    expect(deserializeComponents('{}')).toEqual([]);
    expect(deserializeComponents('"string"')).toEqual([]);
    expect(deserializeComponents('123')).toEqual([]);
  });

  it('필수 필드가 누락된 항목은 제외한다', () => {
    const json = JSON.stringify([
      { id: '1', prompt: 'p1', code: 'c1', createdAt: '2026-01-01T00:00:00Z' },
      { id: '2', prompt: 'p2', code: 'c2' }, // createdAt 누락
      { id: '3', prompt: 'p3', createdAt: '2026-01-01T00:00:00Z' }, // code 누락
    ]);
    const result = deserializeComponents(json);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('필드 타입이 틀린 항목은 제외한다', () => {
    const json = JSON.stringify([
      { id: 123, prompt: 'p1', code: 'c1', createdAt: '2026-01-01T00:00:00Z' }, // id가 number
      { id: '2', prompt: 'p2', code: 'c2', createdAt: '2026-01-01T00:00:00Z' }, // 정상
    ]);
    const result = deserializeComponents(json);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('2');
  });

  it('createdAt이 파싱 불가능한 문자열인 항목은 제외한다', () => {
    const json = JSON.stringify([
      { id: '1', prompt: 'p1', code: 'c1', createdAt: 'not-a-date' },
      { id: '2', prompt: 'p2', code: 'c2', createdAt: '2026-01-01T00:00:00Z' },
    ]);
    const result = deserializeComponents(json);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('2');
  });

  it('정상 데이터의 createdAt이 Date 인스턴스로 복원된다', () => {
    const json = JSON.stringify([
      { id: '1', prompt: 'p1', code: 'c1', createdAt: '2026-01-01T12:34:56Z' },
    ]);
    const result = deserializeComponents(json);
    expect(result).toHaveLength(1);
    expect(result[0].createdAt).toBeInstanceOf(Date);
    expect(result[0].createdAt.toISOString()).toBe('2026-01-01T12:34:56.000Z');
  });

  it('빈 배열은 빈 배열로 반환된다', () => {
    expect(deserializeComponents('[]')).toEqual([]);
  });
});

describe('serializeComponents / deserializeComponents 라운드트립', () => {
  const sampleComponents: GeneratedComponent[] = [
    {
      id: 'id-1',
      prompt: '버튼을 만들어줘',
      code: '<button>Click me</button>',
      createdAt: new Date('2026-01-01T10:00:00Z'),
    },
    {
      id: 'id-2',
      prompt: '카드 컴포넌트',
      code: '<div class="card">Card content</div>',
      createdAt: new Date('2026-01-01T11:00:00Z'),
    },
  ];

  it('직렬화 후 역직렬화하면 원본과 동일하다', () => {
    const serialized = serializeComponents(sampleComponents);
    const deserialized = deserializeComponents(serialized);
    expect(deserialized).toEqual(sampleComponents);
  });

  it('빈 배열의 라운드트립은 빈 배열이다', () => {
    const serialized = serializeComponents([]);
    const deserialized = deserializeComponents(serialized);
    expect(deserialized).toEqual([]);
  });
});

describe('COMPONENTS_STORAGE_KEY', () => {
  it('문자열이고 비어있지 않다', () => {
    expect(typeof COMPONENTS_STORAGE_KEY).toBe('string');
    expect(COMPONENTS_STORAGE_KEY.length).toBeGreaterThan(0);
  });
});
