import { Platform } from "react-native";
import * as Network from "expo-network";
import * as SMS from "expo-sms";

export async function isInternetUnavailable() {
  const state = await Network.getNetworkStateAsync();
  return state.isConnected === false || state.isInternetReachable === false;
}

export async function openSmsComposer(addresses: string[], message: string) {
  if (Platform.OS === "web") {
    throw new Error("Cellular SMS is only available in the native mobile app.");
  }
  if (!(await SMS.isAvailableAsync())) {
    throw new Error("No SMS app or cellular messaging service is available on this device.");
  }
  return SMS.sendSMSAsync(addresses, message);
}
