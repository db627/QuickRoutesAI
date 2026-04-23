import type { NativeStackScreenProps } from "@react-navigation/native-stack";

export type TripStackParamList = {
  TripList: undefined;
  TripDetail: { tripId: string };
  TripCompletion: { tripId: string };
};

export type TripStackScreenProps<T extends keyof TripStackParamList> =
  NativeStackScreenProps<TripStackParamList, T>;
