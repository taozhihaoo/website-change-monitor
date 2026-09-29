import type { FastifyInstance } from 'fastify';
import type { MonitorService } from '../../services/monitor-service.js';
import { testExtractionSchema } from '../schemas.js';

export interface ExtractionRoutesDeps {
  monitorService: MonitorService;
}

export async function extractionRoutes(
  app: FastifyInstance,
  deps: ExtractionRoutesDeps,
): Promise<void> {
  /**
   * "Test extraction" preview. Runs the exact extraction the monitor would
   * run but persists NOTHING (no snapshot, no change event, no check run),
   * letting users validate a selector before saving.
   */
  app.post('/monitors/test-extraction', async (request) => {
    const body = testExtractionSchema.parse(request.body);
    const result = await deps.monitorService.testExtraction({
      url: body.url,
      selector: body.selector,
      selectorType: body.selector_type,
    });
    return {
      content: result.content,
      hash: result.hash,
      duration_ms: result.durationMs,
    };
  });
}
