import type { Page } from 'playwright';
import type { SelectorType } from '../domain/types.js';
import { AppError } from '../domain/errors.js';
import type { BrowserManager } from '../browser/browser-manager.js';
import type { Logger } from '../utils/logger.js';
import { assertSafePublicUrl, type UrlGuardOptions } from '../utils/url-guard.js';
import {
  assertPublicDnsResolution,
  type HostResolver,
} from '../utils/dns-guard.js';

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
    private readonly dnsResolver: HostResolver | null = null,
  ) {}

  async extract(request: ExtractionRequest): Promise<ExtractionResult> {
    const parsedUrl = assertSafePublicUrl(request.url, this.urlGuardOptions);
    if (!this.urlGuardOptions.allowPrivateTargets && this.dnsResolver !== null) {
      await assertPublicDnsResolution(parsedUrl.hostname, { resolver: this.dnsResolver });
    }
    const startedAt = Date.now();
    try {
      const content = await this.browserManager.withPage((page) =>
        this.extractFromPage(page, request, parsedUrl.hostname),
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

  private async extractFromPage(
    page: Page,
    request: ExtractionRequest,
    initialHostname: string,
  ): Promise<string> {
    // All Playwright operations (locator queries included) inherit this
    // timeout instead of the 30 s library default.
    page.setDefaultTimeout(request.timeoutMs);

    // A hard wall-clock budget for the whole extraction. goto(), load state
    // and DOM queries each have their own timeout, but a slow page could still
    // occupy a scheduler slot for several multiples of DEFAULT_TIMEOUT.
    const deadlineMs = Math.max(5_000, request.timeoutMs * 2 + request.settleMs + 5_000);
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        // Closing the context aborts every in-flight Playwright operation,
        // so the losing branch of the race cannot linger indefinitely.
        void page.context().close().catch(() => undefined);
        reject(new AppError('TIMEOUT', 'The check exceeded its total time budget.'));
      }, deadlineMs);
    });

    try {
      return await Promise.race([this.runExtraction(page, request, initialHostname), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async runExtraction(
    page: Page,
    request: ExtractionRequest,
    initialHostname: string,
  ): Promise<string> {
    // Skip heavy assets we cannot extract text from. Purely a performance and
    // politeness measure — not an anti-bot technique.
    //
    // SECURITY: the URL/DNS guards only run on the initial URL by default,
    // while Playwright follows redirects and fetches subresources itself.
    // Validate every http(s) request here too, so a 302 (or an iframe/XHR)
    // cannot bounce the browser into 127.0.0.1 / 169.254.169.254.
    await page.route('**/*', async (route) => {
      const browserRequest = route.request();
      const resourceType = browserRequest.resourceType();
      if (resourceType === 'image' || resourceType === 'media' || resourceType === 'font') {
        await route.abort().catch(() => undefined);
        return;
      }

      const url = browserRequest.url();
      if (/^https?:/i.test(url)) {
        try {
          assertSafePublicUrl(url, this.urlGuardOptions);
          // Cross-origin navigations (i.e. redirects) also get the DNS layer.
          // Subresources only get the cheap literal-IP check to avoid a DNS
          // lookup per CDN asset on every poll.
          if (
            browserRequest.isNavigationRequest() &&
            !this.urlGuardOptions.allowPrivateTargets &&
            this.dnsResolver !== null
          ) {
            const hostname = new URL(url).hostname;
            if (hostname !== initialHostname) {
              await assertPublicDnsResolution(hostname, { resolver: this.dnsResolver });
            }
          }
        } catch {
          this.logger.debug(
            { target: url.slice(0, 200) },
            'blocked a navigation or subresource to a non-public target',
          );
          await route.abort().catch(() => undefined);
          return;
        }
      }
      await route.continue().catch(() => undefined);
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
