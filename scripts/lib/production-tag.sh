#!/usr/bin/env bash
# Shared exact-identity handling for production tags.
# shellcheck shell=bash

# Inputs:
#   PRODUCTION_TAG_NAME
#   PRODUCTION_TAG_TARGET_SHA
#   PRODUCTION_TAG_RELEASE_ID
#   PRODUCTION_TAG_RC_RUN_ID
#   PRODUCTION_TAG_CLASSROOMPATH_SHA
#
# Output:
#   PRODUCTION_TAG_EXISTING_STATE = absent|local-only|local-and-remote
#
# An existing tag is idempotent only when it is annotated, points at the exact
# target commit, and carries the exact Release Bundle identity. Any other
# existing local or remote tag is a conflict.
production_tag_reconcile_existing() {
  local tag_name="${PRODUCTION_TAG_NAME:?}"
  local target_sha="${PRODUCTION_TAG_TARGET_SHA:?}"
  local release_id="${PRODUCTION_TAG_RELEASE_ID:?}"
  local rc_run_id="${PRODUCTION_TAG_RC_RUN_ID:?}"
  local classroompath_sha="${PRODUCTION_TAG_CLASSROOMPATH_SHA:?}"
  local tag_ref="refs/tags/$tag_name"
  local local_tag_oid=""
  local remote_tag_oid=""
  local object_type=""
  local tagged_commit=""
  local message_file=""

  local_tag_oid="$(git rev-parse -q --verify "$tag_ref" 2>/dev/null || true)"
  local remote_tags_output=""

  if ! remote_tags_output="$(git ls-remote --tags --refs origin "$tag_ref" 2>/dev/null)"; then
    die "Unable to inspect origin tag $tag_name; refusing to reconcile" 1
  fi
  remote_tag_oid="$(printf '%s\n' "$remote_tags_output" | awk 'NR == 1 { print $1 }')"

  if [ -z "$local_tag_oid" ] && [ -z "$remote_tag_oid" ]; then
    PRODUCTION_TAG_EXISTING_STATE=absent
    return 0
  fi

  if [ -z "$local_tag_oid" ] && [ -n "$remote_tag_oid" ]; then
    git fetch --no-tags origin "$tag_ref:$tag_ref" >/dev/null
    local_tag_oid="$(git rev-parse -q --verify "$tag_ref" 2>/dev/null || true)"
  fi

  if [ -n "$remote_tag_oid" ] && [ "$local_tag_oid" != "$remote_tag_oid" ]; then
    die "Production tag $tag_name differs between local and origin; refusing to reconcile" 1
  fi

  object_type="$(git cat-file -t "$tag_ref" 2>/dev/null || true)"
  if [ "$object_type" != "tag" ]; then
    die "Production tag $tag_name is not an annotated tag; refusing to overwrite it" 1
  fi

  tagged_commit="$(git rev-parse "$tag_ref^{commit}" 2>/dev/null || true)"
  if [ "$tagged_commit" != "$target_sha" ]; then
    die "Production tag $tag_name points at $tagged_commit, expected $target_sha" 1
  fi

  message_file="$(mktemp)"
  git for-each-ref "$tag_ref" --format='%(contents)' > "$message_file"
  if ! node scripts/promotion-evidence-cli.mjs verify-tag-identity \
    --message-file "$message_file" \
    --release-id "$release_id" \
    --rc-run-id "$rc_run_id" \
    --classroompath-sha "$classroompath_sha"; then
    rm -f "$message_file"
    die "Production tag $tag_name has a conflicting Release Bundle identity" 1
  fi
  rm -f "$message_file"

  if [ -n "$remote_tag_oid" ]; then
    PRODUCTION_TAG_EXISTING_STATE=local-and-remote
  else
    PRODUCTION_TAG_EXISTING_STATE=local-only
  fi
  export PRODUCTION_TAG_EXISTING_STATE
}
