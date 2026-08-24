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
  downloadExpiresAt = new Date(Date.now() + 5 * 60_000).toISOString()
): InstallerResult {
  return {
    fileName: 'OpenPath-Offline-Setup.exe',
    version: '4.1.0',
    sha256: 'a'.repeat(64),
    tokenExpiresAt: '2026-08-22T00:00:00.000Z',
    downloadUrl: '/cp/api/windows-offline-installer/download?ref=abc',
    downloadExpiresAt,
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
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const user = userEvent.setup();
    renderAction('classroom-success');

    await user.click(screen.getByRole('link', { name: 'Download Windows installer (.exe)' }));
    const result = buildResult();
    resolveSuccess(result);

    await waitFor(() => {
      const link = screen.getByRole('link', { name: 'Download Windows installer (.exe)' });
      expect(link).toHaveAttribute('href', result.downloadUrl);
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

  it('reuses a fresh cached response for the same classroom without mutating again', async () => {
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const user = userEvent.setup();
    const first = renderAction('classroom-cache');

    await user.click(screen.getByRole('link', { name: 'Download Windows installer (.exe)' }));
    resolveSuccess(buildResult());
    await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(1));

    first.unmount();
    generateMutate.mockClear();
    renderAction('classroom-cache');

    await user.click(screen.getByRole('link', { name: 'Download Windows installer (.exe)' }));

    expect(generateMutate).not.toHaveBeenCalled();
    expect(anchorClick).toHaveBeenCalledTimes(2);
  });

  it('remints a cached response that is expired or inside the safety window', async () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const user = userEvent.setup();
    const first = renderAction('classroom-expired');

    await user.click(screen.getByRole('link', { name: 'Download Windows installer (.exe)' }));
    resolveSuccess(buildResult(new Date(Date.now() + 1_000).toISOString()));

    first.unmount();
    generateMutate.mockClear();
    renderAction('classroom-expired');

    await user.click(screen.getByRole('link', { name: 'Download Windows installer (.exe)' }));

    expect(generateMutate).toHaveBeenCalledWith({ classroomId: 'classroom-expired' });
  });
});
