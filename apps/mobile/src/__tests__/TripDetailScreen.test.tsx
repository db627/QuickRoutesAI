import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import TripDetailScreen from '../screens/TripDetailScreen';
import { apiFetch } from '../services/api';
import { startTracking, stopTracking } from '../services/location';
import { onSnapshot } from 'firebase/firestore';

let mockIsConnected = true;

jest.mock('../config/firebase', () => ({
  auth: { currentUser: { uid: 'driver123' } },
  firestore: {},
}));

jest.mock('firebase/firestore', () => ({
  doc: jest.fn().mockReturnValue({}),
  onSnapshot: jest.fn(),
}));

jest.mock('../services/api', () => ({
  apiFetch: jest.fn().mockResolvedValue({}),
}));

jest.mock('../services/location', () => ({
  startTracking: jest.fn().mockResolvedValue(true),
  stopTracking: jest.fn().mockResolvedValue(undefined),
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

const mockRoute = { params: { tripId: 'trip1' } };
const mockNavigation = { navigate: jest.fn() };

const baseTrip = {
  driverId: 'driver123',
  stops: [
    { stopId: 's1', address: '123 Main St', lat: 40.7128, lng: -74.006, sequence: 1, notes: '' },
    { stopId: 's2', address: '456 Oak Ave', lat: 40.72, lng: -74.01, sequence: 2, notes: 'Ring bell' },
  ],
  route: null,
  createdAt: '2026-03-22T00:00:00Z',
  updatedAt: '2026-03-22T00:00:00Z',
  createdBy: 'dispatcher1',
};

const assignedTrip = { ...baseTrip, status: 'assigned' };
const inProgressTrip = { ...baseTrip, status: 'in_progress' };

function mockDocSnapshot(tripData: object | null) {
  (onSnapshot as jest.Mock).mockImplementation((_ref, callback) => {
    if (tripData === null) {
      callback({ exists: () => false, id: 'trip1', data: () => ({}) });
    } else {
      callback({ exists: () => true, id: 'trip1', data: () => tripData });
    }
    return jest.fn();
  });
}

describe('TripDetailScreen', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockIsConnected = true;
    jest.spyOn(Alert, 'alert');
    (apiFetch as jest.Mock).mockResolvedValue({});
    (startTracking as jest.Mock).mockResolvedValue(true);
    (stopTracking as jest.Mock).mockResolvedValue(undefined);
  });

  it('shows trip not found when document does not exist', () => {
    mockDocSnapshot(null);
    const { getByText } = render(<TripDetailScreen route={mockRoute} navigation={mockNavigation} />);
    expect(getByText('Trip Not Found')).toBeTruthy();
  });

  it('renders stop addresses for assigned trip', () => {
    mockDocSnapshot(assignedTrip);
    const { getByText } = render(<TripDetailScreen route={mockRoute} navigation={mockNavigation} />);
    expect(getByText('123 Main St')).toBeTruthy();
    expect(getByText('456 Oak Ave')).toBeTruthy();
  });

  it('renders stop notes when present', () => {
    mockDocSnapshot(assignedTrip);
    const { getByText } = render(<TripDetailScreen route={mockRoute} navigation={mockNavigation} />);
    expect(getByText('Ring bell')).toBeTruthy();
  });

  it('shows Start Trip button for assigned trip', () => {
    mockDocSnapshot(assignedTrip);
    const { getByText } = render(<TripDetailScreen route={mockRoute} navigation={mockNavigation} />);
    expect(getByText('Start Trip')).toBeTruthy();
  });

  it('shows Navigate and Complete Trip buttons for in_progress trip', () => {
    mockDocSnapshot(inProgressTrip);
    const { getByText } = render(<TripDetailScreen route={mockRoute} navigation={mockNavigation} />);
    expect(getByText('Navigate')).toBeTruthy();
    expect(getByText('Complete Trip')).toBeTruthy();
  });

  it('calls apiFetch and startTracking when Start Trip is tapped', async () => {
    mockDocSnapshot(assignedTrip);
    const { getByText } = render(<TripDetailScreen route={mockRoute} navigation={mockNavigation} />);
    fireEvent.press(getByText('Start Trip'));
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/trips/trip1/status',
        expect.objectContaining({ body: JSON.stringify({ status: 'in_progress' }) }),
      );
      expect(startTracking).toHaveBeenCalled();
    });
  });

  it('shows confirmation dialog when Complete Trip is tapped', () => {
    mockDocSnapshot(inProgressTrip);
    const { getByText } = render(<TripDetailScreen route={mockRoute} navigation={mockNavigation} />);
    fireEvent.press(getByText('Complete Trip'));
    expect(Alert.alert).toHaveBeenCalledWith(
      'Complete Trip',
      'Are you sure you want to mark this trip as complete?',
      expect.any(Array),
    );
  });

  it('calls apiFetch and stopTracking when completion is confirmed', async () => {
    mockDocSnapshot(inProgressTrip);
    (Alert.alert as jest.Mock).mockImplementation((_title, _msg, buttons) => {
      buttons.find((b: any) => b.text === 'Complete')?.onPress();
    });
    const { getByText } = render(<TripDetailScreen route={mockRoute} navigation={mockNavigation} />);
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
    mockDocSnapshot(inProgressTrip);
    (Alert.alert as jest.Mock).mockImplementation((_title, _msg, buttons) => {
      buttons.find((b: any) => b.text === 'Cancel')?.onPress?.();
    });
    const { getByText } = render(<TripDetailScreen route={mockRoute} navigation={mockNavigation} />);
    fireEvent.press(getByText('Complete Trip'));
    await waitFor(() => {
      expect(apiFetch).not.toHaveBeenCalled();
    });
  });

  it('shows offline alert and skips apiFetch when network is unavailable', async () => {
    mockIsConnected = false;
    mockDocSnapshot(assignedTrip);
    const { getByText } = render(<TripDetailScreen route={mockRoute} navigation={mockNavigation} />);
    fireEvent.press(getByText('Start Trip'));
    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'No Connection',
        'Trip status cannot be updated while offline.',
      );
      expect(apiFetch).not.toHaveBeenCalled();
    });
  });

  it('shows error alert when apiFetch fails', async () => {
    mockDocSnapshot(assignedTrip);
    (apiFetch as jest.Mock).mockRejectedValue(new Error('API error'));
    const { getByText } = render(<TripDetailScreen route={mockRoute} navigation={mockNavigation} />);
    fireEvent.press(getByText('Start Trip'));
    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Error',
        'Failed to update trip status. Please try again.',
      );
    });
  });
});
