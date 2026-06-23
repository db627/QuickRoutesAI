import AsyncStorage from "@react-native-async-storage/async-storage";
import { getNavAppPreference, setNavAppPreference } from "../services/userPreferences";

describe("userPreferences", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("defaults to 'auto' when no preference is stored", async () => {
    const pref = await getNavAppPreference();
    expect(pref).toBe("auto");
  });

  it("stores and retrieves 'google'", async () => {
    await setNavAppPreference("google");
    expect(await getNavAppPreference()).toBe("google");
  });

  it("stores and retrieves 'apple'", async () => {
    await setNavAppPreference("apple");
    expect(await getNavAppPreference()).toBe("apple");
  });

  it("falls back to 'auto' when stored value is invalid", async () => {
    await AsyncStorage.setItem("quickroutes:navAppPreference", "garbage");
    expect(await getNavAppPreference()).toBe("auto");
  });
});
