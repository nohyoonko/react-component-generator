import { stripCodeFences, ensureRenderCall } from './generator';
import { withModelFallback } from './fallback';

// 우선순위 순서. 앞 모델이 실패하면 다음 모델로 폴백한다.
const GOOGLE_MODELS = ['gemini-3.1-flash-lite', 'gemini-3.5-flash'];

const SYSTEM_PROMPT = `You are a React component generator. Generate a single React component based on the user's description.

Rules:
- Use inline styles only (no CSS imports, no CSS modules)
- Do NOT use import statements — React is already available in scope as a global
- Define the component as a function, then call render(<ComponentName />) at the end
- Make the component visually appealing with proper styling
- Use React hooks if needed (e.g., React.useState, React.useEffect)
- The component must be completely self-contained
- Respond with ONLY the code block — no explanations, no markdown fences
- Use descriptive variable names and clean formatting
- For colors, prefer modern palettes (gradients, shadows, etc.)
- Ensure the component is interactive where appropriate (hover states, click handlers, etc.)
- Do NOT use TypeScript syntax — no type annotations, no interfaces, no generics, no "as" casts. Write plain JavaScript only.

Example output format:
const GradientButton = () => {
  const [hovered, setHovered] = React.useState(false);

  return (
    <button
      style={{
        background: hovered
          ? 'linear-gradient(135deg, #667eea, #764ba2)'
          : 'linear-gradient(135deg, #764ba2, #667eea)',
        color: 'white',
        border: 'none',
        padding: '12px 24px',
        borderRadius: '8px',
        fontSize: '16px',
        cursor: 'pointer',
        transition: 'all 0.3s ease',
        transform: hovered ? 'scale(1.05)' : 'scale(1)',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      Click me
    </button>
  );
};

render(<GradientButton />);`;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

type Provider = 'anthropic' | 'google';

const ENV_KEYS: Record<Provider, string | undefined> = {
  anthropic: process.env.ANTHROPIC_API_KEY,
  google: process.env.GOOGLE_API_KEY,
};

function resolveApiKey(provider: Provider, clientKey?: string): string | null {
  return clientKey || ENV_KEYS[provider] || null;
}

async function callAnthropic(prompt: string, apiKey: string): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Claude API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text?: string }>;
  };

  return data.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

async function* callAnthropicStream(prompt: string, apiKey: string): AsyncGenerator<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      stream: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Claude API error: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Response body is not readable');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
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
              type?: string;
              delta?: { type?: string; text?: string };
            };

            if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
              yield event.delta.text;
            }
          } catch {
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
          type?: string;
          delta?: { type?: string; text?: string };
        };
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
          yield event.delta.text;
        }
      } catch {
        // Skip malformed JSON
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function callGoogleModel(prompt: string, apiKey: string, model: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 8192 },
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    candidates: Array<{
      content: { parts: Array<{ text?: string }> };
      finishReason?: string;
    }>;
  };

  const candidate = data.candidates?.[0];
  if (candidate?.finishReason === 'MAX_TOKENS') {
    throw new Error('생성된 코드가 너무 길어 잘렸습니다. 더 간단한 컴포넌트를 요청해주세요.');
  }

  return (
    candidate?.content?.parts
      ?.map((part) => part.text)
      ?.join('') ?? ''
  );
}

async function callGoogle(prompt: string, apiKey: string): Promise<string> {
  return withModelFallback(GOOGLE_MODELS, (model) => callGoogleModel(prompt, apiKey, model));
}

async function* callGoogleModelStream(prompt: string, apiKey: string, model: string): AsyncGenerator<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 8192 },
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Response body is not readable');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
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
              candidates?: Array<{
                content?: { parts: Array<{ text?: string }> };
                finishReason?: string;
              }>;
            };

            const candidate = event.candidates?.[0];
            if (candidate?.finishReason === 'MAX_TOKENS') {
              throw new Error('생성된 코드가 너무 길어 잘렸습니다. 더 간단한 컴포넌트를 요청해주세요.');
            }

            const text = candidate?.content?.parts?.map((part) => part.text).join('') ?? '';
            if (text) {
              yield text;
            }
          } catch (err) {
            if (err instanceof Error && err.message.includes('생성된 코드가')) {
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
          candidates?: Array<{
            content?: { parts: Array<{ text?: string }> };
          }>;
        };
        const text = event.candidates?.[0]?.content?.parts?.map((part) => part.text).join('') ?? '';
        if (text) {
          yield text;
        }
      } catch {
        // Skip malformed JSON
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function* callGoogleStream(prompt: string, apiKey: string): AsyncGenerator<string> {
  let lastError: unknown;

  for (const model of GOOGLE_MODELS) {
    try {
      yield* callGoogleModelStream(prompt, apiKey, model);
      return;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError;
}

const server = Bun.serve({
  port: 3002,
  async fetch(req) {
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(req.url);

    if (req.method === 'GET' && url.pathname === '/api/config') {
      return Response.json(
        {
          envKeys: {
            anthropic: !!ENV_KEYS.anthropic,
            google: !!ENV_KEYS.google,
          },
        },
        { headers: CORS_HEADERS }
      );
    }

    if (req.method === 'POST' && url.pathname === '/api/generate') {
      try {
        const { prompt, apiKey, provider = 'anthropic' } = (await req.json()) as {
          prompt: string;
          apiKey?: string;
          provider?: Provider;
        };

        const resolvedKey = resolveApiKey(provider, apiKey);

        if (!resolvedKey) {
          return Response.json(
            { error: `API key is required. Set ${provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'GOOGLE_API_KEY'} in .env or enter it manually.` },
            { status: 400, headers: CORS_HEADERS }
          );
        }

        if (!prompt) {
          return Response.json(
            { error: 'Prompt is required' },
            { status: 400, headers: CORS_HEADERS }
          );
        }

        const text =
          provider === 'google'
            ? await callGoogle(prompt, resolvedKey)
            : await callAnthropic(prompt, resolvedKey);

        const code = ensureRenderCall(stripCodeFences(text));

        return Response.json({ code }, { headers: CORS_HEADERS });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';

        if (message.includes('503')) {
          return Response.json(
            { error: 'API 서버가 일시적으로 과부하 상태입니다. 잠시 후 다시 시도해주세요.' },
            { status: 503, headers: CORS_HEADERS }
          );
        }

        if (message.includes('429')) {
          return Response.json(
            { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
            { status: 429, headers: CORS_HEADERS }
          );
        }

        return Response.json(
          { error: message },
          { status: 500, headers: CORS_HEADERS }
        );
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/generate-stream') {
      try {
        const { prompt, apiKey, provider = 'anthropic' } = (await req.json()) as {
          prompt: string;
          apiKey?: string;
          provider?: Provider;
        };

        const resolvedKey = resolveApiKey(provider, apiKey);

        if (!resolvedKey) {
          const body = JSON.stringify({
            error: `API key is required. Set ${provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'GOOGLE_API_KEY'} in .env or enter it manually.`,
          });
          return new Response(body, { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
        }

        if (!prompt) {
          const body = JSON.stringify({ error: 'Prompt is required' });
          return new Response(body, { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
        }

        const stream = new ReadableStream<string>({
          async start(controller) {
            try {
              let buffer = '';
              const generator =
                provider === 'google' ? callGoogleStream(prompt, resolvedKey) : callAnthropicStream(prompt, resolvedKey);

              for await (const chunk of generator) {
                buffer += chunk;
                controller.enqueue(`data: ${JSON.stringify({ text: chunk })}\n\n`);
              }

              const finalCode = ensureRenderCall(stripCodeFences(buffer));
              controller.enqueue(`data: ${JSON.stringify({ final: finalCode })}\n\n`);
              controller.close();
            } catch (err) {
              const message = err instanceof Error ? err.message : 'Unknown error';
              controller.enqueue(`data: ${JSON.stringify({ error: message })}\n\n`);
              controller.close();
            }
          },
        });

        return new Response(stream, {
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        const body = JSON.stringify({ error: message });
        return new Response(body, { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
      }
    }

    return Response.json(
      { error: 'Not found' },
      { status: 404, headers: CORS_HEADERS }
    );
  },
});

console.log(`API server running at http://localhost:${server.port}`);
