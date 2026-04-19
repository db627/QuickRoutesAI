import { Linking, Platform, Alert } from 'react-native';
import { openNavigation } from '../services/navigation';
import { setNavAppPreference } from '../services/userPreferences';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('react-native', () => ({
  Linking: {
    canOpenURL: jest.fn(),
    openURL: jest.fn(),
  },
  Platform: {
    OS: 'ios',
  },
  Alert: {
    alert: jest.fn(),
  },
}));

const mockStops = [
  {
    stopId: 'stop1',
    sequence: 0,
    lat: 40.744,
    lng: -74.1901,
    address: '150 Bergen St, Newark, NJ',
    contactName: '',
    notes: '',
  },
  {
    stopId: 'stop2',
    sequence: 1,
    lat: 40.7347,
    lng: -74.1645,
    address: '1 Raymond Plaza W, Newark, NJ',
    contactName: '',
    notes: '',
  },
];

describe('openNavigation', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it('shows alert when no stops provided', async () => {
    await openNavigation([]);
    expect(Alert.alert).toHaveBeenCalledWith('No Stops', 'This trip has no stops to navigate to.');
  });

  it('opens Apple Maps on iOS in auto mode when available', async () => {
    (Platform as any).OS = 'ios';
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(true);

    await openNavigation(mockStops);

    expect(Linking.openURL).toHaveBeenCalledWith(expect.stringContaining('maps://'));
  });

  it('opens Google Maps URL on Android with all waypoints', async () => {
    (Platform as any).OS = 'android';
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(true);

    await openNavigation(mockStops);

    expect(Linking.openURL).toHaveBeenCalledWith(expect.stringContaining('google.com/maps/dir/'));
  });

  it('falls back to Google Maps URL when Apple Maps not available (auto mode)', async () => {
    (Platform as any).OS = 'ios';
    (Linking.canOpenURL as jest.Mock)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await openNavigation(mockStops);

    expect(Linking.openURL).toHaveBeenCalledWith(expect.stringContaining('google.com/maps'));
  });

  it('shows error alert when no maps or browser available', async () => {
    (Platform as any).OS = 'ios';
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(false);

    await openNavigation(mockStops);

    expect(Alert.alert).toHaveBeenCalledWith(
      'Error',
      'Unable to open maps. Please install Google Maps or Apple Maps.',
    );
  });

  it('forces Google Maps when preference is "google" on iOS', async () => {
    (Platform as any).OS = 'ios';
    await setNavAppPreference('google');
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(true);

    await openNavigation(mockStops);

    expect(Linking.openURL).toHaveBeenCalledTimes(1);
    expect(Linking.openURL).toHaveBeenCalledWith(expect.stringContaining('google.com/maps/dir/'));
  });

  it('forces Apple Maps when preference is "apple" on iOS', async () => {
    (Platform as any).OS = 'ios';
    await setNavAppPreference('apple');
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(true);

    await openNavigation(mockStops);

    expect(Linking.openURL).toHaveBeenCalledWith(expect.stringContaining('maps://'));
  });

  it('falls back to Google Maps when preference is "apple" but unavailable', async () => {
    (Platform as any).OS = 'ios';
    await setNavAppPreference('apple');
    (Linking.canOpenURL as jest.Mock)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await openNavigation(mockStops);

    expect(Linking.openURL).toHaveBeenCalledWith(expect.stringContaining('google.com/maps'));
  });

  it('ignores "apple" preference on Android and uses Google Maps', async () => {
    (Platform as any).OS = 'android';
    await setNavAppPreference('apple');
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(true);

    await openNavigation(mockStops);

    expect(Linking.openURL).toHaveBeenCalledWith(expect.stringContaining('google.com/maps/dir/'));
  });
});
