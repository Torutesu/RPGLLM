import { Text, View } from "react-native";
import { colors, strings } from "@rpgllm/shared";
export default function Index() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: colors.text, fontSize: 24 }}>{strings.en.tagline}</Text>
    </View>
  );
}
