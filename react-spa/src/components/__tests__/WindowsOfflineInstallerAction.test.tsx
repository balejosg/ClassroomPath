import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import WindowsOfflineInstallerAction from '../WindowsOfflineInstallerAction';

const generateMutate = vi.fn();

vi.mock('../../lib/dual-trpc-provider', () => ({
  cpTrpcReact: {
    windowsOfflineInstaller: {
      generate: {
        useMutation: vi.fn(() => ({
          mutate: generateMutate,
          isPending: false,
        })),
      },
    },
  },
}));

const t = (key: string, params?: Record<string, string>) => {
  const catalog: Record<string, string> = {
    'cp.offlineInstaller.action': 'Download Windows installer',
    'cp.offlineInstaller.generating': 'Generating installer…',
    'cp.offlineInstaller.error': 'Could not generate the installer.',
    'cp.offlineInstaller.metadata': `v${params?.version} · SHA-256 ${params?.sha256}… · token expires ${params?.expiresAt}`,
  };
  return catalog[key] ?? key;
};

vi.mock('../../i18n/classroompath-i18n', () => ({
  useClassroomPathT: () => t,
}));

describe('WindowsOfflineInstallerAction', () => {
  beforeEach(() => {
    generateMutate.mockReset();
    vi.stubGlobal('URL', URL);
  });

  it('requests generation for the selected classroom when clicked', async () => {
    const user = userEvent.setup();
    render(<WindowsOfflineInstallerAction classroomId="classroom-7" />);

    await user.click(screen.getByRole('button', { name: 'Download Windows installer' }));

    expect(generateMutate).toHaveBeenCalledWith({ classroomId: 'classroom-7' });
  });

  it('shows metadata after a successful generation', async () => {
    const anchorClick = vi.fn();
    const anchorSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(anchorClick);
    let onSuccess: ((data: unknown) => void) | undefined;
    const { cpTrpcReact } = await import('../../lib/dual-trpc-provider');
    (
      cpTrpcReact.windowsOfflineInstaller.generate.useMutation as ReturnType<typeof vi.fn>
    ).mockImplementation((options: { onSuccess?: (data: unknown) => void }) => {
      onSuccess = options.onSuccess;
      return { mutate: generateMutate, isPending: false };
    });

    render(<WindowsOfflineInstallerAction classroomId="classroom-7" />);
    await userEvent.click(screen.getByRole('button'));

    onSuccess?.({
      fileName: 'OpenPath-Offline-Setup.exe',
      version: '4.1.0',
      sha256: 'a'.repeat(64),
      tokenExpiresAt: '2026-08-22T00:00:00.000Z',
      downloadUrl: '/cp/api/windows-offline-installer/download?ref=abc',
    });

    await waitFor(() => {
      expect(screen.getByTestId('windows-offline-installer-metadata')).toBeInTheDocument();
    });
    expect(screen.getByTestId('windows-offline-installer-metadata').textContent).toContain('4.1.0');
    expect(anchorClick).toHaveBeenCalled();
    anchorSpy.mockRestore();
  });
});
