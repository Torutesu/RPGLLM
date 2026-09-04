import { Stack } from "expo-router";
import { colors } from "@rpgllm/shared";
export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />;
}
