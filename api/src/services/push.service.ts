/**
 * Web Push subscription management and notification dispatch service.
 *
 * Owns all VAPID-based push logic for the ClassroomPath tenant layer:
 * saving and deleting subscriptions in the pushSubscriptions table, querying
 * subscription status for the current user, and fanning out push payloads to
 * every subscriber of a whitelist group when a new domain request arrives.
 *
 * Consumed by the push tRPC router under api/src/trpc/routers/ and by
 * api/src/services/request-write.service.ts when a new domain request is
 * created.
 *
 * Non-obvious constraint: VAPID details are applied to the web-push library
 * singleton lazily and only once (guarded by webPushConfigured) -- if VAPID
 * env vars change at runtime after the first successful call, the library will
 * continue using the original credentials until the process restarts.
 */
import { TRPCError } from '@trpc/server';
import { nanoid } from 'nanoid';
import webPush from 'web-push';

import { config } from '../config.js';
import type { PushSubscriptionRow } from '../db/openpath-repos/push-subscriptions.repo.js';
import {
  deleteSubscriptionByEndpoint,
  deleteSubscriptionOwnedBy,
  getSubscriptionsByUserId,
  getSubscriptionsForGroup,
  replaceSubscriptionByEndpoint,
} from '../db/openpath-repos/push-subscriptions.repo.js';
import { getApiCopy } from '../lib/api-content.js';
import { logger } from '../lib/logger.js';
import type { TenantProcedureContext } from '../trpc/tenant-procedure-helpers.js';
import { getAccessibleRequestGroupIds } from './request-shared.service.js';

export interface PushSubscriptionData {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface TenantPushSubscriptionRecord {
  id: string;
  userId: string;
  groupIds: string[];
  endpoint: string;
  userAgent: string;
  createdAt: string;
}

export interface TenantRequestNotification {
  id: string;
  domain: string;
  reason: string | null;
  requesterEmail: string;
  groupId: string | null;
}

let webPushConfigured = false;

function getVapidRuntimeConfig() {
  return {
    publicKey: config.vapidPublicKey,
    privateKey: config.vapidPrivateKey,
    contact: config.vapidContact,
  };
}

function configureWebPushIfAvailable(): boolean {
  const vapid = getVapidRuntimeConfig();
  const enabled = Boolean(vapid.publicKey && vapid.privateKey && vapid.contact);
  if (!enabled) return false;

  if (!webPushConfigured) {
    webPush.setVapidDetails(vapid.contact, vapid.publicKey, vapid.privateKey);
    webPushConfigured = true;
  }

  return true;
}

export function getTenantVapidPublicKey(): { publicKey: string; enabled: boolean } {
  const vapid = getVapidRuntimeConfig();
  return {
    publicKey: vapid.publicKey,
    enabled: Boolean(vapid.publicKey && vapid.privateKey && vapid.contact),
  };
}

async function normalizeTenantSubscriptionGroupIds(
  ctx: TenantProcedureContext,
  requestedGroupIds: string[] | undefined
): Promise<string[]> {
  const accessibleGroupIds = await getAccessibleRequestGroupIds(ctx);
  const accessible = new Set(accessibleGroupIds);
  const candidateGroupIds =
    requestedGroupIds && requestedGroupIds.length > 0 ? requestedGroupIds : accessibleGroupIds;
  const normalized = [
    ...new Set(candidateGroupIds.map((groupId) => groupId.trim()).filter(Boolean)),
  ];

  if (normalized.length === 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'No accessible groups available for push notifications',
    });
  }

  const forbidden = normalized.filter((groupId) => !accessible.has(groupId));
  if (forbidden.length > 0) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You can only subscribe to notifications for assigned groups',
    });
  }

  return normalized;
}

function serializePushSubscription(row: PushSubscriptionRow): TenantPushSubscriptionRecord {
  return {
    id: row.id,
    userId: row.userId,
    groupIds: row.groupIds,
    endpoint: row.endpoint,
    userAgent: row.userAgent ?? '',
    createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
  };
}

export async function saveTenantPushSubscription(params: {
  ctx: TenantProcedureContext;
  subscription: PushSubscriptionData;
  groupIds?: string[];
}): Promise<{ success: true; subscriptionId: string; groupIds: string[] }> {
  const groupIds = await normalizeTenantSubscriptionGroupIds(params.ctx, params.groupIds);

  const subscriptionId = `push_${nanoid(8)}`;
  await replaceSubscriptionByEndpoint({
    id: subscriptionId,
    userId: params.ctx.user.sub,
    groupIds,
    endpoint: params.subscription.endpoint,
    p256dh: params.subscription.keys.p256dh,
    auth: params.subscription.keys.auth,
    userAgent: params.ctx.req.get('user-agent') ?? '',
  });

  return { success: true, subscriptionId, groupIds };
}

export async function getTenantPushStatus(ctx: TenantProcedureContext): Promise<{
  pushEnabled: boolean;
  subscriptionCount: number;
  subscriptions: TenantPushSubscriptionRecord[];
}> {
  const rows = await getSubscriptionsByUserId(ctx.user.sub);

  return {
    pushEnabled: getTenantVapidPublicKey().enabled,
    subscriptionCount: rows.length,
    subscriptions: rows.map(serializePushSubscription),
  };
}

export async function deleteTenantPushSubscription(params: {
  ctx: TenantProcedureContext;
  endpoint?: string;
  subscriptionId?: string;
}): Promise<{ success: boolean }> {
  if (!params.endpoint && !params.subscriptionId) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'endpoint or subscriptionId is required',
    });
  }

  const deleted = await deleteSubscriptionOwnedBy({
    userId: params.ctx.user.sub,
    endpoint: params.endpoint,
    subscriptionId: params.subscriptionId,
  });

  return { success: deleted.length > 0 };
}

export async function notifyTenantTeachersOfNewRequest(
  request: TenantRequestNotification,
  options: { locale?: string | null } = {}
): Promise<{ sent: number; failed: number; disabled?: boolean; noSubscriptions?: boolean }> {
  if (!request.groupId) {
    return { sent: 0, failed: 0, noSubscriptions: true };
  }

  if (!configureWebPushIfAvailable()) {
    return { sent: 0, failed: 0, disabled: true };
  }

  const subscriptions = await getSubscriptionsForGroup(request.groupId);
  if (subscriptions.length === 0) {
    return { sent: 0, failed: 0, noSubscriptions: true };
  }

  const copy = getApiCopy(options.locale).push;
  const payload = {
    title: copy.newDomainRequestTitle,
    body: copy.newDomainRequestBody(request.domain),
    icon: '/icons/android-chrome-192x192.png',
    badge: '/icons/badge-96x96.png',
    data: {
      requestId: request.id,
      domain: request.domain,
      groupId: request.groupId,
      approvalUrl: `/domain-requests/approve/${encodeURIComponent(request.id)}`,
      url: `/domain-requests?highlight=${encodeURIComponent(request.id)}`,
    },
    actions: [{ action: 'approve', title: copy.approveAction }],
  };

  const results = await Promise.allSettled(
    subscriptions.map((subscription) =>
      webPush.sendNotification(
        {
          endpoint: subscription.endpoint,
          expirationTime: null,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth,
          },
        },
        JSON.stringify(payload)
      )
    )
  );

  let sent = 0;
  let failed = 0;

  for (const [index, result] of results.entries()) {
    if (result.status === 'fulfilled') {
      sent += 1;
      continue;
    }

    failed += 1;
    const reason = result.reason as { statusCode?: number; message?: string } | undefined;
    const subscription = subscriptions[index];
    if (reason?.statusCode === 410 && subscription) {
      await deleteSubscriptionByEndpoint(subscription.endpoint);
      continue;
    }

    logger.warn('Failed to send ClassroomPath push notification', {
      requestId: request.id,
      subscriptionId: subscription?.id,
      message: reason?.message,
    });
  }

  return { sent, failed };
}
