import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import TripScreen from '../screens/TripScreen';
import { onSnapshot } from 'firebase/firestore';

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

const mockNavigate = jest.fn();
const mockNavigation = { navigate: mockNavigate };

const baseTrip = {
  driverId: 'driver123',
  status: 'assigned',
  stopCount: 1,
  route: null,
  createdAt: '2026-03-22T00:00:00Z',
  updatedAt: '2026-03-22T00:00:00Z',
  createdBy: 'dispatcher1',
};

function mockSnapshot(trips: Array<{ id: string; data: object }>) {
  (onSnapshot as jest.Mock).mockImplementation((_q, callback) => {
    callback({ docs: trips.map((t) => ({ id: t.id, data: () => t.data })) });
    return jest.fn();
  });
}

describe('TripScreen (list)', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockNavigate.mockClear();
  });

  it('shows empty state when no trips are assigned', () => {
    mockSnapshot([]);
    const { getByText } = render(<TripScreen navigation={mockNavigation} />);
    expect(getByText('No Assigned Trips')).toBeTruthy();
    expect(
      getByText('When a dispatcher assigns you a trip, it will appear here.'),
    ).toBeTruthy();
  });

  it('renders a trip card showing stop count', () => {
    mockSnapshot([{ id: 'tripabcd1234', data: baseTrip }]);
    const { getByText } = render(<TripScreen navigation={mockNavigation} />);
    expect(getByText('1')).toBeTruthy();
    expect(getByText(/stop/)).toBeTruthy();
  });

  it('renders ASSIGNED status badge for assigned trip', () => {
    mockSnapshot([{ id: 'tripabcd1234', data: baseTrip }]);
    const { getByText } = render(<TripScreen navigation={mockNavigation} />);
    expect(getByText('ASSIGNED')).toBeTruthy();
  });

  it('renders IN PROGRESS status badge for in_progress trip', () => {
    mockSnapshot([{ id: 'tripabcd1234', data: { ...baseTrip, status: 'in_progress' } }]);
    const { getByText } = render(<TripScreen navigation={mockNavigation} />);
    expect(getByText('IN PROGRESS')).toBeTruthy();
  });

  it('renders the short trip ID on the card', () => {
    mockSnapshot([{ id: 'tripabcd1234', data: baseTrip }]);
    const { getByText } = render(<TripScreen navigation={mockNavigation} />);
    expect(getByText('#ABCD1234')).toBeTruthy();
  });

  it('navigates to TripDetail with tripId when card is tapped', () => {
    mockSnapshot([{ id: 'tripabcd1234', data: baseTrip }]);
    const { getByText } = render(<TripScreen navigation={mockNavigation} />);
    fireEvent.press(getByText('#ABCD1234'));
    expect(mockNavigate).toHaveBeenCalledWith('TripDetail', { tripId: 'tripabcd1234' });
  });

  it('renders multiple trip cards', () => {
    mockSnapshot([
      { id: 'trip1111', data: baseTrip },
      { id: 'trip2222', data: { ...baseTrip, stopCount: 3 } },
    ]);
    const { getByText } = render(<TripScreen navigation={mockNavigation} />);
    expect(getByText('#TRIP1111')).toBeTruthy();
    expect(getByText('#TRIP2222')).toBeTruthy();
    expect(getByText('3')).toBeTruthy();
  });
});
