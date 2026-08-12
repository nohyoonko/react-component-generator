import { useState, useCallback, useEffect } from 'react';
import type { GeneratedComponent, Provider } from '../types';
import {
  COMPONENTS_STORAGE_KEY,
  serializeComponents,
  deserializeComponents,
} from '../utils/componentStorage';

interface UseComponentGeneratorReturn {
  components: GeneratedComponent[];
  isLoading: boolean;
  error: string | null;
  generate: (prompt: string, apiKey: string | undefined, provider: Provider) => Promise<void>;
  removeComponent: (id: string) => void;
  clearAll: () => void;
}

export function useComponentGenerator(): UseComponentGeneratorReturn {
  const [components, setComponents] = useState<GeneratedComponent[]>(() => {
    try {
      return deserializeComponents(localStorage.getItem(COMPONENTS_STORAGE_KEY));
    } catch {
      return [];
    }
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(COMPONENTS_STORAGE_KEY, serializeComponents(components));
    } catch {
      // 용량 초과/프라이빗 모드 등 저장 실패는 무시 — 앱 동작에는 영향 없음
    }
  }, [components]);

  const generate = useCallback(async (prompt: string, apiKey: string | undefined, provider: Provider) => {
    setIsLoading(true);
    setError(null);

    const componentId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newComponent: GeneratedComponent = {
      id: componentId,
      prompt,
      code: '',
      createdAt: new Date(),
      isStreaming: true,
    };

    setComponents((prev) => [newComponent, ...prev]);

    try {
      const res = await fetch('/api/generate-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, ...(apiKey && { apiKey }), provider }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to generate component');
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedCode = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines[lines.length - 1];

        for (const line of lines.slice(0, -1)) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6);
            try {
              const event = JSON.parse(jsonStr) as {
                text?: string;
                final?: string;
                error?: string;
              };

              if (event.error) {
                throw new Error(event.error);
              }

              if (event.text) {
                accumulatedCode += event.text;
                setComponents((prev) =>
                  prev.map((c) => (c.id === componentId ? { ...c, code: accumulatedCode } : c))
                );
              }

              if (event.final) {
                accumulatedCode = event.final;
                setComponents((prev) =>
                  prev.map((c) => (c.id === componentId ? { ...c, code: accumulatedCode, isStreaming: false } : c))
                );
              }
            } catch (err) {
              if (err instanceof Error && err.message.includes('error')) {
                throw err;
              }
              // Skip malformed JSON
            }
          }
        }
      }

      // Process remaining buffer
      if (buffer.startsWith('data: ')) {
        const jsonStr = buffer.slice(6);
        try {
          const event = JSON.parse(jsonStr) as {
            text?: string;
            final?: string;
            error?: string;
          };

          if (event.error) {
            throw new Error(event.error);
          }

          if (event.final) {
            accumulatedCode = event.final;
            setComponents((prev) =>
              prev.map((c) => (c.id === componentId ? { ...c, code: accumulatedCode } : c))
            );
          }
        } catch {
          // Skip malformed JSON
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      setComponents((prev) => prev.filter((c) => c.id !== componentId));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const removeComponent = useCallback((id: string) => {
    setComponents((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setComponents([]);
  }, []);

  return { components, isLoading, error, generate, removeComponent, clearAll };
}
