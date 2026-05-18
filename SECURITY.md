# Security Policy

ClassroomPath touches school, tenant, authentication, billing, and deployment-sensitive areas. Do
not open public issues for suspected vulnerabilities.

## Reporting

Use GitHub private vulnerability reporting or a private security advisory for suspected
vulnerabilities. Include a concise description, affected area, reproduction steps where safe, and
the security impact. Do not include real secrets, tokens, hostnames, private infrastructure names,
student data, tenant data, or operational credentials.

## Supported Scope

Security review may cover ClassroomPath-owned source, tenant isolation behavior, authentication and
session boundaries, billing control flow, deployment-sensitive configuration handling, and the
ClassroomPath wrapper around OpenPath.

OpenPath core issues should be reported through the OpenPath project unless the finding depends on
ClassroomPath-specific wrapper or managed-service behavior.

## Operational Expectations

- Keep real deployment targets, secrets, credentials, infrastructure details, and production
  runbooks outside the public repository.
- Use private configuration for local deployment evaluation.
- Rotate any credential that may have been exposed in source, issues, logs, artifacts, packages, or
  public communication.
- Review workflow logs, release artifacts, package metadata, and repository history separately from
  current-file cleanup.
