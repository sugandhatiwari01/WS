import { StyleSheet } from "react-native";

export const colors = {
  ink: "#172033",
  muted: "#667085",
  bg: "#F7F8FC",
  card: "#FFFFFF",
  primary: "#C83B67",
  primaryLight: "#FCE8EF",
  purple: "#7448C8",
  green: "#208A67",
  greenLight: "#D1FAE5",
  red: "#D92D20",
  redLight: "#FEE4E2",
  border: "#E6E8EF",
  amber: "#B54708",
  amberLight: "#FEF3C7",
  white: "#FFFFFF",
  black: "#000000",
};

export const styles = StyleSheet.create({
  /* ─── layout ─────────────────────────────────────────── */
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { padding: 22 },
  scrollContent: { padding: 22, paddingBottom: 50 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center" },
  spaceBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },

  /* ─── typography ─────────────────────────────────────── */
  title: { fontSize: 28, fontWeight: "800", color: colors.ink, marginBottom: 8 },
  h2: { fontSize: 20, fontWeight: "800", color: colors.ink },
  h3: { fontSize: 17, fontWeight: "700", color: colors.ink },
  subtitle: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  caption: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  errorText: { color: colors.red, fontSize: 14, fontWeight: "600" },

  /* ─── cards ──────────────────────────────────────────── */
  card: {
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardDanger: {
    backgroundColor: colors.redLight,
    borderRadius: 18,
    padding: 18,
    marginBottom: 14,
    borderWidth: 2,
    borderColor: colors.red,
  },

  /* ─── buttons ────────────────────────────────────────── */
  button: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
    marginTop: 10,
  },
  buttonText: { color: colors.white, fontWeight: "700", fontSize: 16 },
  buttonSecondary: {
    backgroundColor: colors.primaryLight,
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
    marginTop: 10,
  },
  buttonSecondaryText: { color: colors.primary, fontWeight: "700", fontSize: 16 },
  buttonDanger: {
    backgroundColor: colors.red,
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
    marginTop: 10,
  },
  buttonGreen: {
    backgroundColor: colors.green,
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
    marginTop: 10,
  },
  buttonSmall: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 8,
  },

  /* ─── inputs ─────────────────────────────────────────── */
  input: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginTop: 10,
    color: colors.ink,
    fontSize: 15,
  },

  /* ─── SOS button ─────────────────────────────────────── */
  sosOuter: {
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: colors.redLight,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginVertical: 20,
  },
  sosInner: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: colors.red,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.red,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 14,
    elevation: 12,
  },
  sosLabel: { color: colors.white, fontSize: 28, fontWeight: "900", letterSpacing: 2 },
  sosSubLabel: { color: "rgba(255,255,255,0.8)", fontSize: 13, fontWeight: "600", marginTop: 4 },

  /* ─── countdown ──────────────────────────────────────── */
  countdownOuter: {
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: colors.amberLight,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginVertical: 20,
    borderWidth: 4,
    borderColor: colors.amber,
  },
  countdownNumber: { fontSize: 80, fontWeight: "900", color: colors.amber },
  countdownLabel: { fontSize: 15, fontWeight: "600", color: colors.amber },

  /* ─── active SOS banner ──────────────────────────────── */
  activeBanner: {
    backgroundColor: colors.red,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  activeBannerText: { color: colors.white, fontWeight: "800", fontSize: 16 },
  activeBannerSub: { color: "rgba(255,255,255,0.8)", fontSize: 13, marginTop: 2 },

  /* ─── badge ──────────────────────────────────────────── */
  badge: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, alignSelf: "flex-start" },
  badgeText: { fontSize: 12, fontWeight: "700" },

  /* ─── divider ────────────────────────────────────────── */
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 12 },
});

export type BadgeVariant = "success" | "danger" | "warning" | "neutral" | "info";

export const badgeColors: Record<BadgeVariant, { bg: string; text: string }> = {
  success: { bg: colors.greenLight, text: colors.green },
  danger: { bg: colors.redLight, text: colors.red },
  warning: { bg: colors.amberLight, text: colors.amber },
  neutral: { bg: colors.border, text: colors.muted },
  info: { bg: "#EFF8FF", text: "#1D4ED8" },
};
