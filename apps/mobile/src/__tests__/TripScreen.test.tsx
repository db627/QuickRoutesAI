import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import TripScreen from '../screens/TripScreen';
import { apiFetch } from '../services/api';
import { getCurrentPosition, startTracking, stopTracking } from '../services/location';
import { onSnapshot } from 'firebase/firestore';

let mockIsConnected = true;

jest.mock('../config/firebase', () => ({
  auth: { currentUser: { uid: 'driver123' } },
  firestore: {},
}));

jest.mock('firebase/firestore', () => ({
  collection: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  onSnapshot: jest.fn(),
}));

jest.mock('../services/api', () => ({
  apiFetch: jest.fn().mockResolvedValue({}),
}));

jest.mock('../services/location', () => ({
  startTracking: jest.fn().mockResolvedValue(true),
  stopTracking: jest.fn().mockResolvedValue(undefined),
  getCurrentPosition: jest.fn().mockResolvedValue(null),
}));

jest.mock('../services/navigation', () => ({
  openNavigation: jest.fn(),
}));

jest.mock('../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isConnected: mockIsConnected }),
}));

jest.mock('react-native-maps', () => ({
  __esModule: true,
  default: ({ children }: any) => children ?? null,
  Marker: () => null,
  Polyline: () => null,
  PROVIDER_GOOGLE: 'google',
}));

const baseTrip = {
  driverId: 'driver123',
  stops: [
    { stopId: 's1', address: '123 Main St', lat: 40.7128, lng: -74.006, sequence: 1, notes: '' },
  ],
  route: null,
  createdAt: '2026-03-22T00:00:00Z',
  updatedAt: '2026-03-22T00:00:00Z',
  createdBy: 'dispatcher1',
};

const assignedTrip = { ...baseTrip, status: 'assigned' };
const inProgressTrip = { ...baseTrip, status: 'in_progress' };

function mockSnapshot(tripData: object) {
  (onSnapshot as jest.Mock).mockImplementation((_q, callback) => {
    callback({ docs: [{ id: 'trip1', data: () => tripData }] });
    return jest.fn();
  });
}

describe('TripScreen', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockIsConnected = true;
    jest.spyOn(Alert, 'alert');
    (apiFetch as jest.Mock).mockResolvedValue({});
    (startTracking as jest.Mock).mockResolvedValue(true);
    (stopTracking as jest.Mock).mockResolvedValue(undefined);
    (getCurrentPosition as jest.Mock).mockResolvedValue(null);
  });

  it('shows empty state when no trips', () => {
    (onSnapshot as jest.Mock).mockImplementation((_q, callback) => {
      callback({ docs: [] });
      return jest.fn();
    });
    const { getByText } = render(<TripScreen />);
    expect(getByText('No Active Trips')).toBeTruthy();
  });

  it('shows Start Trip button for assigned trip', () => {
    mockSnapshot(assignedTrip);
    const { getByText } = render(<TripScreen />);
    expect(getByText('Start Trip')).toBeTruthy();
  });

  it('calls apiFetch and startTracking when Start Trip is tapped', async () => {
    mockSnapshot(assignedTrip);
    const { getByText } = render(<TripScreen />);
    fireEvent.press(getByText('Start Trip'));
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/trips/trip1/status',
        expect.objectContaining({ body: JSON.stringify({ status: 'in_progress' }) }),
      );
      expect(startTracking).toHaveBeenCalled();
    });
  });

  it('sends currentLocation when starting a trip and location is available', async () => {
    (getCurrentPosition as jest.Mock).mockResolvedValue({
      coords: { latitude: 40.7357, longitude: -74.1724 },
    });
    mockSnapshot(assignedTrip);
    const { getByText } = render(<TripScreen />);

    fireEvent.press(getByText('Start Trip'));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/trips/trip1/status',
        expect.objectContaining({
          body: JSON.stringify({
            status: 'in_progress',
            currentLocation: { lat: 40.7357, lng: -74.1724 },
          }),
        }),
      );
    });
  });

  it('shows Navigate and Complete Trip buttons for in_progress trip', () => {
    mockSnapshot(inProgressTrip);
    const { getByText } = render(<TripScreen />);
    expect(getByText('Navigate')).toBeTruthy();
    expect(getByText('Complete Trip')).toBeTruthy();
  });

  it('shows confirmation dialog when Complete Trip is tapped', () => {
    mockSnapshot(inProgressTrip);
    const { getByText } = render(<TripScreen />);
    fireEvent.press(getByText('Complete Trip'));
    expect(Alert.alert).toHaveBeenCalledWith(
      'Complete Trip',
      'Are you sure you want to mark this trip as complete?',
      expect.any(Array),
    );
  });

  it('calls apiFetch and stopTracking when completion is confirmed', async () => {
    mockSnapshot(inProgressTrip);
    (Alert.alert as jest.Mock).mockImplementation((_title, _msg, buttons) => {
      buttons.find((b: any) => b.text === 'Complete')?.onPress();
    });
    const { getByText } = render(<TripScreen />);
    fireEvent.press(getByText('Complete Trip'));
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/trips/trip1/status',
        expect.objectContaining({ body: JSON.stringify({ status: 'completed' }) }),
      );
      expect(stopTracking).toHaveBeenCalled();
    });
  });

  it('does not call apiFetch when completion is cancelled', async () => {
    mockSnapshot(inProgressTrip);
    (Alert.alert as jest.Mock).mockImplementation((_title, _msg, buttons) => {
      buttons.find((b: any) => b.text === 'Cancel')?.onPress?.();
    });
    const { getByText } = render(<TripScreen />);
    fireEvent.press(getByText('Complete Trip'));
    await waitFor(() => {
      expect(apiFetch).not.toHaveBeenCalled();
    });
  });

  it('shows offline alert and skips apiFetch when network is unavailable', async () => {
    mockIsConnected = false;
    mockSnapshot(assignedTrip);
    const { getByText } = render(<TripScreen />);
    fireEvent.press(getByText('Start Trip'));
    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'No Connection',
        'Trip status cannot be updated while offline.',
      );
      expect(apiFetch).not.toHaveBeenCalled();
    });
  });
});
