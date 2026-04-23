import { renderHook, act } from '@testing-library/react-native';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { useNetworkStatus } from '../hooks/useNetworkStatus';

jest.mock('../config/firebase', () => ({
  firestore: {},
  auth: {},
}));

jest.mock('../services/offlineQueue', () => ({
  flushQueue: jest.fn(),
}));

jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn(),
  addEventListener: jest.fn(),
}));

describe('useNetworkStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns connected true by default', async () => {
    (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: true, isInternetReachable: true });
    (NetInfo.addEventListener as jest.Mock).mockReturnValue(() => {});

    const { result } = renderHook(() => useNetworkStatus());
    await act(async () => {});
    expect(result.current.isConnected).toBe(true);
  });

  it('updates when network goes offline', async () => {
    let listener: (state: Pick<NetInfoState, 'isConnected' | 'isInternetReachable'>) => void = () => {};
    (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: true, isInternetReachable: true });
    (NetInfo.addEventListener as jest.Mock).mockImplementation((cb) => {
      listener = cb;
      return () => {};
    });

    const { result } = renderHook(() => useNetworkStatus());
    await act(async () => {});

    act(() => {
      listener({ isConnected: false, isInternetReachable: false });
    });

    expect(result.current.isConnected).toBe(false);
  });

  it('updates when network comes back online', async () => {
    let listener: (state: Pick<NetInfoState, 'isConnected' | 'isInternetReachable'>) => void = () => {};
    (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: false, isInternetReachable: false });
    (NetInfo.addEventListener as jest.Mock).mockImplementation((cb) => {
      listener = cb;
      return () => {};
    });

    const { result } = renderHook(() => useNetworkStatus());
    await act(async () => {});

    act(() => {
      listener({ isConnected: true, isInternetReachable: true });
    });

    expect(result.current.isConnected).toBe(true);
  });
});