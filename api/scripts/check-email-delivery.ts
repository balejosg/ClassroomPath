import {
  checkTransactionalEmailDelivery,
  shouldAcceptEmailPreflightFailure,
} from '../src/services/email-delivery-preflight.service.js';

const result = await checkTransactionalEmailDelivery();
const accepted = shouldAcceptEmailPreflightFailure(result);

console.log(
  JSON.stringify(
    accepted
      ? {
          ...result,
          accepted: true,
          acceptanceReason: 'low_risk_daily_quota',
        }
      : result
  )
);
process.exit(result.ok || accepted ? 0 : 1);
