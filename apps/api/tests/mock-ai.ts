import type { AiJsonRequest, AiJsonResult, AiProvider } from '../src/services/ai/provider.js';

type Handler = (request: AiJsonRequest<unknown>, call: number) => AiJsonResult<unknown> | Promise<AiJsonResult<unknown>>;

/**
 * A scripted AI provider for automated tests only — it is never available in
 * the running app (which reports "not configured" instead of faking output).
 * Records every request so tests can inspect exactly what would be sent.
 */
export class MockAiProvider implements AiProvider {
  readonly name = 'mock';
  readonly model = 'mock-model';
  readonly requests: AiJsonRequest<unknown>[] = [];

  constructor(private handler: Handler = MockAiProvider.echo) {}

  setHandler(handler: Handler): void {
    this.handler = handler;
  }

  async generateJson<T>(request: AiJsonRequest<T>): Promise<AiJsonResult<T>> {
    this.requests.push(request as AiJsonRequest<unknown>);
    return (await this.handler(request as AiJsonRequest<unknown>, this.requests.length)) as AiJsonResult<T>;
  }

  /** Default: a valid answer built from the product title in the prompt. */
  static echo(request: AiJsonRequest<unknown>): AiJsonResult<unknown> {
    const title = /"title": "([^"]*)"/.exec(request.user)?.[1] ?? 'Product';
    return MockAiProvider.answer({
      title: `Improved ${title}`,
      description: `A clear description of the ${title}.`,
      seoTitle: `${title} | Shop`,
      seoDescription: `Buy the ${title}.`,
      tags: ['kitchen', 'home'],
      missingFacts: ['material'],
      warnings: [],
    });
  }

  static answer(data: Record<string, unknown>): AiJsonResult<unknown> {
    return { ok: true, data, model: 'mock-model', usage: { inputTokens: 500, outputTokens: 200 } };
  }
}
