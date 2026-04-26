import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { readProjectText, readProjectWorkflow } from './helpers/ops-contracts.ts';

const windowsRunnerDnsActionPath = '.github/actions/restore-windows-runner-dns/action.yml';

describe('Production client update canary workflow contracts', () => {
  test('Windows canaries share the runner DNS restoration action', () => {
    const actionText = readProjectText(windowsRunnerDnsActionPath);

    assert.ok(actionText.includes('Set-DnsClientServerAddress'));
    assert.ok(actionText.includes('Clear-DnsClientCache'));
    assert.ok(actionText.includes('Test-NetConnection github.com -Port 443'));

    for (const [workflowPath, jobName] of [
      [
        '.github/workflows/production-client-update-canary.yml',
        'windows-client-self-update-canary',
      ],
      [
        '.github/workflows/windows-production-bootstrap-canary.yml',
        'windows-production-bootstrap-canary',
      ],
    ] as const) {
      const workflow = readProjectWorkflow(workflowPath);
      const steps = workflow.jobs?.[jobName]?.steps ?? [];
      const resetDnsStep = steps.find(
        (step) => step.name === 'Restore Windows runner DNS after reset'
      );
      const checkoutStepIndex = steps.findIndex((step) => step.name === 'Checkout');
      const preCheckoutDnsStepIndex = steps.findIndex(
        (step) => step.name === 'Restore Windows runner DNS before checkout'
      );
      const preCheckoutDnsStep =
        preCheckoutDnsStepIndex >= 0 ? steps[preCheckoutDnsStepIndex] : undefined;
      const artifactDnsStep = steps.find((step) =>
        String(step.name ?? '').includes('Restore Windows runner DNS before artifact upload')
      );

      assert.ok(
        preCheckoutDnsStepIndex >= 0 &&
          checkoutStepIndex >= 0 &&
          preCheckoutDnsStepIndex < checkoutStepIndex,
        `${workflowPath} must restore DNS before checkout because local actions are unavailable before checkout`
      );
      assert.equal(preCheckoutDnsStep?.shell, 'pwsh');
      assert.match(String(preCheckoutDnsStep?.run ?? ''), /Set-DnsClientServerAddress/);
      assert.match(String(preCheckoutDnsStep?.run ?? ''), /Clear-DnsClientCache/);
      assert.match(
        String(preCheckoutDnsStep?.run ?? ''),
        /Test-NetConnection github\.com -Port 443/
      );
      assert.equal(resetDnsStep?.uses, './.github/actions/restore-windows-runner-dns');
      assert.equal(artifactDnsStep?.uses, './.github/actions/restore-windows-runner-dns');
      assert.equal(artifactDnsStep?.if, 'always()');
      assert.equal(artifactDnsStep?.['continue-on-error'], true);
    }
  });

  test('scheduled production enrollment download canary checks live scripts without consuming client runners', () => {
    const workflowText = readProjectText('.github/workflows/production-client-update-canary.yml');
    const helperText = readProjectText('scripts/production-enrollment-download-canary.mjs');
    const workflow = readProjectWorkflow('.github/workflows/production-client-update-canary.yml');
    const jobs = workflow.jobs ?? {};
    const downloadJob = jobs['production-enrollment-download-canary'];
    const existingWindowsJob = jobs['windows-client-self-update-canary'];
    const existingLinuxJob = jobs['linux-client-self-update-canary'];

    assert.ok(
      workflow.on?.schedule?.some((entry) => entry.cron === '*/15 * * * *'),
      'production enrollment download canary should run every 15 minutes'
    );
    assert.equal(downloadJob?.['runs-on'], 'ubuntu-latest');
    assert.ok(
      String(existingWindowsJob?.if ?? '').includes("github.event_name != 'schedule'"),
      'scheduled download checks must not consume the persistent Windows runner'
    );
    assert.ok(
      String(existingWindowsJob?.if ?? '').includes(
        "github.event.inputs.target_platform != 'download'"
      ),
      'manual download-only canary runs must not consume the persistent Windows runner'
    );
    assert.ok(
      String(existingLinuxJob?.if ?? '').includes("github.event_name != 'schedule'"),
      'scheduled download checks must not run the full Linux install canary'
    );
    assert.ok(
      String(existingLinuxJob?.if ?? '').includes(
        "github.event.inputs.target_platform != 'download'"
      ),
      'manual download-only canary runs must not run the full Linux install canary'
    );
    assert.ok(workflowText.includes('scripts/production-enrollment-download-canary.mjs'));
    assert.ok(workflowText.includes('production-enrollment-download-canary.json'));
    assert.ok(workflowText.includes('production-enrollment-download-canary'));
    assert.ok(helperText.includes('/api/enroll/'));
    assert.ok(helperText.includes('/windows.ps1'));
    assert.ok(workflowText.includes('Production Enrollment Download Canary Failed'));
    assert.ok(workflowText.includes('close-smoke-recovery.mjs'));
    assert.ok(workflowText.includes('Read production Linux enrollment runtime'));
    assert.ok(workflowText.includes('OPENPATH_LINUX_AGENT_VERSION'));
    assert.ok(
      workflowText.includes(
        'OPENPATH_LINUX_AGENT_VERSION: ${{ steps.read-linux-runtime.outputs.linux_agent_version }}'
      ),
      'download canary should validate the production Linux runtime pin, not the Windows bootstrap manifest version'
    );
    assert.ok(
      !workflowText.includes(
        'OPENPATH_LINUX_AGENT_VERSION: ${{ steps.provision.outputs.bootstrap_manifest_version }}'
      ),
      'Windows bootstrap manifest versions must not be used as Linux package pins'
    );
  });

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
    assert.deepEqual(workflowDispatchInputs.target_platform?.options, [
      'both',
      'download',
      'linux',
      'windows',
    ]);
    assert.ok(!workflowText.includes('workflow_call:'));
    assert.deepEqual(windowsJob?.['runs-on'], [
      'self-hosted',
      'Windows',
      'X64',
      'proxmox',
      'classroompath',
    ]);
    assert.deepEqual(linuxJob?.['runs-on'], [
      'self-hosted',
      'Linux',
      'X64',
      'proxmox',
      'classroompath',
    ]);
    assert.ok(workflowText.includes('Reset persistent Windows canary state'));
    assert.ok(workflowText.includes('Reset persistent Linux canary state'));
    assert.ok(workflowText.includes("Get-ScheduledTask -TaskName 'OpenPath-*'"));
    assert.ok(workflowText.includes("Remove-Item -LiteralPath 'C:\\OpenPath'"));
    assert.ok(workflowText.includes('Acrylic DNS Proxy'));
    assert.ok(
      workflowText.includes('Restore Windows runner DNS after reset') &&
        workflowText.includes('./.github/actions/restore-windows-runner-dns'),
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
        workflowText.includes(
          'sudo timeout --kill-after=30s 10m bash "$enroll_script" 2>&1 | tee -a "$enrollment_log"'
        )
    );
    assert.ok(workflowText.includes('/usr/local/bin/openpath-agent-update.sh --force'));
    assert.ok(workflowText.includes('openpath-agent-update.timer'));
    assert.ok(workflowText.includes('/usr/local/lib/openpath/uninstall.sh --auto-yes'));
    assert.ok(workflowText.includes('sudo apt-get purge -y openpath-dnsmasq'));
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
        job?.steps?.findIndex((step) =>
          String(step.name ?? '').includes(`Restore ${platform} runner DNS before artifact upload`)
        ) ?? -1;
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
      assert.ok(
        ensureStepIndex < restoreDnsStepIndex && restoreDnsStepIndex < uploadStepIndex,
        `${platform} canary should restore runner DNS after functional evidence and before artifact upload`
      );
      assert.equal(restoreDnsStep?.if, 'always()');
      assert.equal(restoreDnsStep?.['continue-on-error'], true);
      if (platform === 'Windows') {
        assert.equal(restoreDnsStep?.uses, './.github/actions/restore-windows-runner-dns');
      } else {
        assert.ok(
          String(restoreDnsStep?.run ?? '').includes('sudo openpath disable') &&
            String(restoreDnsStep?.run ?? '').includes('sudo systemctl stop dnsmasq') &&
            String(restoreDnsStep?.run ?? '').includes(
              '/usr/local/lib/openpath/uninstall.sh --auto-yes'
            ) &&
            String(restoreDnsStep?.run ?? '').includes('sudo apt-get purge -y openpath-dnsmasq')
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
      enrollmentScript.includes('systemctl status dnsmasq') &&
        enrollmentScript.includes('journalctl -u dnsmasq') &&
        enrollmentScript.includes('dnsmasq --test') &&
        enrollmentScript.includes('ss -tulpn'),
      'Linux enrollment should capture dnsmasq diagnostics before retrying or failing'
    );
    assert.ok(
      /if sudo timeout --kill-after=30s 10m bash "\$enroll_script" 2>&1 \| tee -a "\$enrollment_log"; then[\s\S]*else\s+enrollment_status="\$\{PIPESTATUS\[0\]\}"/m.test(
        enrollmentScript
      ),
      'Linux enrollment should hard-bound the root installer process tree while teeing diagnostics'
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

  test('linux canary repairs persistent runner DNS before live enrollment', () => {
    const workflow = readProjectWorkflow('.github/workflows/production-client-update-canary.yml');
    const linuxJob = workflow.jobs?.['linux-client-self-update-canary'];
    const steps = linuxJob?.steps ?? [];
    const resetStepIndex = steps.findIndex((step) =>
      String(step.name ?? '').includes('Reset persistent Linux canary state')
    );
    const dependencyStepIndex = steps.findIndex((step) =>
      String(step.name ?? '').includes('Install Linux Firefox canary dependencies')
    );
    const dnsHealthStepIndex = steps.findIndex(
      (step) => step.name === 'Verify Linux runner DNS before enrollment'
    );
    const enrollmentStepIndex = steps.findIndex((step) =>
      String(step.name ?? '').includes('Download and run live Linux enrollment script')
    );
    const restoreStepIndex = steps.findIndex((step) =>
      String(step.name ?? '').includes('Restore Linux runner DNS before artifact upload')
    );
    const resetScript = String(steps[resetStepIndex]?.run ?? '');
    const dnsHealthScript = String(steps[dnsHealthStepIndex]?.run ?? '');
    const restoreScript = String(steps[restoreStepIndex]?.run ?? '');

    assert.ok(resetStepIndex >= 0, 'Linux canary reset step must exist');
    assert.ok(dnsHealthStepIndex >= 0, 'Linux canary must verify runner DNS before enrollment');
    assert.ok(restoreStepIndex >= 0, 'Linux canary restore step must exist');
    assert.ok(
      resetStepIndex < dnsHealthStepIndex &&
        dnsHealthStepIndex < dependencyStepIndex &&
        dependencyStepIndex < enrollmentStepIndex,
      'Linux canary must repair and verify runner DNS before network-dependent setup and live enrollment'
    );

    for (const [label, script] of [
      ['reset', resetScript],
      ['restore', restoreScript],
    ] as const) {
      assert.ok(
        script.includes('sudo systemctl reset-failed dnsmasq'),
        `${label} step must clear dnsmasq start-limit-hit state`
      );
      assert.ok(
        script.includes('/etc/systemd/system/dnsmasq.service.d/openpath-override.conf') &&
          script.includes('/etc/systemd/system/dnsmasq.service.d/whitelist-override.conf') &&
          script.includes('/etc/dnsmasq.d/openpath.conf'),
        `${label} step must remove stale OpenPath dnsmasq overrides`
      );
      assert.ok(
        script.includes('restore_linux_canary_external_dns'),
        `${label} step must restore external DNS after OpenPath cleanup`
      );
      assert.ok(
        script.includes('sudo systemctl daemon-reload'),
        `${label} step must reload systemd after removing dnsmasq drop-ins`
      );
    }

    assert.ok(
      dnsHealthScript.includes('raw.githubusercontent.com') &&
        dnsHealthScript.includes('getent hosts') &&
        dnsHealthScript.includes('Linux canary runner DNS is not healthy before enrollment'),
      'Linux canary should fail with explicit DNS diagnostics before downloading enrollment scripts'
    );
    assert.ok(
      dnsHealthScript.includes('/etc/resolv.conf') &&
        dnsHealthScript.includes('systemctl status dnsmasq'),
      'Linux canary DNS health failure should include resolver and dnsmasq diagnostics'
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
    const resetStepIndex =
      linuxJob?.steps?.findIndex((step) =>
        String(step.name ?? '').includes('Reset persistent Linux canary state')
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
      resetStepIndex >= 0 && resetStepIndex < enrollmentStepIndex,
      'persistent Linux canary runner must be reset before live enrollment mutates it'
    );
    assert.ok(
      firefoxStepIndex < evidenceStepIndex,
      'Firefox blocked-page canary must run before Linux evidence is written'
    );
    assert.equal(dependencyStep?.shell, 'bash');
    assert.ok(String(dependencyStep?.run ?? '').includes('npm ci --ignore-scripts'));
    assert.equal(firefoxStep?.shell, 'bash');
    assert.ok(String(firefoxStep?.run ?? '').includes('linux-firefox-block-page-canary.mjs'));
    assert.ok(
      String(firefoxStep?.run ?? '').includes('timeout --kill-after=30s'),
      'Linux Firefox blocked-page canary must have an external watchdog timeout'
    );
    assert.ok(
      String(firefoxStep?.run ?? '').includes('PIPESTATUS[0]'),
      'Linux Firefox blocked-page canary must preserve the node exit status through tee'
    );
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
      firefoxScript.includes("setPageLoadStrategy('none')"),
      'Linux Firefox canary must not depend on Marionette normal page-load completion for moz-extension pages'
    );
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
    assert.ok(scriptText.includes("'auth.refresh'"));
    assert.ok(scriptText.includes("'onboarding.status'"));
    assert.ok(scriptText.includes('fallback relogin teacher'));
    assert.ok(
      scriptText.includes('ajax-auto-allow-origin.127.0.0.1.sslip.io'),
      'production Windows bootstrap canary should seed the AJAX origin in the initial whitelist'
    );
    assert.ok(scriptText.includes('billingMode'));
    assert.ok(scriptText.includes('::add-mask::'));
    assert.ok(scriptText.includes('maskGithubSecret(ticketPayload.enrollmentToken)'));
    assert.ok(scriptText.includes('sanitizeSummaryForArtifact'));
    assert.ok(scriptText.includes("enrollmentToken: summary.enrollmentToken ? '[redacted]' : ''"));
    assert.ok(scriptText.includes('enrollment_token: summary.enrollmentToken'));
  });

  test('windows production bootstrap canary proves AJAX auto-allow on manual-only production', () => {
    const workflowText = readProjectText(
      '.github/workflows/windows-production-bootstrap-canary.yml'
    );
    const workflow = readProjectWorkflow(
      '.github/workflows/windows-production-bootstrap-canary.yml'
    );
    const job = workflow.jobs?.['windows-production-bootstrap-canary'];
    const steps = job?.steps ?? [];
    const provisionStep = steps.find(
      (step) => step.name === 'Provision production enrollment canary'
    );
    const installStepIndex = steps.findIndex((step) =>
      String(step.name ?? '').includes('Re-run Update-OpenPath.ps1')
    );
    const ajaxStepIndex = steps.findIndex(
      (step) => step.name === 'Verify Windows AJAX auto-allow canary'
    );
    const uploadStepIndex = steps.findIndex((step) =>
      String(step.name ?? '').includes('Upload production bootstrap canary artifacts')
    );
    const restoreDnsStepIndex = steps.findIndex((step) =>
      String(step.name ?? '').includes('Restore Windows runner DNS before artifact upload')
    );
    const ajaxStep = ajaxStepIndex >= 0 ? steps[ajaxStepIndex] : undefined;
    const ajaxScript = String(ajaxStep?.run ?? '');
    const resetStep = steps.find((step) => step.name === 'Reset persistent Windows canary state');
    const ajaxCanaryScript = readProjectText('scripts/windows-ajax-auto-allow-canary.mjs');

    assert.ok(
      workflow.on?.workflow_call,
      'Windows bootstrap canary should be reusable from deploy'
    );
    assert.equal(
      workflow.on.workflow_call.outputs?.canary_result?.value,
      '${{ jobs.windows-production-bootstrap-canary.outputs.canary_result }}'
    );
    assert.ok(!workflowText.includes('Skip bootstrap canary when production is manual-only'));
    assert.ok(workflowText.includes('Read production client canary admin token'));
    assert.ok(workflowText.includes('PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_ADMIN_TOKEN'));
    assert.ok(resetStep, 'Windows bootstrap canary must reset persistent state');
    assert.equal(
      steps.find((step) => step.name === 'Restore Windows runner DNS after reset')?.uses,
      './.github/actions/restore-windows-runner-dns'
    );
    assert.ok(
      String(provisionStep?.env?.PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_BILLING_MODE ?? '').includes(
        'steps.read-billing-mode.outputs.billing_mode'
      ),
      'production bootstrap canary should exercise manual_only via the provisioning helper'
    );
    assert.ok(ajaxStep, 'Windows bootstrap canary must include an AJAX auto-allow proof');
    assert.ok(
      installStepIndex >= 0 && installStepIndex < ajaxStepIndex && ajaxStepIndex < uploadStepIndex,
      'AJAX proof should run after live Windows enrollment/Firefox install and before artifacts'
    );
    assert.ok(
      ajaxStepIndex < restoreDnsStepIndex && restoreDnsStepIndex < uploadStepIndex,
      'Windows bootstrap canary should restore runner DNS before uploading artifacts'
    );
    assert.equal(ajaxStep?.shell, 'pwsh');
    assert.ok(ajaxScript.includes('node scripts/windows-ajax-auto-allow-canary.mjs'));
    assert.ok(ajaxCanaryScript.includes('ajax-auto-allow-origin.127.0.0.1.sslip.io'));
    assert.ok(ajaxCanaryScript.includes('ajax-auto-allow-target.127.0.0.1.sslip.io'));
    assert.ok(
      ajaxCanaryScript.includes('ajax-auto-allow-asset.127.0.0.1.sslip.io'),
      'Windows AJAX canary must cover non-XHR page subresources'
    );
    assert.ok(
      ajaxCanaryScript.includes('ajax-auto-allow-script.127.0.0.1.sslip.io'),
      'Windows AJAX canary must cover script subresources'
    );
    assert.ok(
      ajaxCanaryScript.includes('ajax-auto-allow-stylesheet.127.0.0.1.sslip.io'),
      'Windows AJAX canary must cover stylesheet subresources'
    );
    assert.ok(ajaxCanaryScript.includes('Access-Control-Allow-Origin'));
    assert.ok(ajaxCanaryScript.includes('fetch('));
    assert.ok(ajaxCanaryScript.includes('new Image()'));
    assert.ok(ajaxCanaryScript.includes("document.createElement('script')"));
    assert.ok(ajaxCanaryScript.includes("document.createElement('link')"));
    assert.ok(
      ajaxCanaryScript.includes('waitForFirefoxExtensionReady'),
      'Windows AJAX canary must warm the same Firefox profile before navigating'
    );
    assert.ok(
      ajaxCanaryScript.includes('FIREFOX_EXTENSION_WARMUP_TIMEOUT_MS'),
      'Windows AJAX canary should fail explicitly when the forced extension is not ready'
    );
    assert.ok(
      ajaxCanaryScript.includes('firefoxExtensionWarmup'),
      'Windows AJAX canary artifacts should preserve extension readiness evidence'
    );
    assert.ok(
      ajaxCanaryScript.includes('waitForProcessExit(warmup)'),
      'Windows AJAX canary should wait for the warmup browser to release the profile'
    );
    assert.ok(
      ajaxCanaryScript.includes('originHits'),
      'Windows AJAX canary artifacts should show whether the allowed origin loaded'
    );
    assert.ok(
      ajaxCanaryScript.includes('Firefox exited before AJAX auto-allow result'),
      'Windows AJAX canary should fail explicitly when Firefox exits before reporting'
    );
    assert.ok(
      ajaxCanaryScript.includes('PROBE_TIMEOUT_MS'),
      'Windows AJAX canary should not let one blocked request starve the remaining probes'
    );
    assert.ok(
      ajaxCanaryScript.includes('withTimeout(runProbeOnce(probe)'),
      'Windows AJAX canary should retry all probe kinds even when fetch hangs'
    );
    assert.ok(
      ajaxCanaryScript.includes('WINDOWS_AJAX_AUTO_ALLOW_CANARY_SUMMARY'),
      'Windows AJAX canary should print functional evidence before artifact upload'
    );
    assert.ok(
      ajaxCanaryScript.includes('const AUTO_ALLOW_PROBES = Object.freeze'),
      'Windows AJAX canary should declare subresource probes in one maintainable table'
    );
    assert.ok(
      ajaxCanaryScript.includes("id: 'ajax-fetch'") &&
        ajaxCanaryScript.includes("id: 'image-subresource'") &&
        ajaxCanaryScript.includes("id: 'script-subresource'") &&
        ajaxCanaryScript.includes("id: 'stylesheet-subresource'"),
      'Windows AJAX canary should identify each probe in evidence artifacts'
    );
    assert.ok(
      ajaxCanaryScript.includes('expectedWhitelistHost'),
      'Windows AJAX canary should validate whitelist writes from probe metadata'
    );
    assert.ok(
      ajaxCanaryScript.includes('collectWindowsAutoAllowDiagnostics'),
      'Windows AJAX canary should collect native-host diagnostics on success and failure'
    );
    assert.ok(
      ajaxCanaryScript.includes('redactSensitiveWindowsCanaryValue'),
      'Windows AJAX canary diagnostics must redact machine tokens before writing artifacts'
    );
    assert.ok(
      ajaxCanaryScript.includes('nativeProtocol') &&
        ajaxCanaryScript.includes('tokenPresent') &&
        ajaxCanaryScript.includes('OpenPath-Update') &&
        ajaxCanaryScript.includes('native-host.log') &&
        ajaxCanaryScript.includes('whitelistMtimeMs'),
      'Windows AJAX canary artifacts should expose native protocol, task, log, and whitelist state'
    );
    assert.ok(ajaxCanaryScript.includes('C:\\\\OpenPath\\\\data\\\\whitelist.txt'));
    assert.ok(ajaxCanaryScript.includes('Auto-allow AJAX target was not written to whitelist'));
    assert.ok(ajaxCanaryScript.includes('Auto-allow image target was not written to whitelist'));
    assert.ok(ajaxCanaryScript.includes('Auto-allow script target was not written to whitelist'));
    assert.ok(
      ajaxCanaryScript.includes('Auto-allow stylesheet target was not written to whitelist')
    );
    assert.ok(ajaxCanaryScript.includes('production-windows-ajax-auto-allow-canary.json'));
    assert.ok(workflowText.includes('Record canary result'));
    const restoreDnsStep = restoreDnsStepIndex >= 0 ? steps[restoreDnsStepIndex] : undefined;
    assert.equal(restoreDnsStep?.if, 'always()');
    assert.equal(restoreDnsStep?.['continue-on-error'], true);
    assert.equal(restoreDnsStep?.uses, './.github/actions/restore-windows-runner-dns');
    const uploadStep = uploadStepIndex >= 0 ? steps[uploadStepIndex] : undefined;
    assert.equal(
      uploadStep?.['continue-on-error'],
      undefined,
      'production bootstrap canary artifacts are release evidence and must not be best-effort'
    );
    assert.equal(uploadStep?.with?.['if-no-files-found'], 'error');
    assert.match(String(uploadStep?.with?.path ?? ''), /production-windows-bootstrap-canary\.json/);
    assert.match(
      String(uploadStep?.with?.path ?? ''),
      /production-windows-ajax-auto-allow-canary\.json/
    );
  });
});
