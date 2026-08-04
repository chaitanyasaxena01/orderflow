import { Router } from 'express';
import { sendSuccess } from '../../lib/response.js';
import * as paymentsService from './payments.service.js';

export const paymentsRouter = Router();

paymentsRouter.post('/payments', async (req, res, next) => {
  try {
    const rawBody =
      typeof req.rawBody === 'string' ? req.rawBody : JSON.stringify(req.body ?? {});

    const result = await paymentsService.handlePaymentWebhook({
      rawBody,
      signature: req.header('x-payment-signature') ?? undefined,
      timestamp: req.header('x-payment-timestamp') ?? undefined,
      eventId: req.header('x-payment-event-id') ?? undefined,
    });

    sendSuccess(res, result, result.duplicate ? 200 : 200);
  } catch (err) {
    next(err);
  }
});
