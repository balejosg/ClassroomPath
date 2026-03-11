import { resolveRuntimeConfig } from '../src/config.js';

const runtimeConfig = resolveRuntimeConfig();

console.log(
  JSON.stringify(
    {
      emailDeliveryMode: runtimeConfig.emailDeliveryMode,
      openpathUrl: runtimeConfig.openpathUrl,
      publicUrl: runtimeConfig.publicUrl,
    },
    null,
    2
  )
);
