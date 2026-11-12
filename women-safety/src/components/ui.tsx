import { Children, PropsWithChildren } from "react";
import { ActivityIndicator, Pressable, Text, View, ViewStyle } from "react-native";
import { badgeColors, BadgeVariant, colors, styles } from "@/lib/theme";

/* ─── Header ─────────────────────────────────────────────────── */
export function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={styles.title}>{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
    </View>
  );
}

/* ─── Action button ──────────────────────────────────────────── */
export function Action({
  label,
  onPress,
  secondary = false,
  danger = false,
  green = false,
  loading = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  danger?: boolean;
  green?: boolean;
  loading?: boolean;
  disabled?: boolean;
}) {
  const bgColor = danger
    ? colors.red
    : green
    ? colors.green
    : secondary
    ? colors.primaryLight
    : colors.primary;
  const textColor = secondary ? colors.primary : colors.white;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={[
        styles.button,
        { backgroundColor: bgColor },
        (disabled || loading) && { opacity: 0.5 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <Text style={[styles.buttonText, { color: textColor }]}>{label}</Text>
      )}
    </Pressable>
  );
}

/* ─── Card ───────────────────────────────────────────────────── */
export function Card({ children, danger = false, style }: PropsWithChildren<{ danger?: boolean; style?: ViewStyle }>) {
  const content = Children.toArray(children).filter(
    (child) => typeof child !== "string" || child.trim().length > 0
  );
  return <View style={[danger ? styles.cardDanger : styles.card, style]}>{content}</View>;
}

/* ─── Badge ──────────────────────────────────────────────────── */
export function Badge({ label, variant = "neutral" }: { label: string; variant?: BadgeVariant }) {
  const { bg, text } = badgeColors[variant];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: text }]}>{label}</Text>
    </View>
  );
}

/* ─── SosButton ──────────────────────────────────────────────── */
/**
 * The main pulsing SOS button.
 * When state is 'idle', shows the SOS label.
 * When state is 'countdown', shows a large countdown number.
 * When state is 'active', shows ACTIVE state.
 */
export function SosButton({
  state,
  countdown,
  onPress,
}: {
  state: "idle" | "countdown" | "sending" | "active";
  countdown?: number;
  onPress: () => void;
}) {
  if (state === "countdown") {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Cancel SOS countdown. ${countdown ?? 0} seconds remaining.`}
        onPress={onPress}
        style={styles.countdownOuter}
      >
        <Text style={styles.countdownNumber}>{countdown}</Text>
        <Text style={styles.countdownLabel}>Tap to cancel</Text>
      </Pressable>
    );
  }

  if (state === "active") {
    return (
      <View style={[styles.sosOuter, { backgroundColor: colors.redLight, borderWidth: 3, borderColor: colors.red }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel active SOS"
          onPress={onPress}
          style={[styles.sosInner, { backgroundColor: colors.red }]}
        >
          <Text style={styles.sosLabel}>CANCEL</Text>
          <Text style={styles.sosSubLabel}>SOS Active</Text>
        </Pressable>
      </View>
    );
  }

  if (state === "sending") {
    return (
      <View style={[styles.countdownOuter, { backgroundColor: colors.redLight, borderColor: colors.red }]}>
        <ActivityIndicator size="large" color={colors.red} />
        <Text style={[styles.countdownLabel, { color: colors.red, marginTop: 12 }]}>Sending SOS…</Text>
      </View>
    );
  }

  // idle
  return (
    <View style={styles.sosOuter}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Start SOS"
        accessibilityHint="Begins a short countdown before alerting your trusted contacts."
        onPress={onPress}
        style={styles.sosInner}
      >
        <Text style={styles.sosLabel}>SOS</Text>
        <Text style={styles.sosSubLabel}>Tap to start alert</Text>
      </Pressable>
    </View>
  );
}

/* ─── StatusBanner ───────────────────────────────────────────── */
export function StatusBanner({
  title,
  subtitle,
  onAction,
  actionLabel,
}: {
  title: string;
  subtitle?: string;
  onAction?: () => void;
  actionLabel?: string;
}) {
  return (
    <View style={styles.activeBanner}>
      <View style={{ flex: 1 }}>
        <Text style={styles.activeBannerText}>{title}</Text>
        {subtitle ? <Text style={styles.activeBannerSub}>{subtitle}</Text> : null}
      </View>
      {onAction && actionLabel ? (
        <Pressable
          onPress={onAction}
          style={{ backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, marginLeft: 10 }}
        >
          <Text style={{ color: colors.white, fontWeight: "700", fontSize: 13 }}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/* ─── Divider ────────────────────────────────────────────────── */
export function Divider() {
  return <View style={styles.divider} />;
}

/* ─── EmptyState ─────────────────────────────────────────────── */
export function EmptyState({ message }: { message: string }) {
  return (
    <Card>
      <Text style={[styles.subtitle, { textAlign: "center" }]}>{message}</Text>
    </Card>
  );
}
