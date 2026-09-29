import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { Logger } from '../utils/logger.js';

/**
 * Identifies the monitor honestly to target sites. This project deliberately
 * does NOT spoof browser fingerprints or bypass bot protections.
 */
export const MONITOR_USER_AGENT =
  'Mozilla/5.0 (compatible; WebsiteChangeMonitor/0.1; +https://github.com/taozhihaoo/website-change-monitor)';

/**
 * Owns the single shared Chromium instance. Every check gets its own isolated
 * BrowserContext (cookies, storage, cache), and contexts are closed when the
 * check finishes. If the browser crashes or is killed, the next acquire
 * relaunches it transparently.
 */
export class BrowserManager {
  private browser: Browser | null = null;
  private launchPromise: Promise<Browser> | null = null;

  constructor(
    private readonly options: { headless: boolean },
    private readonly logger: Logger,
  ) {}

  get isRunning(): boolean {
    return this.browser !== null && this.browser.isConnected();
  }

  async withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    const context = await this.createContext();
    try {
      const page = await context.newPage();
      return await fn(page);
    } finally {
      await context.close().catch((err: unknown) => {
        this.logger.warn({ err }, 'failed to close browser context');
      });
    }
  }

  async close(): Promise<void> {
    const browser = this.browser;
    this.browser = null;
    this.launchPromise = null;
    if (browser) {
      await browser.close().catch((err: unknown) => {
        this.logger.warn({ err }, 'failed to close browser cleanly');
      });
      this.logger.info('browser closed');
    }
  }

  private async createContext(): Promise<BrowserContext> {
    const browser = await this.ensureBrowser();
    return browser.newContext({
      userAgent: MONITOR_USER_AGENT,
      serviceWorkers: 'block',
    });
  }

  private ensureBrowser(): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) {
      return Promise.resolve(this.browser);
    }
    if (this.launchPromise === null) {
      this.logger.info({ headless: this.options.headless }, 'launching browser');
      this.launchPromise = chromium
        .launch({ headless: this.options.headless })
        .then((browser) => {
          this.browser = browser;
          browser.on('disconnected', () => {
            this.browser = null;
            this.launchPromise = null;
            this.logger.warn('browser disconnected, will relaunch on next use');
          });
          return browser;
        })
        .catch((err: unknown) => {
          this.launchPromise = null;
          throw err;
        });
    }
    return this.launchPromise;
  }
}
