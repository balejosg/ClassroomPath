import { checkTransactionalEmailDelivery } from '../src/services/email-delivery-preflight.service.js';

const result = await checkTransactionalEmailDelivery();

console.log(JSON.stringify(result));
process.exit(result.ok ? 0 : 1);
