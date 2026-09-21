import { Children, PropsWithChildren } from "react";
import { Pressable, Text, View } from "react-native";
import { colors, styles } from "@/lib/theme";
export function Header({ title, subtitle }: { title: string; subtitle?: string }) { return <View style={{ marginBottom: 20 }}><Text style={styles.title}>{title}</Text>{subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}</View>; }
export function Action({ label, onPress, secondary = false }: { label: string; onPress: () => void; secondary?: boolean }) { return <Pressable onPress={onPress} style={[styles.button, secondary && { backgroundColor: "#FCE8EF" }]}><Text style={[styles.buttonText, secondary && { color: colors.primary }]}>{label}</Text></Pressable>; }
export function Card({ children }: PropsWithChildren) {
  const content = Children.toArray(children).filter(child => typeof child !== "string" || child.trim().length > 0);
  return <View style={styles.card}>{content}</View>;
}
