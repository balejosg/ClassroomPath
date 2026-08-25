import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import WindowsOfflineInstallerAction from '../WindowsOfflineInstallerAction';

type InstallerResult = {
  fileName: string;
  version: string;
  sha256: string;
  tokenExpiresAt: string;
  downloadUrl: string;
  downloadExpiresAt: string;
};

type MutationOptions = {
  onSuccess?: (data: InstallerResult) => void;
  onError?: () => void;
};

const { generateMutate, mutationOptions } = vi.hoisted(() => ({
  generateMutate: vi.fn(),
  mutationOptions: { current: null as MutationOptions | null },
}));

vi.mock('../../lib/dual-trpc-provider', () => ({
  cpTrpcReact: {
    windowsOfflineInstaller: {
      generate: {
        useMutation: vi.fn((options: MutationOptions) => {
          mutationOptions.current = options;
          return {
            mutate: generateMutate,
            isPending: false,
          };
        }),
      },
    },
  },
}));

const t = (key: string, params?: Record<string, string>) => {
  const catalog: Record<string, string> = {
    'cp.offlineInstaller.linkAction': 'Download Windows installer (.exe)',
    'cp.offlineInstaller.generating': 'Generating installer…',
    'cp.offlineInstaller.retryAction': 'Retry download',
    'cp.offlineInstaller.error': 'Could not generate the installer.',
    'cp.offlineInstaller.metadata': `v${params?.version} · SHA-256 ${params?.sha256}… · token expires ${params?.expiresAt}`,
  };
  return catalog[key] ?? key;
};

vi.mock('../../i18n/classroompath-i18n', () => ({
  useClassroomPathT: () => t,
}));

function buildResult(
  downloadUrl = '/cp/api/windows-offline-installer/download?ref=abc'
): InstallerResult {
  return {
    fileName: 'OpenPath-Offline-Setup.exe',
    version: '4.1.0',
    sha256: 'a'.repeat(64),
    tokenExpiresAt: '2026-08-22T00:00:00.000Z',
    downloadUrl,
    downloadExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  };
}

function renderAction(classroomId: string) {
  return render(<WindowsOfflineInstallerAction classroomId={classroomId} />);
}

function resolveSuccess(result = buildResult()) {
  act(() => mutationOptions.current?.onSuccess?.(result));
}

function rejectGeneration() {
  act(() => mutationOptions.current?.onError?.());
}

describe('WindowsOfflineInstallerAction', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    generateMutate.mockReset();
    mutationOptions.current = null;
  });

  it('renders a visible link without generating or navigating on mount', () => {
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderAction('classroom-mount');

    const link = screen.getByRole('link', { name: 'Download Windows installer (.exe)' });
    expect(link).not.toHaveAttribute('href');
    expect(generateMutate).not.toHaveBeenCalled();
    expect(anchorClick).not.toHaveBeenCalled();
  });

  it('requests generation for the selected classroom only after the link is clicked', async () => {
    const user = userEvent.setup();
    renderAction('classroom-7');

    await user.click(screen.getByRole('link', { name: 'Download Windows installer (.exe)' }));

    expect(generateMutate).toHaveBeenCalledWith({ classroomId: 'classroom-7' });
  });

  it('assigns the generated URL and filename before navigating the visible link', async () => {
    let navigatedHref = '';
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      navigatedHref = this.getAttribute('href') ?? '';
    });
    const user = userEvent.setup();
    renderAction('classroom-success');

    await user.click(screen.getByRole('link', { name: 'Download Windows installer (.exe)' }));
    const result = buildResult();
    resolveSuccess(result);

    await waitFor(() => {
      const link = screen.getByRole('link', { name: 'Download Windows installer (.exe)' });
      expect(navigatedHref).toBe(result.downloadUrl);
      expect(link).not.toHaveAttribute('href');
      expect(link).toHaveAttribute('download', result.fileName);
      expect(anchorClick).toHaveBeenCalledTimes(1);
    });
  });

  it('turns the same link into a retry action after generation fails', async () => {
    const user = userEvent.setup();
    renderAction('classroom-error');

    await user.click(screen.getByRole('link', { name: 'Download Windows installer (.exe)' }));
    rejectGeneration();

    const retryLink = await screen.findByRole('link', { name: 'Retry download' });
    expect(screen.getByRole('alert')).toHaveTextContent('Could not generate the installer.');
    await user.click(retryLink);
    expect(generateMutate).toHaveBeenCalledTimes(2);
  });

  it('generates a fresh reference for every explicit click', async () => {
    const navigatedHrefs: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      navigatedHrefs.push(this.getAttribute('href') ?? '');
    });
    const user = userEvent.setup();
    renderAction('classroom-cache');

    await user.click(screen.getByRole('link', { name: 'Download Windows installer (.exe)' }));
    resolveSuccess(buildResult('/cp/api/windows-offline-installer/download?ref=A'));
    await waitFor(() =>
      expect(navigatedHrefs).toEqual(['/cp/api/windows-offline-installer/download?ref=A'])
    );

    await user.click(screen.getByRole('link', { name: 'Download Windows installer (.exe)' }));

    expect(generateMutate).toHaveBeenCalledTimes(2);
    resolveSuccess(buildResult('/cp/api/windows-offline-installer/download?ref=B'));
    await waitFor(() =>
      expect(navigatedHrefs).toEqual([
        '/cp/api/windows-offline-installer/download?ref=A',
        '/cp/api/windows-offline-installer/download?ref=B',
      ])
    );
    expect(navigatedHrefs).not.toEqual([
      '/cp/api/windows-offline-installer/download?ref=A',
      '/cp/api/windows-offline-installer/download?ref=A',
    ]);
    expect(screen.getByRole('link')).not.toHaveAttribute('href');
  });
});
