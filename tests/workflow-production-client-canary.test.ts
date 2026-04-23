import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { readProjectText, readProjectWorkflow } from './helpers/ops-contracts.ts';

describe('Production client update canary workflow contracts', () => {
  test('post-release production client update canary stays decoupled from deploy completion', () => {
    const workflowText = readProjectText('.github/workflows/production-client-update-canary.yml');
    const workflow = readProjectWorkflow('.github/workflows/production-client-update-canary.yml');
    const jobs = workflow.jobs ?? {};
    const windowsJob = jobs['windows-client-self-update-canary'];
    const linuxJob = jobs['linux-client-self-update-canary'];
    const workflowDispatchInputs = workflow.on?.workflow_dispatch?.inputs ?? {};

    assert.ok(workflow.on?.workflow_run?.workflows?.includes('Deploy'));
    assert.ok(workflow.on?.workflow_run?.types?.includes('completed'));
    assert.ok(workflowText.includes('workflow_dispatch:'));
    assert.equal(workflowDispatchInputs.target_platform?.default, 'both');
    assert.deepEqual(workflowDispatchInputs.target_platform?.options, ['both', 'linux', 'windows']);
    assert.ok(!workflowText.includes('workflow_call:'));
    assert.deepEqual(windowsJob?.['runs-on'], [
      'self-hosted',
      'Windows',
      'X64',
      'proxmox',
      'classroompath',
    ]);
    assert.equal(linuxJob?.['runs-on'], 'ubuntu-latest');
    assert.ok(workflowText.includes('Reset persistent Windows canary state'));
    assert.ok(workflowText.includes("Get-ScheduledTask -TaskName 'OpenPath-*'"));
    assert.ok(workflowText.includes("Remove-Item -LiteralPath 'C:\\OpenPath'"));
    assert.ok(workflowText.includes('Acrylic DNS Proxy'));
    assert.ok(
      workflowText.includes('Set-DnsClientServerAddress -InterfaceIndex $adapter.ifIndex') &&
        workflowText.includes("Set-DnsClientServerAddress -InterfaceAlias 'Ethernet'") &&
        workflowText.includes('Clear-DnsClientCache'),
      'Windows canary reset must restore external DNS after removing Acrylic/OpenPath'
    );
    assert.ok(workflowText.includes('create-production-windows-bootstrap-canary.mjs'));
    assert.ok(
      workflowText.includes('github_actions_remote_read_env_key') &&
        workflowText.includes('CP_CLIENT_CANARY_ADMIN_TOKEN') &&
        workflowText.includes('PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_STRIPE_WEBHOOK_SECRET') &&
        workflowText.includes('classroompath-production-release')
    );
    assert.ok(
      !workflowText.includes('Skip production client update canary when billing is manual-only')
    );
    assert.ok(workflowText.includes('client_canary_admin_token'));
    assert.ok(workflowText.includes('PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_BILLING_MODE'));
    assert.ok(workflowText.includes('Write Windows client canary evidence'));
    assert.ok(workflowText.includes('Write Linux client canary evidence'));
    assert.ok(workflowText.includes('Verify Linux Firefox blocked page canary'));
    assert.ok(workflowText.includes('production-client-canary-evidence-windows.json'));
    assert.ok(workflowText.includes('production-client-canary-evidence-linux.json'));
    assert.ok(workflowText.includes('production-linux-firefox-block-page-canary.json'));
    assert.ok(workflowText.includes('live-tested'));
    assert.ok(workflowText.includes('failed'));
    assert.ok(
      workflowText.includes('OpenPath.ps1') && workflowText.includes('self-update --silent')
    );
    assert.ok(workflowText.includes('config.json') && workflowText.includes('lastAgentUpdateAt'));
    assert.ok(
      workflowText.includes('/api/enroll/$CLASSROOM_ID') &&
        workflowText.includes('sudo bash "$enroll_script" 2>&1 | tee -a "$enrollment_log"')
    );
    assert.ok(workflowText.includes('/usr/local/bin/openpath-agent-update.sh --force'));
    assert.ok(workflowText.includes('openpath-agent-update.timer'));
    assert.ok(workflowText.includes('scripts/linux-firefox-block-page-canary.mjs'));
    assert.ok(
      String(windowsJob?.if ?? '').includes("github.event.workflow_run.conclusion == 'success'")
    );
    assert.ok(
      String(linuxJob?.if ?? '').includes("github.event.workflow_run.conclusion == 'success'")
    );
    assert.ok(
      String(windowsJob?.if ?? '').includes("github.event.inputs.target_platform != 'linux'"),
      'Manual Linux-only production canary runs must not wait for the Windows runner'
    );
    assert.ok(
      String(linuxJob?.if ?? '').includes("github.event.inputs.target_platform != 'windows'"),
      'Manual Windows-only production canary runs must not consume Linux runner time'
    );
  });

  test('production client canary artifact archives are required and uploads are best effort', () => {
    const workflow = readProjectWorkflow('.github/workflows/production-client-update-canary.yml');
    const jobs = workflow.jobs ?? {};

    for (const [jobName, platform, shell, logFile, archiveFile, archiveCommand] of [
      [
        'windows-client-self-update-canary',
        'Windows',
        'pwsh',
        'windows-client-self-update.log',
        'production-windows-client-self-update-canary.zip',
        'Compress-Archive',
      ],
      [
        'linux-client-self-update-canary',
        'Linux',
        'bash',
        'linux-client-self-update.log',
        'production-linux-client-self-update-canary.tar.gz',
        'tar -czf',
      ],
    ] as const) {
      const job = jobs[jobName];
      const ensureStepIndex =
        job?.steps?.findIndex((step) =>
          String(step.name ?? '').includes(`Ensure ${platform} self-update artifact files`)
        ) ?? -1;
      const uploadStepIndex =
        job?.steps?.findIndex((step) =>
          String(step.name ?? '').includes(`Upload ${platform} self-update artifacts`)
        ) ?? -1;
      const restoreDnsStepIndex =
        platform === 'Windows'
          ? (job?.steps?.findIndex((step) =>
              String(step.name ?? '').includes('Restore Windows runner DNS before artifact upload')
            ) ?? -1)
          : -1;
      const uploadStep = uploadStepIndex >= 0 ? job?.steps?.[uploadStepIndex] : undefined;
      const checkoutStep = job?.steps?.find((step) => step.name === 'Checkout');
      const ensureStep = ensureStepIndex >= 0 ? job?.steps?.[ensureStepIndex] : undefined;
      const restoreDnsStep =
        restoreDnsStepIndex >= 0 ? job?.steps?.[restoreDnsStepIndex] : undefined;

      assert.equal(job?.['timeout-minutes'], 35, `${jobName} must not hang indefinitely`);
      assert.equal(checkoutStep?.with?.['persist-credentials'], false);
      assert.ok(ensureStepIndex >= 0, `${jobName} must create missing log artifacts`);
      assert.ok(
        ensureStepIndex < uploadStepIndex,
        `${jobName} must create missing log artifacts before upload`
      );
      if (platform === 'Windows') {
        assert.ok(
          ensureStepIndex < restoreDnsStepIndex && restoreDnsStepIndex < uploadStepIndex,
          'Windows canary should restore runner DNS after functional evidence and before artifact upload'
        );
        assert.equal(restoreDnsStep?.if, 'always()');
        assert.equal(restoreDnsStep?.['continue-on-error'], true);
        assert.ok(
          String(restoreDnsStep?.run ?? '').includes('Set-DnsClientServerAddress') &&
            String(restoreDnsStep?.run ?? '').includes('Clear-DnsClientCache')
        );
      }
      assert.equal(
        job?.steps?.some((step) =>
          String(step.name ?? '').includes(`Retry ${platform} self-update artifact upload`)
        ),
        false,
        `${jobName} must not hang on artifact-service transport retries`
      );
      assert.equal(ensureStep?.if, 'always()');
      assert.equal(ensureStep?.shell, shell);
      assert.ok(String(ensureStep?.run ?? '').includes(logFile));
      assert.ok(String(ensureStep?.run ?? '').includes(archiveFile));
      assert.ok(String(ensureStep?.run ?? '').includes(archiveCommand));
      assert.equal(uploadStep?.uses, 'actions/upload-artifact@v7');
      assert.equal(
        uploadStep?.['continue-on-error'],
        true,
        `${jobName} artifact transport failures must not mask functional canary results`
      );
      assert.equal(uploadStep?.['timeout-minutes'], 10);
      assert.equal(uploadStep?.with?.path, archiveFile);
      assert.equal(uploadStep?.with?.['if-no-files-found'], 'error');
      assert.equal(uploadStep?.with?.['retention-days'], 14);
      assert.equal(uploadStep?.with?.overwrite, true);
    }

    const linuxEnsureStep = jobs['linux-client-self-update-canary']?.steps?.find((step) =>
      String(step.name ?? '').includes('Ensure Linux self-update artifact files')
    );
    assert.ok(
      String(linuxEnsureStep?.run ?? '').includes('linux-client-enrollment.log'),
      'Linux canary artifacts must include the live enrollment log'
    );
    assert.ok(
      String(linuxEnsureStep?.run ?? '').includes('linux-client-enrollment-download.json'),
      'Linux canary artifacts must include enrollment download diagnostics'
    );
    assert.ok(
      String(linuxEnsureStep?.run ?? '').includes('linux-client-enrollment-download.headers'),
      'Linux canary artifacts must include enrollment download headers'
    );
    assert.ok(
      String(linuxEnsureStep?.run ?? '').includes('linux-client-enrollment-download.body'),
      'Linux canary artifacts must include enrollment download body'
    );
    assert.ok(
      String(linuxEnsureStep?.run ?? '').includes(
        'production-linux-firefox-block-page-canary.json'
      ),
      'Linux canary artifacts must include Firefox blocked-page evidence'
    );
    assert.ok(
      String(linuxEnsureStep?.run ?? '').includes('linux-firefox-block-page-canary.log'),
      'Linux canary artifacts must include Firefox blocked-page diagnostics'
    );
  });

  test('linux enrollment canary retries transient registration failures', () => {
    const workflow = readProjectWorkflow('.github/workflows/production-client-update-canary.yml');
    const linuxJob = workflow.jobs?.['linux-client-self-update-canary'];
    const enrollmentStep = linuxJob?.steps?.find((step) =>
      String(step.name ?? '').includes('Download and run live Linux enrollment script')
    );
    const enrollmentScript = String(enrollmentStep?.run ?? '');

    assert.ok(enrollmentStep, 'Linux enrollment step must exist');
    assert.ok(
      enrollmentScript.includes('for attempt in 1 2 3'),
      'Linux enrollment should retry transient setup failures'
    );
    assert.ok(
      enrollmentScript.includes('linux-client-enrollment-download.json') &&
        enrollmentScript.includes('Linux enrollment script download returned HTTP $http_status'),
      'Linux enrollment should persist HTTP diagnostics when script download fails'
    );
    assert.ok(
      enrollmentScript.includes('body.slice(0, 4000)'),
      'Linux enrollment diagnostics should include a bounded response body preview'
    );
    assert.ok(
      enrollmentScript.includes('Linux enrollment attempt $attempt failed'),
      'Linux enrollment should log retry attempts'
    );
    assert.ok(
      /if sudo bash "\$enroll_script" 2>&1 \| tee -a "\$enrollment_log"; then[\s\S]*else\s+enrollment_status="\$\{PIPESTATUS\[0\]\}"/m.test(
        enrollmentScript
      ),
      'Linux enrollment should preserve the enrollment command status while teeing diagnostics'
    );
    assert.ok(
      enrollmentScript.includes('linux-client-enrollment.log'),
      'Linux enrollment should persist its output for failed canary diagnosis'
    );
    assert.ok(
      enrollmentScript.includes('exit "$enrollment_status"'),
      'Linux enrollment should preserve final setup failure status'
    );
  });

  test('linux client canary verifies Firefox renders the extension blocked page', () => {
    const workflow = readProjectWorkflow('.github/workflows/production-client-update-canary.yml');
    const linuxJob = workflow.jobs?.['linux-client-self-update-canary'];
    const firefoxStepIndex =
      linuxJob?.steps?.findIndex(
        (step) => step.name === 'Verify Linux Firefox blocked page canary'
      ) ?? -1;
    const enrollmentStepIndex =
      linuxJob?.steps?.findIndex((step) =>
        String(step.name ?? '').includes('Download and run live Linux enrollment script')
      ) ?? -1;
    const evidenceStepIndex =
      linuxJob?.steps?.findIndex((step) =>
        String(step.name ?? '').includes('Write Linux client canary evidence')
      ) ?? -1;
    const dependencyStepIndex =
      linuxJob?.steps?.findIndex((step) =>
        String(step.name ?? '').includes('Install Linux Firefox canary dependencies')
      ) ?? -1;
    const firefoxStep = firefoxStepIndex >= 0 ? linuxJob?.steps?.[firefoxStepIndex] : undefined;
    const dependencyStep =
      dependencyStepIndex >= 0 ? linuxJob?.steps?.[dependencyStepIndex] : undefined;
    const firefoxScript = readProjectText('scripts/linux-firefox-block-page-canary.mjs');

    assert.ok(firefoxStep, 'Linux canary must exercise Firefox blocked-page rendering');
    assert.ok(
      enrollmentStepIndex >= 0 && enrollmentStepIndex < firefoxStepIndex,
      'Firefox blocked-page canary must run after live enrollment installs the client'
    );
    assert.ok(
      dependencyStepIndex >= 0 && dependencyStepIndex < firefoxStepIndex,
      'Firefox blocked-page canary must install npm dependencies before loading selenium-webdriver'
    );
    assert.ok(
      firefoxStepIndex < evidenceStepIndex,
      'Firefox blocked-page canary must run before Linux evidence is written'
    );
    assert.equal(dependencyStep?.shell, 'bash');
    assert.ok(String(dependencyStep?.run ?? '').includes('npm ci --ignore-scripts'));
    assert.equal(firefoxStep?.shell, 'bash');
    assert.ok(String(firefoxStep?.run ?? '').includes('linux-firefox-block-page-canary.mjs'));
    assert.ok(String(firefoxStep?.env?.EXPECTED_EXTENSION_ID ?? '').includes('extension_id'));
    assert.ok(
      String(firefoxStep?.env?.LINUX_FIREFOX_BLOCK_PAGE_CANARY_URL ?? '').includes(
        'www.mozilla.org'
      ),
      'Linux Firefox canary should use a real resolvable domain outside the seeded whitelist'
    );

    assert.ok(firefoxScript.includes('selenium-webdriver'));
    assert.ok(firefoxScript.includes('monitor-bloqueos@openpath'));
    assert.ok(firefoxScript.includes('/blocked/blocked.html'));
    assert.ok(
      firefoxScript.includes('getOpenPathDiagnostics'),
      'Linux Firefox canary should query extension/native diagnostics before navigating'
    );
    assert.ok(
      firefoxScript.includes('whitelist_native_host.json'),
      'Linux Firefox canary should report native host manifest state inline'
    );
    assert.ok(
      firefoxScript.includes('writeInlineDiagnosticsSummary'),
      'Linux Firefox canary should print enough diagnostics before artifact upload'
    );
    assert.ok(firefoxScript.includes('production-linux-firefox-block-page-canary.json'));
    assert.ok(firefoxScript.includes('LINUX_FIREFOX_BLOCK_PAGE_CANARY_URL'));
    assert.ok(firefoxScript.includes('::error title=Linux Firefox blocked-page canary::'));
  });

  test('production provisioning helper supports Stripe and manual-only live canary activation', () => {
    const scriptText = readProjectText('scripts/create-production-windows-bootstrap-canary.mjs');

    assert.ok(scriptText.includes('PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_BILLING_MODE'));
    assert.ok(scriptText.includes('billing.createCheckout'));
    assert.ok(scriptText.includes('/cp/stripe/webhook'));
    assert.ok(scriptText.includes('billing.createManualRequest'));
    assert.ok(
      scriptText.includes('/cp/internal/client-canary/manual-request/') &&
        scriptText.includes('/approve')
    );
    assert.ok(scriptText.includes('PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_ADMIN_TOKEN'));
    assert.ok(scriptText.includes('billingMode'));
    assert.ok(scriptText.includes('::add-mask::'));
    assert.ok(scriptText.includes('maskGithubSecret(ticketPayload.enrollmentToken)'));
  });
});
