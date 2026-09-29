import type { Page } from 'playwright';
import type { SelectorType } from '../domain/types.js';
import { AppError } from '../domain/errors.js';
import type { BrowserManager } from '../browser/browser-manager.js';
import type { Logger } from '../utils/logger.js';
import { assertSafePublicUrl, type UrlGuardOptions } from '../utils/url-guard.js';

export interface ExtractionRequest {
  url: string;
  selector: string;
  selectorType: SelectorType;
  timeoutMs: number;
  settleMs: number;
}

export interface ExtractionResult {
  /** Raw extracted text, before normalization. */
  content: string;
  durationMs: number;
}

/**
 * Fetches a page with Playwright and extracts the target content.
 *
 * Semantics by selector type:
 * - css / xpath: joins the inner text of every matching element.
 * - text: returns the lines of the page body that contain the given keyword.
 *
 * Every failure mode maps to a specific AppError code: SELECTOR_NOT_FOUND,
 * TEXT_NOT_FOUND, EMPTY_EXTRACTION, TIMEOUT, NAVIGATION_ERROR, NETWORK_ERROR.
 * This service never persists anything — it is also used by the
 * "test extraction" preview endpoint.
 */
export class ExtractionService {
  constructor(
    private readonly browserManager: BrowserManager,
    private readonly logger: Logger,
    private readonly urlGuardOptions: UrlGuardOptions,
  ) {}

  async extract(request: ExtractionRequest): Promise<ExtractionResult> {
    assertSafePublicUrl(request.url, this.urlGuardOptions);
    const startedAt = Date.now();
    try {
      const content = await this.browserManager.withPage((page) =>
        this.extractFromPage(page, request),
      );
      if (content.trim().length === 0) {
        throw new AppError(
          'EMPTY_EXTRACTION',
          'The target matched but contained no text content.',
        );
      }
      return { content, durationMs: Date.now() - startedAt };
    } catch (err) {
      throw mapExtractionError(err);
    }
  }

  private async extractFromPage(page: Page, request: ExtractionRequest): Promise<string> {
    // Skip heavy assets we cannot extract text from. Purely a performance and
    // politeness measure — not an anti-bot technique.
    await page.route('**/*', (route) => {
      const resourceType = route.request().resourceType();
      if (resourceType === 'image' || resourceType === 'media' || resourceType === 'font') {
        void route.abort();
        return;
      }
      void route.continue();
    });

    const response = await page.goto(request.url, {
      waitUntil: 'domcontentloaded',
      timeout: request.timeoutMs,
    });
    if (response === null) {
      throw new AppError('NAVIGATION_ERROR', 'The page did not return a response.');
    }
    if (response.status() >= 400) {
      throw new AppError(
        'NAVIGATION_ERROR',
        `The target page responded with HTTP ${response.status()}.`,
      );
    }

    // Give the page a chance to finish rendering, but a hanging subresource
    // should not fail the whole check if the DOM is already there.
    await page
      .waitForLoadState('load', { timeout: request.timeoutMs })
      .catch(() => this.logger.debug('load state timeout reached, continuing with current DOM'));
    if (request.settleMs > 0) {
      await page.waitForTimeout(request.settleMs);
    }

    switch (request.selectorType) {
      case 'css':
        return extractByLocator(page, request.selector);
      case 'xpath':
        return extractByLocator(page, `xpath=${request.selector}`);
      case 'text':
        return extractByText(page, request.selector);
    }
  }
}

async function extractByLocator(page: Page, selector: string): Promise<string> {
  const locator = page.locator(selector);
  const count = await locator.count();
  if (count === 0) {
    throw new AppError('SELECTOR_NOT_FOUND', 'No element on the page matches the selector.');
  }
  const texts = await locator.allInnerTexts();
  return texts.join('\n\n');
}

async function extractByText(page: Page, selector: string): Promise<string> {
  const body = page.locator('body');
  const bodyCount = await body.count();
  if (bodyCount === 0) {
    throw new AppError('SELECTOR_NOT_FOUND', 'The page has no body element to search.');
  }
  const bodyText = await body.innerText();
  const lines = bodyText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes(selector));
  if (lines.length === 0) {
    throw new AppError('TEXT_NOT_FOUND', 'No line of the page body contains the given text.');
  }
  return lines.join('\n');
}

export function mapExtractionError(err: unknown): AppError {
  if (err instanceof AppError) {
    return err;
  }
  if (err instanceof Error && err.name === 'TimeoutError') {
    return new AppError(
      'TIMEOUT',
      'The page did not become ready within the configured timeout.',
      { cause: err },
    );
  }
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('net::ERR_NAME_NOT_RESOLVED')) {
    return new AppError('NETWORK_ERROR', 'The target host could not be resolved.', { cause: err });
  }
  if (message.includes('net::ERR_CONNECTION_REFUSED')) {
    return new AppError('NETWORK_ERROR', 'The target host refused the connection.', {
      cause: err,
    });
  }
  if (message.includes('net::')) {
    return new AppError('NETWORK_ERROR', 'A network error occurred while fetching the page.', {
      cause: err,
    });
  }
  return new AppError('EXTRACTION_FAILED', 'Failed to extract content from the page.', {
    cause: err,
  });
}
