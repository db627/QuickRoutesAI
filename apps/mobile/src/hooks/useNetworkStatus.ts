import { useEffect, useState } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { flushQueue } from "../services/offlineQueue";
export interface NetworkStatus {
  isConnected: boolean;
  isInternetReachable: boolean | null;
}

const useNetworkStatus = (): NetworkStatus => {
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>({
    isConnected: true,
    isInternetReachable: true,
  });

  useEffect(() => {
    NetInfo.fetch().then((state: NetInfoState) => {
      setNetworkStatus({
        isConnected: state.isConnected ?? false,
        isInternetReachable: state.isInternetReachable,
      });
    });

    // Subscribe to network changes
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      const connected = state.isConnected ?? false;
      setNetworkStatus({
        isConnected: state.isConnected ?? false,
        isInternetReachable: state.isInternetReachable,
      });
      
      if (connected) {
        flushQueue();
      }
    });

    return () => unsubscribe();
  }, []);

  return networkStatus;
};

export { useNetworkStatus };
