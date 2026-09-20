import { StyleSheet } from "react-native";
export const colors = { ink: "#172033", muted: "#667085", bg: "#F7F8FC", card: "#FFFFFF", primary: "#C83B67", purple: "#7448C8", green: "#208A67", red: "#D92D20", border: "#E6E8EF", amber: "#B54708" };
export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg }, container: { flex: 1, padding: 22 },
  title: { fontSize: 28, fontWeight: "800", color: colors.ink, marginBottom: 8 }, subtitle: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  card: { backgroundColor: colors.card, borderRadius: 18, padding: 18, marginBottom: 14, borderWidth: 1, borderColor: colors.border },
  button: { backgroundColor: colors.primary, borderRadius: 14, padding: 16, alignItems: "center", marginTop: 10 }, buttonText: { color: "white", fontWeight: "700", fontSize: 16 },
  input: { backgroundColor: "white", borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 10, color: colors.ink },
});
