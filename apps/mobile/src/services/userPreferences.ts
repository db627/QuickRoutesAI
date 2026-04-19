import AsyncStorage from "@react-native-async-storage/async-storage";

export type NavAppPreference = "auto" | "google" | "apple";

const NAV_APP_KEY = "quickroutes:navAppPreference";

export async function getNavAppPreference(): Promise<NavAppPreference> {
  const stored = await AsyncStorage.getItem(NAV_APP_KEY);
  if (stored === "google" || stored === "apple" || stored === "auto") return stored;
  return "auto";
}

export async function setNavAppPreference(pref: NavAppPreference): Promise<void> {
  await AsyncStorage.setItem(NAV_APP_KEY, pref);
}
