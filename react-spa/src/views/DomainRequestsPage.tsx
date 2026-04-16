import React from 'react';

import { DomainRequests } from '../openpath/public-shell';
import { PushNotificationControl } from '../pwa/PushNotificationControl';

export function DomainRequestsPage() {
  return (
    <>
      <PushNotificationControl />
      <DomainRequests canDeleteRequests={false} />
    </>
  );
}
