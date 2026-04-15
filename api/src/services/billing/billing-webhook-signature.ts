import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyStripeSignature(
  payload: string,
  signatureHeader: string,
  secret: string
): void {
  const pairs = new Map(
    signatureHeader.split(',').map((part) => {
      const [key, value] = part.split('=');
      return [key, value] as const;
    })
  );
  const timestamp = pairs.get('t');
  const signature = pairs.get('v1');

  if (!timestamp || !signature) {
    throw new Error('Missing Stripe signature components');
  }

  const expected = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(signature, 'hex');
  if (
    expectedBuffer.length !== actualBuffer.length ||
    !timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    throw new Error('Invalid Stripe signature');
  }
}
